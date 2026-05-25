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
        return { analysis: '暂无数据可供分析，请先使用 queryTool 查询数据。' };
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
      // Return analysis as tool result — the LLM will incorporate it into
      // the final response text, avoiding duplicate `text` SSE events that
      // cause the UI to flicker.

      return { analysis };
    },
  });
}
