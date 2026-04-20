import { getColumnLabel } from '@/types/database';
import { TOP_N_PERFORMERS } from './constants';

/**
 * Shared statistics computation — single source of truth for all agent analytics.
 * Eliminates the ~120-line duplication between AnalysisAgent and UnifiedAnalysisResponse.
 */

export interface StatsResult {
  totalCount: number;
  totalDeal: number;
  totalWechat: number;
  totalInteraction: number;
  totalDemand: number;
  months: Record<string, MonthStats>;
  departments: Record<string, DeptStats>;
  persons: Record<string, PersonStats>;
  topPerformers: Array<{ name: string; deal: number }>;
  topDepts: Array<{ department: string; deal: number; count: number }>;
  monthlyTopPerformers: Record<string, Array<{ name: string; deal: number }>>;
  monthCount: number;
  deptCount: number;
  personCount: number;
}

export interface MonthStats {
  deal: number;
  wechat: number;
  interaction: number;
  demand: number;
  count: number;
}

export interface DeptStats {
  count: number;
  deal: number;
}

export interface PersonStats {
  deal: number;
  count: number;
}

const TOP_N = TOP_N_PERFORMERS;

export function computeStats(records: Record<string, unknown>[]): StatsResult {
  const departments: Record<string, DeptStats> = {};
  const months: Record<string, MonthStats> = {};
  const persons: Record<string, PersonStats> = {};
  let totalDeal = 0;
  let totalWechat = 0;
  let totalInteraction = 0;
  let totalDemand = 0;

  for (const r of records) {
    const dept = String(r.department || 'unknown');
    const month = String(r.month || 'unknown');
    const name = String(r.name || 'unknown');
    const deal = Number(r.deal || 0);
    const wechat = Number(r.wechat_added || 0);
    const interaction = Number(r.interaction || 0);
    const demand = Number(r.demand || 0);

    if (!departments[dept]) departments[dept] = { count: 0, deal: 0 };
    departments[dept].count++;
    departments[dept].deal += deal;

    if (!months[month]) months[month] = { deal: 0, wechat: 0, interaction: 0, demand: 0, count: 0 };
    months[month].deal += deal;
    months[month].wechat += wechat;
    months[month].interaction += interaction;
    months[month].demand += demand;
    months[month].count++;

    if (!persons[name]) persons[name] = { deal: 0, count: 0 };
    persons[name].deal += deal;
    persons[name].count++;

    totalDeal += deal;
    totalWechat += wechat;
    totalInteraction += interaction;
    totalDemand += demand;
  }

  const topPerformers = Object.entries(persons)
    .sort(([, a], [, b]) => b.deal - a.deal)
    .slice(0, TOP_N)
    .map(([name, s]) => ({ name, deal: s.deal }));

  const topDepts = Object.entries(departments)
    .sort(([, a], [, b]) => b.deal - a.deal)
    .slice(0, TOP_N)
    .map(([dept, s]) => ({ department: dept, deal: s.deal, count: s.count }));

  const monthlyTopPerformers: Record<string, Array<{ name: string; deal: number }>> = {};
  for (const r of records) {
    const m = String(r.month || '');
    if (!monthlyTopPerformers[m]) monthlyTopPerformers[m] = [];
    monthlyTopPerformers[m].push({ name: String(r.name || ''), deal: Number(r.deal || 0) });
  }
  for (const month of Object.keys(monthlyTopPerformers)) {
    monthlyTopPerformers[month] = monthlyTopPerformers[month]
      .sort((a, b) => b.deal - a.deal)
      .slice(0, TOP_N);
  }

  return {
    totalCount: records.length,
    totalDeal,
    totalWechat,
    totalInteraction,
    totalDemand,
    months,
    departments,
    persons,
    topPerformers,
    topDepts,
    monthlyTopPerformers,
    monthCount: Object.keys(months).length,
    deptCount: Object.keys(departments).length,
    personCount: Object.keys(persons).length,
  };
}

export function formatStatsPrompt(stats: StatsResult): string {
  const monthLines = Object.entries(stats.months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) =>
      `${month}: ${getColumnLabel('deal')}=${m.deal}, ${getColumnLabel('wechat_added')}=${m.wechat}, ${getColumnLabel('interaction')}=${m.interaction}, ${getColumnLabel('demand')}=${m.demand}, 人数=${m.count}`
    ).join('\n');

  const topPerformerLines = stats.topPerformers
    .map((p, i) => `${i + 1}. ${p.name}: ${p.deal}单`)
    .join('\n');

  const perMonthTopLines = Object.entries(stats.monthlyTopPerformers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, performers]) =>
      `${month}: ${performers.map((p, i) => `${i + 1}.${p.name}(${p.deal}单)`).join(' ')}`
    ).join('\n');

  return `【总体概况】
- 数据总条数: ${stats.totalCount}
- 覆盖月份: ${stats.monthCount}个 (${Object.keys(stats.months).sort().join(', ')})
- 覆盖部门: ${stats.deptCount}个
- 覆盖人员: ${stats.personCount}人
- 总${getColumnLabel('deal')}: ${stats.totalDeal}
- 总${getColumnLabel('wechat_added')}: ${stats.totalWechat}
- 总${getColumnLabel('interaction')}: ${stats.totalInteraction}
- 总${getColumnLabel('demand')}: ${stats.totalDemand}

【按月份统计】
${monthLines}

【成交TOP5人员（全局）】
${topPerformerLines}

【各月TOP5成交人员】
${perMonthTopLines}`;
}
