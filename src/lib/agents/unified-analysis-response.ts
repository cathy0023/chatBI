import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { computeStats, formatStatsPrompt } from './stats-computer';
import { generateObject } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';

// Input: query + records
const unifiedInputSchema = z.object({
  query: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())).min(1),
  needsAnalysis: z.boolean().default(false),
});

// Output: combined analysis + response
const unifiedOutputSchema = z.object({
  text: z.string().describe('给用户的自然语言回复，中文，简洁有温度'),
  uiType: z.enum(['table', 'bar', 'pie', 'line', 'radar']).describe('推荐图表类型'),
  summary: z.string().describe('2-3句中文摘要，概括销售业绩表现'),
  insights: z.array(z.string()).describe('3-5条关键洞察，每条用中文描述'),
  dataSummary: z.record(z.string(), z.unknown()).describe('数据概要统计'),
  suggestedChartType: z.enum([
    'line', 'bar', 'pie', 'radar', 'scatter',
    'heatmap', 'funnel', 'sankey', 'table', 'comparison',
  ]).optional().describe('推荐的可视化图表类型'),
});

type UnifiedInput = z.infer<typeof unifiedInputSchema>;
export type UnifiedOutput = z.infer<typeof unifiedOutputSchema>;

export class UnifiedAnalysisResponse extends BaseAgent<UnifiedInput, UnifiedOutput> {
  readonly name = 'Unified Analysis & Response';
  readonly inputSchema = unifiedInputSchema;
  readonly outputSchema = unifiedOutputSchema;

  protected async run(input: UnifiedInput): Promise<UnifiedOutput> {
    const stats = computeStats(input.records);
    const statsBlock = formatStatsPrompt(stats);
    const prompt = this.buildPrompt(input.query, statsBlock, input.needsAnalysis);

    const { object } = await generateObject({
      model: getDefaultModel(),
      schema: unifiedOutputSchema,
      prompt,
    });

    return {
      ...object,
      dataSummary: { ...stats, ...object.dataSummary },
    };
  }

  private buildPrompt(query: string, statsBlock: string, needsAnalysis: boolean): string {
    const analysisSection = needsAnalysis
      ? `\n请同时提供分析摘要(summary)、关键洞察(insights)和推荐图表类型(suggestedChartType)。`
      : `\nsummary 和 insights 可以简短，重点是准确回答用户问题。`;

    return `你是销售数据助手，基于全量统计数据回答用户问题。

用户问题: "${query}"

${statsBlock}
${analysisSection}

回答规则:
1. 直接回答问题，不要说"为您找到N条结果"
2. 用具体数据说话，基于以上统计（不是样本）
3. 如果用户问各月排名/TOP/前几名，必须用【各月TOP5成交人员】数据逐月回答，不要说"无法拆分"
4. 推荐图表类型: 单人多月→line, 多人对比→bar, 占比→pie, 各月排行→table, 明细→table
5. 中文回复，简洁专业
6. insights 中的 emoji 必须与 uiType 对应: table→📊, bar→📊, pie→🥧, line→📈, radar→🎯`;
  }
}
