import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { computeStats, formatStatsPrompt } from './stats-computer';
import { generateObject } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';

/**
 * Analysis Agent — generates structured analysis from query results.
 * Uses shared StatsComputer for consistency with UnifiedAnalysisResponse.
 *
 * NOTE: This agent is currently NOT used in the main pipeline (message-handler
 * uses UnifiedAnalysisResponse directly). It is retained for potential future
 * use cases where analysis is needed separately from response generation.
 */

const analysisInputSchema = z.object({
  query: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
});

const analysisOutputSchema = z.object({
  summary: z.string().describe('2-3句中文摘要，概括销售业绩表现'),
  insights: z.array(z.string()).describe('3-5条关键洞察，每条用中文描述'),
  dataSummary: z.record(z.string(), z.unknown()).describe('数据概要统计'),
  suggestedChartType: z.enum([
    'line', 'bar', 'pie', 'radar', 'scatter',
    'heatmap', 'funnel', 'sankey', 'table', 'comparison',
  ]).optional().describe('推荐的可视化图表类型'),
});

type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export class AnalysisAgent extends BaseAgent<AnalysisInput, AnalysisOutput> {
  readonly name = 'Analysis Agent';
  readonly inputSchema = analysisInputSchema;
  readonly outputSchema = analysisOutputSchema;

  protected async run(input: AnalysisInput): Promise<AnalysisOutput> {
    const stats = computeStats(input.records);
    const statsBlock = formatStatsPrompt(stats);
    const prompt = this.buildPrompt(input.query, statsBlock);

    const { object } = await generateObject({
      model: getDefaultModel(),
      schema: analysisOutputSchema,
      prompt,
    });

    return {
      ...object,
      dataSummary: { ...stats, ...object.dataSummary },
    };
  }

  private buildPrompt(query: string, statsBlock: string): string {
    return `你是在线教育公司的销售数据分析专家。

用户问题: "${query}"

${statsBlock}

请基于以上全量统计数据，生成分析摘要和关键洞察。不要遗漏任何月份。如果用户问各月排名/TOP，必须用【各月TOP5成交人员】数据逐月回答。`;
  }
}
