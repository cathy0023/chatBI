import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { generateObject } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';
import { SALES_COLUMN_META, getColumnLabel } from '@/types/database';

// Input: records + original query
const analysisInputSchema = z.object({
  query: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())).min(1),
});

// Output: structured analysis
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
    // Compute FULL statistics from all records - no sampling
    const stats = this.computeFullStats(input.records);

    // Build prompt with comprehensive statistics (not sample rows)
    const prompt = this.buildPrompt(input.query, stats);

    const { object } = await generateObject({
      model: getDefaultModel(),
      schema: analysisOutputSchema,
      prompt,
    });

    // Merge server-computed stats into dataSummary
    return {
      ...object,
      dataSummary: {
        ...stats,
        ...object.dataSummary,
      },
    };
  }

  private computeFullStats(records: Record<string, unknown>[]) {
    const departments: Record<string, { count: number; deal: number }> = {};
    const months: Record<string, { deal: number; wechat: number; interaction: number; demand: number; count: number }> = {};
    const persons: Record<string, { deal: number; count: number }> = {};
    let totalDeal = 0, totalWechat = 0, totalInteraction = 0, totalDemand = 0;

    for (const r of records) {
      const dept = String(r.department || 'unknown');
      const month = String(r.month || 'unknown');
      const name = String(r.name || 'unknown');
      const deal = Number(r.deal || 0);
      const wechat = Number(r.wechat_added || 0);
      const interaction = Number(r.interaction || 0);
      const demand = Number(r.demand || 0);

      // Department aggregation
      if (!departments[dept]) departments[dept] = { count: 0, deal: 0 };
      departments[dept].count++;
      departments[dept].deal += deal;

      // Month aggregation
      if (!months[month]) months[month] = { deal: 0, wechat: 0, interaction: 0, demand: 0, count: 0 };
      months[month].deal += deal;
      months[month].wechat += wechat;
      months[month].interaction += interaction;
      months[month].demand += demand;
      months[month].count++;

      // Person aggregation (for top performers)
      if (!persons[name]) persons[name] = { deal: 0, count: 0 };
      persons[name].deal += deal;
      persons[name].count++;

      totalDeal += deal;
      totalWechat += wechat;
      totalInteraction += interaction;
      totalDemand += demand;
    }

    // Top 5 performers
    const topPerformers = Object.entries(persons)
      .sort(([, a], [, b]) => b.deal - a.deal)
      .slice(0, 5)
      .map(([name, stats]) => ({ name, deal: stats.deal }));

    // Top 5 departments by deal
    const topDepts = Object.entries(departments)
      .sort(([, a], [, b]) => b.deal - a.deal)
      .slice(0, 5)
      .map(([dept, stats]) => ({ department: dept, deal: stats.deal, count: stats.count }));

    // Per-month TOP5 performers — preserves monthly grouping for ranking queries
    const monthlyTopPerformers: Record<string, Array<{name: string; deal: number}>> = {};
    for (const r of records) {
      const m = String(r.month || '');
      if (!monthlyTopPerformers[m]) monthlyTopPerformers[m] = [];
      monthlyTopPerformers[m].push({ name: String(r.name || ''), deal: Number(r.deal || 0) });
    }
    for (const month of Object.keys(monthlyTopPerformers)) {
      monthlyTopPerformers[month] = monthlyTopPerformers[month]
        .sort((a, b) => b.deal - a.deal)
        .slice(0, 5);
    }

    return {
      totalCount: records.length,
      totalDeal,
      totalWechat,
      totalInteraction,
      totalDemand,
      months,
      departments,
      topPerformers,
      topDepts,
      monthlyTopPerformers,
      monthCount: Object.keys(months).length,
      deptCount: Object.keys(departments).length,
      personCount: Object.keys(persons).length,
    };
  }

  private buildPrompt(query: string, stats: ReturnType<typeof this.computeFullStats>): string {
    // Format month breakdown - use column labels from schema
    const monthLines = Object.entries(stats.months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) =>
        `${month}: ${getColumnLabel('deal')}=${m.deal}, ${getColumnLabel('wechat_added')}=${m.wechat}, ${getColumnLabel('interaction')}=${m.interaction}, ${getColumnLabel('demand')}=${m.demand}, 人数=${m.count}`
      ).join('\n');

    const topPerformerLines = stats.topPerformers
      .map((p, i) => `${i + 1}. ${p.name}: ${p.deal}单`)
      .join('\n');

    return `你是在线教育公司的销售数据分析专家。

数据分析结果（基于全量数据，无遗漏）:

用户问题: "${query}"

【总体概况】
- 数据总条数: ${stats.totalCount}
- 覆盖月份: ${stats.monthCount}个 (${Object.keys(stats.months).sort().join(', ')})
- 覆盖部门: ${stats.deptCount}个
- 覆盖人员: ${stats.personCount}人
- 总成交: ${stats.totalDeal}单
- 总加微: ${stats.totalWechat}人
- 总互动: ${stats.totalInteraction}次
- 总需求: ${stats.totalDemand}个

【按月份统计】
${monthLines}

【成交TOP5人员（全局）】
${topPerformerLines}

【各月TOP5成交人员】
${Object.entries(stats.monthlyTopPerformers)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([month, performers]) =>
    `${month}: ${performers.map((p, i) => `${i + 1}.${p.name}(${p.deal}单)`).join(' ')}`
  ).join('\n')}

请基于以上全量统计数据，生成分析摘要和关键洞察。不要遗漏任何月份。如果用户问各月排名/TOP，必须用【各月TOP5成交人员】数据逐月回答。`;
  }
}