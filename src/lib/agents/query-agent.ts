import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { generateText } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';
import { hybridSearch, keywordSearch, type SearchResult } from '@/lib/search/hybrid-search';
import { getSopRecordsByCategory, getSopRecordById } from '@/lib/db/queries';
import { searchSalesByParams, extractQueryParams } from '@/lib/db/queries-sales';
import type { SopCategory } from '@/types/database';

// ==================== LLM Query Understanding ====================

const VALID_METRICS = ['wechat_added', 'interaction', 'demand', 'deal'] as const;
type MetricValue = typeof VALID_METRICS[number];

// Use z.string for metric to avoid enum parse failure with "null" strings
const queryUnderstandingSchema = z.object({
  name: z.string().nullable().describe('销售人员姓名，如"武莹""李明"。未提到则 null'),
  department: z.string().nullable().describe('部门/校区名称，如"花园桥校区"。未提到则 null'),
  month: z.string().nullable().describe('月份，标准化为"7月""8月""9月""10月"。无法确定则 null'),
  metric: z.string().nullable()
    .describe('关注的指标。加微/加微信→wechat_added, 互动/企微→interaction, 需求/有意向→demand, 成交/销量→deal'),
  metricMinValue: z.number().nullable()
    .describe('指标最小值。"有没有成交"→1, "成交了3单以上"→3。无阈值则 null'),
  isRanking: z.boolean().describe('是否在问排行榜/排名/谁最好/谁最多'),
  isSummary: z.boolean().describe('是否在问汇总/概览/各部门/各月/整体情况'),
});

type LLMQueryParams = z.infer<typeof queryUnderstandingSchema>;

// Parse JSON from generateText response, stripping markdown code blocks
function parseQueryResult(text: string): LLMQueryParams {
  const jsonStr = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
  const raw = JSON.parse(jsonStr);
  return {
    name: raw.name === 'null' ? null : (raw.name || null),
    department: raw.department === 'null' ? null : (raw.department || null),
    month: raw.month === 'null' ? null : (raw.month || null),
    metric: raw.metric === 'null' ? null : (VALID_METRICS.includes(raw.metric as MetricValue) ? raw.metric : null),
    metricMinValue: raw.metricMinValue === 'null' ? null : (raw.metricMinValue != null ? Number(raw.metricMinValue) : null),
    isRanking: Boolean(raw.isRanking),
    isSummary: Boolean(raw.isSummary),
  };
}

const QUERY_UNDERSTANDING_PROMPT = `你是一个数据库查询参数提取器。

数据库表 sales_performance 的字段:
- name: 销售人员姓名
- department: 部门/校区名称
- month: 月份（有效值为"7月""8月""9月""10月"）
- wechat_added: 加微信数量
- interaction: 企微互动次数
- demand: 有需求数量
- deal: 成交数量

从用户问题中提取查询参数:
1. 人名精确匹配（"武莹"不是"武"）
2. 月份标准化（"九月"→"9月"，"9月份"→"9月"，无法确定→null）
3. "有没有成交"→ metric="deal", metricMinValue=1
4. "排行榜""排名""谁最好""谁最多""top"→ isRanking=true
5. "汇总""各部门""概览""各月""整体"→ isSummary=true
6. 没有提到的字段设为 null

只返回以下7个字段的JSON：name, department, month, metric, metricMinValue, isRanking, isSummary。只输出JSON，不要其他内容。

用户问题: "{query}"`;

// ==================== Agent Schemas ====================

// Input
const queryInputSchema = z.object({
  query: z.string().min(1),
  category: z.enum(['script', 'kpi', 'case', 'training']).optional(),
  recordId: z.string().optional(),
  searchType: z.enum(['hybrid', 'keyword', 'category', 'id', 'sales']).default('sales'),
});

// Output
const queryOutputSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  totalCount: z.number(),
  query: z.string(),
  searchType: z.string(),
  confidence: z.number().min(0).max(1),
});

type QueryInput = z.infer<typeof queryInputSchema>;
type QueryOutput = z.infer<typeof queryOutputSchema>;

export class QueryAgent extends BaseAgent<QueryInput, QueryOutput> {
  readonly name = 'Query Agent';
  readonly inputSchema = queryInputSchema;
  readonly outputSchema = queryOutputSchema;

  protected async run(input: QueryInput): Promise<QueryOutput> {
    // Sales search — LLM-driven query understanding
    if (input.searchType === 'sales') {
      const result = await generateText({
        model: getDefaultModel(),
        prompt: QUERY_UNDERSTANDING_PROMPT.replace('{query}', input.query),
      });

      let params = parseQueryResult(result.text);

      // Fallback to keyword extraction if LLM returns all-null params
      if (!params.name && !params.department && !params.month && !params.metric && !params.isRanking && !params.isSummary) {
        const keywordParams = extractQueryParams(input.query);
        params = {
          name: keywordParams.name || null,
          department: keywordParams.department || null,
          month: keywordParams.month || null,
          metric: keywordParams.metric || null,
          metricMinValue: keywordParams.metricMinValue || null,
          isRanking: keywordParams.isRanking,
          isSummary: keywordParams.isSummary,
        };
      }

      const records = searchSalesByParams(params);
      return {
        records: records.map(r => ({ ...r })),
        totalCount: records.length,
        query: input.query,
        searchType: 'sales',
        confidence: records.length > 0 ? Math.min(0.6 + records.length * 0.02, 0.95) : 0,
      };
    }

    // Legacy SOP search
    let result: SearchResult;

    switch (input.searchType) {
      case 'id': {
        const record = getSopRecordById(input.recordId || '');
        result = {
          records: record ? [record] : [],
          totalCount: record ? 1 : 0,
          confidence: record ? 1 : 0,
        };
        break;
      }
      case 'category': {
        const records = getSopRecordsByCategory(input.category as SopCategory);
        result = {
          records,
          totalCount: records.length,
          confidence: 0.8,
        };
        break;
      }
      case 'keyword': {
        result = keywordSearch(input.query, input.category);
        break;
      }
      case 'hybrid':
      default: {
        result = hybridSearch(input.query, input.category);
        break;
      }
    }

    return {
      records: result.records.map(r => ({
        ...r,
        tags: JSON.stringify(r.tags),
        metadata: JSON.stringify(r.metadata),
      })),
      totalCount: result.totalCount,
      query: input.query,
      searchType: input.searchType,
      confidence: result.confidence,
    };
  }
}
