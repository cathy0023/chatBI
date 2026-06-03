import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { generateChartCode } from '@/lib/chart/code-generator';
import type { ToolContext } from '../types';

const inputSchema = z.object({
  chartType: z.enum(['bar', 'line', 'pie', 'radar', 'scatter']).describe('图表类型'),
  dimension: z.string().describe('X轴维度字段，如"name"、"month"、"department"'),
  metric: z.string().describe('Y轴指标字段，如"deal"、"interaction"'),
});

export function createChartTool(ctx: ToolContext) {
  const isEmbedded = ctx.dataSource === 'embedded';
  const description = isEmbedded
    ? '生成数据可视化图表（柱状图、折线图、饼图等）。数据已直接提供，直接调用即可。'
    : '生成数据可视化图表（柱状图、折线图、饼图等）。需要先通过 queryTool 获取数据。';

  return tool({
    description,
    inputSchema: zodSchema(inputSchema),
    execute: async (params) => {
      if (ctx.data.length === 0) {
        return { error: '暂无数据，无法生成图表。' };
      }

      try {
        // 嵌入模式：用实际列名 + 标签生成图表
        if (isEmbedded) {
          const result = await generateChartCodeGeneric(ctx.originalQuery, ctx.data, ctx.columns, ctx.labels);
          if (result) {
            ctx.chartHtml = result.html;
            ctx.chartOption = result.option;
            return { generated: true, chartType: params.chartType };
          }
        } else {
          const html = await generateChartCode(ctx.originalQuery, ctx.data, ctx.columns);
          if (html) {
            ctx.chartHtml = html;
            return { generated: true, chartType: params.chartType };
          }
        }
        return { error: '图表生成返回空结果' };
      } catch (err) {
        return { error: err instanceof Error ? err.message : '图表生成失败' };
      }
    },
  });
}

/**
 * 将 MGV 传来的值解析为数字。
 * 处理：数字直接返回、百分比字符串 "33.33%" → 33.33、纯数字字符串 → parseFloat、"-" → NaN
 */
function parseNumeric(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  if (v === '-' || v === '' || v === 'N/A' || v === '--') return NaN;
  const s = v.replace(/%$/, '').replace(/,/g, '').trim();
  return parseFloat(s);
}

/**
 * 计算列标签与用户查询的匹配度 (0~1)
 * 精确包含 → 1.0，否则按中文字符重叠度打分
 */
function columnMatchScore(query: string, label: string): number {
  if (label.length < 2) return 0;
  if (query.includes(label)) return 1.0;
  const labelChars = [...new Set([...label].filter(c => /[\u4e00-\u9fa5]/.test(c)))];
  if (labelChars.length === 0) return 0;
  const hit = labelChars.filter(c => query.includes(c)).length;
  return hit / labelChars.length;
}

/** 嵌入模式图表生成：支持任意列名，用中文标签做轴标题 */
async function generateChartCodeGeneric(
  query: string,
  records: Record<string, unknown>[],
  columns: string[],
  labels: string[],
): Promise<{ html: string; option: Record<string, unknown> } | null> {
  if (records.length === 0) return null;

  // 构建标签映射
  const labelMap: Record<string, string> = {};
  for (let i = 0; i < columns.length; i++) {
    labelMap[columns[i]] = labels[i] || columns[i];
  }

  // 找维度列（name / tree_name）
  const dimensionCol = columns.find(c => c === 'name' || c === 'tree_name') || 'name';

  // 找数值列（排除 name/tree_name，取有非零值的 — 兼容百分比字符串 "33.33%"）
  const numericCols = columns.filter(col => {
    if (col === dimensionCol) return false;
    return records.some(r => {
      const n = parseNumeric(r[col]);
      return !isNaN(n) && n !== 0;
    });
  });

  if (numericCols.length === 0) return null;

  // 从 query 推断目标指标列（模糊匹配：支持 "深度沟通" → "深入沟通占比"）
  let targetCol = numericCols[0];
  let bestScore = 0;
  for (const col of numericCols) {
    const label = labelMap[col] || '';
    const score = columnMatchScore(query, label);
    if (score > bestScore) {
      bestScore = score;
      targetCol = col;
    }
  }

  // 按 dimension 聚合 targetCol
  const agg: Record<string, number> = {};
  for (const r of records) {
    const key = String(r[dimensionCol] || '其他').trim() || '其他';
    const val = parseNumeric(r[targetCol]);
    if (!isNaN(val) && val !== 0) {
      agg[key] = (agg[key] || 0) + val;
    }
  }

  const sorted = Object.entries(agg).sort(([, a], [, b]) => b - a).slice(0, 15);
  if (sorted.length === 0) return null;

  const chartLabels = sorted.map(([k]) => k);
  const chartValues = sorted.map(([, v]) => v);
  const metricLabel = labelMap[targetCol] || targetCol;

  // 检测图表类型
  let chartType = 'bar';
  if (/饼图|占比|比例|百分比|分布/.test(query)) chartType = 'pie';
  else if (/折线|趋势|走势/.test(query)) chartType = 'line';

  const option = buildGenericEchartsOption(chartType, query, chartLabels, chartValues, metricLabel);
  return { html: renderChartHtml(option), option };
}

function buildGenericEchartsOption(
  chartType: string,
  title: string,
  labels: string[],
  values: number[],
  metricLabel: string,
): Record<string, unknown> {
  const baseOption = {
    title: { text: title, left: 'center', top: 12, textStyle: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' } },
    color: ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#1D4ED8', '#1E40AF', '#6366F1'],
    tooltip: { trigger: 'axis' as const },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '18%', containLabel: true },
  };

  if (chartType === 'pie') {
    return {
      ...baseOption,
      tooltip: { trigger: 'item' as const },
      series: [{
        type: 'pie' as const, radius: ['35%', '65%'], center: ['50%', '55%'],
        data: labels.map((name, i) => ({ name, value: values[i] })),
        label: { formatter: '{b}: {c}' },
      }],
    };
  }

  if (chartType === 'line') {
    return {
      ...baseOption,
      xAxis: { type: 'category' as const, data: labels, boundaryGap: false },
      yAxis: { type: 'value' as const, name: metricLabel },
      series: [{ type: 'line' as const, data: values, smooth: true, areaStyle: { opacity: 0.15 } }],
    };
  }

  // bar (default)
  return {
    ...baseOption,
    grid: { left: '3%', right: '8%', bottom: '3%', top: '18%', containLabel: true },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: labels, inverse: true, axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: values,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
    }],
  };
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
