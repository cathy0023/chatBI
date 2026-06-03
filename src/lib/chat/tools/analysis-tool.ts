import { z } from 'zod';
import { tool, zodSchema } from 'ai';
import { generateTextCompat } from '@/lib/llm/provider';
import { recommendChart, aggregateBy } from '@/lib/agents/chart-recommender';
import type { ToolContext } from '../types';

export function createAnalysisTool(ctx: ToolContext) {
  const inputSchema = z.object({
    query: z.string().describe('用户原始问题'),
    focus: z.string().optional().describe('分析重点，如"趋势"、"排名"、"对比"'),
  });

  return tool({
    description: '分析销售数据，生成洞察和总结。用于趋势分析、排名对比、异常发现。',
    inputSchema: zodSchema(inputSchema),
    execute: async (params) => {
      const { query } = params;
      const data = ctx.data;

      if (data.length === 0) {
        return { analysis: '暂无数据可供分析。' };
      }

      // 嵌入模式：使用实际列名 + 中文标签，不走 ChatBI 专属 schema
      if (ctx.dataSource === 'embedded') {
        return analyzeEmbeddedData(query, data, ctx.columns, ctx.labels);
      }

      const { dimension, metric } = recommendChart(query, data);
      const aggData = aggregateBy(data, dimension, metric);
      const totalDeal = Object.values(aggData).reduce((s, v) => s + v, 0);
      const statsText = `按"${dimension}"分组的"${metric}"合计:\n${Object.entries(aggData).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n总计: ${totalDeal}`;

      const result = await generateTextCompat({
        system: '你是资深销售数据分析顾问。根据统计数据提供有洞察力的分析。',
        prompt: `用户问题: ${query}\n\n【统计数据】\n${statsText}\n\n规则:\n1. 提供总结、见解和洞察\n2. 指出关键发现：谁表现突出、谁需要关注\n3. 引用的数字必须与统计完全一致\n4. 控制在150字以内`,
      });

      const analysis = result.text || `查询到 ${data.length} 条数据。`;
      return { analysis };
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

/** 嵌入模式分析：用实际列名 + 标签生成数据概览，交给 LLM 分析 */
async function analyzeEmbeddedData(
  query: string,
  data: Record<string, unknown>[],
  columns: string[],
  labels: string[],
): Promise<{ analysis: string }> {
  // 构建列标签映射（colKey → 中文标签）
  const labelMap: Record<string, string> = {};
  for (let i = 0; i < columns.length; i++) {
    labelMap[columns[i]] = labels[i] || columns[i];
  }

  // 找到所有数值列及其统计（兼容百分比字符串 "33.33%"）
  const numericCols = columns.filter(col => {
    return data.some(r => { const n = parseNumeric(r[col]); return !isNaN(n) && n !== 0; });
  });

  const summaryParts: string[] = [];
  for (const col of numericCols.slice(0, 8)) {
    const values = data.map(r => parseNumeric(r[col])).filter(v => !isNaN(v) && v !== 0);
    if (values.length === 0) continue;
    const label = labelMap[col] || col;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = (sum / values.length).toFixed(2);
    const max = Math.max(...values);
    const min = Math.min(...values);
    summaryParts.push(`${label}: ${values.length}人有值, 合计${sum.toFixed(2)}, 均值${avg}, 最大${max}, 最小${min}`);
  }

  // 找到 query 提及的列（模糊匹配：支持 "深度沟通" → "深入沟通占比"）
  const mentionedCols = numericCols.filter(col => {
    const label = labelMap[col] || '';
    return columnMatchScore(query, label) > 0.3;
  });

  // 如果 query 提到了特定列，补充该列的明细
  let detailText = '';
  if (mentionedCols.length > 0) {
    for (const col of mentionedCols) {
      const label = labelMap[col] || col;
      // 按 name 维度汇总
      const byName: Record<string, number> = {};
      for (const r of data) {
        const name = String(r.name || r.tree_name || '其他');
        const val = parseNumeric(r[col]);
        if (!isNaN(val) && val !== 0) {
          byName[name] = (byName[name] || 0) + val;
        }
      }
      const sorted = Object.entries(byName).sort(([, a], [, b]) => b - a).slice(0, 15);
      if (sorted.length > 0) {
        detailText += `\n\n【${label}】按人员分组（前15）:\n`;
        detailText += sorted.map(([k, v]) => `- ${k}: ${v}`).join('\n');
        detailText += `\n合计: ${sorted.reduce((s, [, v]) => s + v, 0).toFixed(2)}`;
      } else {
        detailText += `\n\n【${label}】所有人员的值均为 0。`;
      }
    }
  }

  // 非 0 数值列总览
  const overview = summaryParts.length > 0
    ? `数据概览（共${data.length}条记录, ${numericCols.length}个数值列）:\n${summaryParts.join('\n')}`
    : `共${data.length}条记录，所有数值列均为0。`;

  const result = await generateTextCompat({
    system: '你是数据分析顾问。根据统计数据提供有洞察力的分析。',
    prompt: `用户问题: ${query}\n\n${overview}${detailText}\n\n规则:\n1. 直接回答用户问题，引用数字必须与统计完全一致\n2. 提供总结、见解和洞察\n3. 如果所有数据都是0，明确指出这一点并建议排查\n4. 控制在200字以内`,
  });

  return { analysis: result.text || `查询到 ${data.length} 条数据。` };
}
