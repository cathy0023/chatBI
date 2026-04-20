import { recommendChart } from '@/lib/agents/chart-recommender';
import { getColumnLabel } from '@/types/database';

/**
 * Generate ECharts HTML deterministically — no LLM involved.
 * Uses chart-recommender to pick chart type, then builds HTML from a template.
 */
export async function generateChartCode(
  query: string,
  records: Record<string, unknown>[],
  columns: string[],
): Promise<string> {
  if (records.length === 0) return '';

  const { uiType, dimension, metric } = recommendChart(query, records);

  // Auto-select chart type based on data when recommendChart returns 'table'
  let chartType = uiType;
  if (chartType === 'table') {
    const uniqueValues = new Set(records.map(r => String(r[dimension] || '')));
    if (uniqueValues.size >= 2) {
      chartType = 'bar';
    }
  }

  // Aggregate data by dimension
  const aggData = aggregateForChart(records, dimension, metric);
  const labels = Object.keys(aggData);
  const values = Object.values(aggData);
  const title = query;
  const metricLabel = getColumnLabel(metric);
  const dimLabel = getColumnLabel(dimension);

  const option = buildEchartsOption(chartType, title, labels, values, metricLabel, dimLabel);

  const html = `<html>
<head>
<meta charset="UTF-8">
<script src="/echarts.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden}
#chart{width:100%;height:100%}
</style>
</head>
<body>
<div id="chart"></div>
<script>
(function init() {
  if (typeof echarts === 'undefined') { setTimeout(init, 50); return; }
  var chart = echarts.init(document.getElementById('chart'));
  chart.setOption(${JSON.stringify(option)});
  window.addEventListener('resize', function() { chart.resize(); });
})();
</script>
</body>
</html>`;

  return html;
}

function aggregateForChart(
  records: Record<string, unknown>[],
  dimension: string,
  metric: string,
): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const r of records) {
    const key = String(r[dimension] || 'unknown');
    const value = Number(r[metric] || 0);
    agg[key] = (agg[key] || 0) + value;
  }
  // Sort by value descending (bar charts), keep order for time series
  if (dimension !== 'month') {
    return Object.fromEntries(Object.entries(agg).sort(([, a], [, b]) => b - a));
  }
  return agg;
}

function buildEchartsOption(
  chartType: string,
  title: string,
  labels: string[],
  values: number[],
  metricLabel: string,
  dimLabel: string,
): Record<string, unknown> {
  const bluePalette = [
    '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE',
    '#1D4ED8', '#1E40AF', '#6366F1', '#818CF8', '#A5B4FC',
  ];

  const baseOption = {
    title: {
      text: title,
      left: 'center',
      top: 12,
      textStyle: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
    },
    color: bluePalette,
    tooltip: { trigger: 'axis' as const },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '18%', containLabel: true },
  };

  switch (chartType) {
    case 'bar':
      return {
        ...baseOption,
        tooltip: { trigger: 'axis' as const },
        xAxis: { type: 'value' as const },
        yAxis: {
          type: 'category' as const,
          data: labels,
          inverse: true,
          axisLabel: { fontSize: 11 },
        },
        series: [{
          type: 'bar' as const,
          data: values,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 11 },
        }],
      };

    case 'line':
      return {
        ...baseOption,
        tooltip: { trigger: 'axis' as const },
        xAxis: { type: 'category' as const, data: labels, boundaryGap: false },
        yAxis: { type: 'value' as const, name: metricLabel },
        series: [{
          type: 'line' as const,
          data: values,
          smooth: true,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#2563EB' },
        }],
      };

    case 'pie':
      return {
        ...baseOption,
        tooltip: { trigger: 'item' as const },
        series: [{
          type: 'pie' as const,
          radius: ['35%', '65%'],
          center: ['50%', '55%'],
          data: labels.map((name, i) => ({ name, value: values[i] })),
          label: { formatter: '{b}: {c}' },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' },
          },
        }],
      };

    default:
      // Fallback to bar
      return {
        ...baseOption,
        xAxis: { type: 'category' as const, data: labels },
        yAxis: { type: 'value' as const, name: metricLabel },
        series: [{ type: 'bar' as const, data: values }],
      };
  }
}
