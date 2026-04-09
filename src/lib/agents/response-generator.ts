import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { generateObject } from 'ai';
import { getDefaultModel } from '@/lib/llm/provider';
import { getColumnLabel } from '@/types/database';

// Input: query + records (optionally analysis result)
const responseInputSchema = z.object({
  query: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())),
  analysis: z.object({
    summary: z.string(),
    insights: z.array(z.string()),
    suggestedChartType: z.string().optional(),
  }).optional(),
});

// Output: natural language reply + recommended chart type
const responseOutputSchema = z.object({
  text: z.string().describe('给用户的自然语言回复，中文，简洁有温度'),
  uiType: z.enum(['table', 'bar', 'pie', 'line', 'radar']).describe('推荐图表类型'),
});

type ResponseInput = z.infer<typeof responseInputSchema>;
type ResponseOutput = z.infer<typeof responseOutputSchema>;

export class ResponseGenerator extends BaseAgent<ResponseInput, ResponseOutput> {
  readonly name = 'Response Generator';
  readonly inputSchema = responseInputSchema;
  readonly outputSchema = responseOutputSchema;

  protected async run(input: ResponseInput): Promise<ResponseOutput> {
    // Compute FULL statistics - no sampling
    const stats = this.computeStats(input.records);

    const prompt = this.buildPrompt(input.query, stats, input.analysis);

    const { object } = await generateObject({
      model: getDefaultModel(),
      schema: responseOutputSchema,
      prompt,
    });

    return object;
  }

  private computeStats(records: Record<string, unknown>[]) {
    let totalDeal = 0, totalWechat = 0, totalInteraction = 0, totalDemand = 0;
    const monthStats: Record<string, { deal: number; count: number }> = {};
    const deptStats: Record<string, { deal: number; count: number }> = {};
    const personStats: Record<string, { deal: number }> = {};

    for (const r of records) {
      const deal = Number(r.deal || 0);
      const wechat = Number(r.wechat_added || 0);
      const interaction = Number(r.interaction || 0);
      const demand = Number(r.demand || 0);
      const month = String(r.month || '');
      const dept = String(r.department || '');
      const name = String(r.name || '');

      totalDeal += deal;
      totalWechat += wechat;
      totalInteraction += interaction;
      totalDemand += demand;

      if (month) {
        if (!monthStats[month]) monthStats[month] = { deal: 0, count: 0 };
        monthStats[month].deal += deal;
        monthStats[month].count++;
      }
      if (dept) {
        if (!deptStats[dept]) deptStats[dept] = { deal: 0, count: 0 };
        deptStats[dept].deal += deal;
        deptStats[dept].count++;
      }
      if (name) {
        if (!personStats[name]) personStats[name] = { deal: 0 };
        personStats[name].deal += deal;
      }
    }

    // Sort months chronologically
    const monthTotals = Object.entries(monthStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {} as typeof monthStats);

    // Top performers
    const topPersons = Object.entries(personStats)
      .sort(([, a], [, b]) => b.deal - a.deal)
      .slice(0, 5)
      .map(([name, s]) => ({ name, deal: s.deal }));

    // Per-month TOP5 — preserves monthly grouping for ranking queries
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
      monthStats: monthTotals,
      deptStats,
      topPersons,
      monthlyTopPerformers,
      monthCount: Object.keys(monthStats).length,
      deptCount: Object.keys(deptStats).length,
      personCount: Object.keys(personStats).length,
    };
  }

  private buildPrompt(
    query: string,
    stats: ReturnType<typeof this.computeStats>,
    analysis?: ResponseInput['analysis'],
  ): string {
    const monthLines = Object.entries(stats.monthStats)
      .map(([month, s]) => `${month}: ${s.deal}单 (${s.count}人)`)
      .join('\n');

    const topPersonLines = stats.topPersons
      .map((p, i) => `${i + 1}. ${p.name}: ${p.deal}单`)
      .join('\n');

    const perMonthTopLines = Object.entries(stats.monthlyTopPerformers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, performers]) =>
        `${month}: ${performers.map((p, i) => `${i + 1}.${p.name}(${p.deal}单)`).join(' ')}`
      ).join('\n');

    const analysisSection = analysis
      ? `\n【分析摘要】\n${analysis.summary}\n\n【关键洞察】\n${analysis.insights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
      : '';

    return `你是销售数据助手，基于全量统计数据回答用户问题。

用户问题: "${query}"

【全量统计结果】
- 数据总条数: ${stats.totalCount}
- 覆盖月份: ${stats.monthCount}个
- 覆盖部门: ${stats.deptCount}个
- 覆盖人员: ${stats.personCount}人
- 总${getColumnLabel('deal')}: ${stats.totalDeal}
- 总${getColumnLabel('wechat_added')}: ${stats.totalWechat}
- 总${getColumnLabel('interaction')}: ${stats.totalInteraction}
- 总${getColumnLabel('demand')}: ${stats.totalDemand}

【按月份成交】
${monthLines}

【成交TOP5人员（全局）】
${topPersonLines}

【各月TOP5成交人员】
${perMonthTopLines}
${analysisSection}

回答规则:
1. 直接回答问题，不要说"为您找到N条结果"
2. 用具体数据说话，基于以上统计（不是样本）
3. 如果用户问各月排名/TOP/前几名，必须用【各月TOP5成交人员】数据逐月回答，不要说"无法拆分"
4. 推荐图表类型: 单人多月→line, 多人对比→bar, 占比→pie, 各月排行→table, 明细→table
5. 中文回复，简洁专业`;
  }
}