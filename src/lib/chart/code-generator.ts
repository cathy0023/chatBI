import { recommendChart } from '@/lib/agents/chart-recommender';
import { getColumnLabel } from '@/types/database';

/**
 * Resolve metric value from a record.
 * When SQL uses aggregates like SUM(deal), the column name is 'SUM(deal)' not 'deal'.
 * This function tries exact match first, then falls back to a column containing the metric name.
 */
function resolveMetricValue(record: Record<string, unknown>, metric: string): number {
  // Exact match
  if (metric in record) return Number(record[metric]) || 0;
  // Fuzzy match: find a column containing the metric name (e.g., 'SUM(deal)' contains 'deal')
  for (const key of Object.keys(record)) {
    if (key.includes(metric)) return Number(record[key]) || 0;
  }
  return 0;
}

/**
 * Resolve dimension value from a record.
 * Similar to resolveMetricValue but for dimension columns.
 */
function resolveDimensionValue(record: Record<string, unknown>, dimension: string): string {
  if (dimension in record) {
    const val = record[dimension];
    return val != null && String(val).trim() !== '' ? String(val) : '其他';
  }
  for (const key of Object.keys(record)) {
    if (key.includes(dimension)) {
      const val = record[key];
      return val != null && String(val).trim() !== '' ? String(val) : '其他';
    }
  }
  return '其他';
}

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
  const title = query;
  const metricLabel = getColumnLabel(metric);
  const dimLabel = getColumnLabel(dimension);

  // Detect multi-series data (e.g., UNION ALL results: individual vs overall)
  if (isMultiSeries(records)) {
    const multiChartType = uiType === 'pie' || uiType === 'table' ? 'line' : uiType;
    const option = buildMultiSeriesOption(records, title, metric, metricLabel, multiChartType);
    return renderChartHtml(option);
  }

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

  const option = buildEchartsOption(chartType, title, labels, values, metricLabel, dimLabel);
  return renderChartHtml(option);
}

function renderChartHtml(option: Record<string, unknown>): string {
  return `<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
  var dpr = window.devicePixelRatio || 1;
  var chart = echarts.init(document.getElementById('chart'), null, {
    renderer: 'canvas',
    devicePixelRatio: dpr
  });
  chart.setOption(${JSON.stringify(option)});
  window.addEventListener('resize', function() { chart.resize(); });
})();
</script>
</body>
</html>`;
}

/** Detect multi-series data: records with multiple name values across multiple months */
function isMultiSeries(records: Record<string, unknown>[]): boolean {
  if (records.length < 2) return false;
  // Scan ALL records for columns, not just the first one
  // (merged data from multiple queryTool calls may have inconsistent columns)
  const allKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) allKeys.add(k);
  }
  if (!allKeys.has('month') || !allKeys.has('name')) return false;
  const names = new Set(records.map(r => String(r.name || '')));
  const months = new Set(records.map(r => String(r.month || '')));
  return names.size >= 2 && months.size >= 2;
}

/** Sort months numerically: 7月, 8月, 9月, 10月 (not alphabetical: 10月, 7月...) */
function sortMonths(months: string[]): string[] {
  return [...months].sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
}

/** Build multi-series chart option (e.g., individual vs overall comparison) */
function buildMultiSeriesOption(
  records: Record<string, unknown>[],
  title: string,
  metric: string,
  metricLabel: string,
  chartType: string,
): Record<string, unknown> {
  const byName: Record<string, Record<string, number>> = {};
  const allMonths = new Set<string>();

  for (const r of records) {
    const name = String(r.name || '');
    const month = String(r.month || '');
    const value = resolveMetricValue(r, metric);
    allMonths.add(month);
    if (!byName[name]) byName[name] = {};
    byName[name][month] = (byName[name][month] || 0) + value;
  }

  const months = sortMonths([...allMonths]);
  const colors = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6'];
  const resolvedType = chartType === 'line' ? 'line' : 'bar';

  const series = Object.entries(byName).map(([name, monthData], i) => ({
    name,
    type: resolvedType as 'line' | 'bar',
    data: months.map(m => monthData[m] || 0),
    ...(resolvedType === 'line' ? { smooth: true, areaStyle: { opacity: 0.08 } } : {}),
    itemStyle: { color: colors[i % colors.length] },
  }));

  return {
    title: {
      text: title,
      left: 'center',
      top: 12,
      textStyle: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
    },
    color: colors,
    tooltip: { trigger: 'axis' as const },
    legend: { bottom: 10, textStyle: { fontSize: 12 } },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '18%', containLabel: true },
    xAxis: { type: 'category' as const, data: months, boundaryGap: false },
    yAxis: { type: 'value' as const, name: metricLabel },
    series,
  };
}

function aggregateForChart(
  records: Record<string, unknown>[],
  dimension: string,
  metric: string,
): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const r of records) {
    const key = resolveDimensionValue(r, dimension);
    const value = resolveMetricValue(r, metric);
    agg[key] = (agg[key] || 0) + value;
  }
  // Sort by value descending (bar charts), numerically for months
  if (dimension === 'month') {
    const sorted = Object.entries(agg).sort(([a], [b]) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
    return Object.fromEntries(sorted);
  }
  // Filter out zero-value entries and limit to top 15
  const filtered = Object.entries(agg)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);
  return Object.fromEntries(filtered);
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
    case 'bar': {
      const visibleCount = Math.min(10, labels.length);
      return {
        ...baseOption,
        grid: { left: '3%', right: '8%', bottom: '3%', top: '18%', containLabel: true },
        tooltip: { trigger: 'axis' as const },
        xAxis: { type: 'value' as const },
        yAxis: {
          type: 'category' as const,
          data: labels,
          inverse: true,
          axisLabel: { fontSize: 11 },
        },
        dataZoom: labels.length > visibleCount ? [
          {
            type: 'inside' as const,
            yAxisIndex: 0,
            startValue: 0,
            endValue: visibleCount - 1,
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
          },
          {
            type: 'slider' as const,
            yAxisIndex: 0,
            right: 4,
            width: 8,
            startValue: 0,
            endValue: visibleCount - 1,
          },
        ] : [],
        series: [{
          type: 'bar' as const,
          data: values,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 11 },
        }],
      };
    }

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
