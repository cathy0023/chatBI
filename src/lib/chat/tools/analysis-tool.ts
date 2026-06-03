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

  // === 维度预过滤：检测 query 提到的 month/department ===
  const filteredData = preFilterByDimensions(query, data);

  // 找到所有数值列及其统计（兼容百分比字符串 "33.33%"）
  const numericCols = columns.filter(col => {
    return filteredData.some(r => { const n = parseNumeric(r[col]); return !isNaN(n) && n !== 0; });
  });

  const summaryParts: string[] = [];
  for (const col of numericCols.slice(0, 8)) {
    const values = filteredData.map(r => parseNumeric(r[col])).filter(v => !isNaN(v) && v !== 0);
    if (values.length === 0) continue;
    const label = labelMap[col] || col;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = (sum / values.length).toFixed(2);
    const max = Math.max(...values);
    const min = Math.min(...values);
    summaryParts.push(`${label}: ${values.length}条有值, 合计${sum.toFixed(2)}, 均值${avg}, 最大${max}, 最小${min}`);
  }

  // 找到 query 提及的列（模糊匹配：支持 "深度沟通" → "深入沟通占比"）
  const mentionedCols = numericCols.filter(col => {
    const label = labelMap[col] || '';
    return columnMatchScore(query, label) > 0.3;
  });

  // === 智能聚合维度选择：检测 query 要按哪个维度分组 ===
  const groupDim = detectGroupDimension(query, filteredData);
  let detailText = '';

  if (mentionedCols.length > 0) {
    for (const col of mentionedCols) {
      const label = labelMap[col] || col;
      // 按检测到的维度汇总（已过滤的数据集）
      const grouped: Record<string, number> = {};
      for (const r of filteredData) {
        const key = groupDim ? String(r[groupDim] || '其他') : String(r.name || r.tree_name || '其他');
        const val = parseNumeric(r[col]);
        if (!isNaN(val) && val !== 0) {
          grouped[key] = (grouped[key] || 0) + val;
        }
      }
      const sorted = Object.entries(grouped).sort(([, a], [, b]) => b - a).slice(0, 20);
      if (sorted.length > 0) {
        const groupLabel = groupDim ? (labelMap[groupDim] || groupDim) : '人员';
        detailText += `\n\n【${label}】按${groupLabel}汇总:\n`;
        detailText += sorted.map(([k, v]) => `- ${k}: ${v}`).join('\n');
        detailText += `\n合计: ${sorted.reduce((s, [, v]) => s + v, 0).toFixed(2)}`;
      } else {
        detailText += `\n\n【${label}】所有值均为 0。`;
      }
    }
  }

  // 非 0 数值列总览（使用过滤后的数据）
  const uniquePeople = new Set(filteredData.map(r => String(r.name || r.tree_name || '')).filter(Boolean)).size;
  const overview = summaryParts.length > 0
    ? `数据概览（共${filteredData.length}条记录, ${uniquePeople}人, ${numericCols.length}个数值列）:\n${summaryParts.join('\n')}`
    : `共${filteredData.length}条记录，所有数值列均为0。`;

  const filterNote = filteredData.length !== data.length
    ? `\n（已根据问题中的维度过滤：${filteredData.length}/${data.length} 条记录）\n`
    : '';

  // 漏斗/总量类问题：明确提示使用合计而非均值
  const isFunnelQuery = /(漏斗|转化|总.*?成交|总.*?互动|总.*?加微|总.*?需求|合计|总和)/.test(query);
  const usageHint = isFunnelQuery
    ? '\n（用户询问"总/漏斗/转化"相关问题，请使用【合计】值而非均值）\n'
    : '';

  const result = await generateTextCompat({
    system: '你是数据分析顾问。根据统计数据提供有洞察力的分析。',
    prompt: `用户问题: ${query}${filterNote}${usageHint}\n${overview}${detailText}\n\n规则:\n1. 直接回答用户问题，引用数字必须与统计完全一致\n2. 提供总结、见解和洞察\n3. 如果所有数据都是0，明确指出这一点并建议排查\n4. 控制在200字以内`,
  });

  return { analysis: result.text || `查询到 ${data.length} 条数据。` };
}

/**
 * 检测 query 要按哪个维度分组汇总
 * - "各部门/校区/团队" → 'department'
 * - "每月/各月/月份" → 'month'
 * - "各人/人员/谁" → 'name'
 * - 默认 → null（保持原行为按 name 汇总，用于 Top N）
 */
function detectGroupDimension(query: string, data: Record<string, unknown>[]): 'department' | 'month' | 'name' | null {
  const q = query.toLowerCase();

  // 部门/校区优先（即使 query 中也提了月份）
  if (/(部门|校区|团队|分部|分公司)/.test(q)) return 'department';

  // 月份维度（"每月成交"、"各月对比"）
  if (/(每月|各月|月度|分月|按月)/.test(q)) return 'month';

  // 人员维度（"各人"、"每个人"）
  if (/(各人|每人|员工|销售员|人员)/.test(q)) return 'name';

  return null;
}

/**
 * 维度预过滤：检测 query 提到的月份（如"9月"、"七月"）和部门（如"海淀"）
 * 返回过滤后的数据子集，避免把多月份/多部门数据当累计处理
 */
function preFilterByDimensions(query: string, data: Record<string, unknown>[]): Record<string, unknown>[] {
  let result = data;

  // 1. 月份过滤：检测 "X月"、"X月份"、中文数字月份
  const monthMap: Record<string, string> = {
    '一': '1月', '二': '2月', '三': '3月', '四': '4月', '五': '5月',
    '六': '6月', '七': '7月', '八': '8月', '九': '9月', '十': '10月',
    '十一': '11月', '十二': '12月',
  };
  let monthFilter: string | null = null;
  const monthMatch = query.match(/(\d+)月/) || query.match(/(七|八|九|十|十一|十二)月/);
  if (monthMatch) {
    const m = monthMatch[1];
    monthFilter = /^\d+$/.test(m) ? `${m}月` : monthMap[m] || `${m}月`;
  }
  if (monthFilter) {
    const filtered = result.filter(r => String(r.month || '') === monthFilter);
    if (filtered.length > 0) result = filtered;
  }

  // 2. 部门/校区过滤：检测 query 中提到的校区名片段
  const departments = new Set<string>();
  for (const r of data) {
    const d = String(r.department || '');
    if (d) departments.add(d);
  }
  for (const dept of departments) {
    // 取校区关键部分（如"朝阳"匹配"学习机-朝阳校区"）
    const shortName = dept.split('-').pop()?.replace('校区', '') || '';
    if (shortName.length >= 2 && query.includes(shortName)) {
      const filtered = result.filter(r => String(r.department || '') === dept);
      if (filtered.length > 0) {
        result = filtered;
        break;
      }
    }
  }

  return result;
}
