import { getDb } from './connection';
import type { SalesRecord } from '@/types/database';

const VALID_MONTHS = ['7月', '8月', '9月', '10月'];
const METRIC_COLUMNS = ['wechat_added', 'interaction', 'demand', 'deal'] as const;
type MetricColumn = (typeof METRIC_COLUMNS)[number];

export function getAllDepartments(): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT DISTINCT department FROM sales_performance ORDER BY department')
    .all() as Array<{ department: string }>;
  return rows.map(r => r.department);
}

export function getAllNames(): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT DISTINCT name FROM sales_performance ORDER BY name')
    .all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

export function searchSalesByDepartment(dept: string): SalesRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM sales_performance WHERE department LIKE ? ORDER BY month, name')
    .all(`%${dept}%`) as SalesRecord[];
}

export function searchSalesByName(name: string): SalesRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM sales_performance WHERE name LIKE ? ORDER BY month')
    .all(`%${name}%`) as SalesRecord[];
}

export function getMonthlySummary(month?: string): Array<{
  month: string;
  total_wechat: number;
  total_interaction: number;
  total_demand: number;
  total_deal: number;
  avg_wechat: number;
  avg_interaction: number;
  avg_demand: number;
  avg_deal: number;
  count: number;
}> {
  const db = getDb();
  if (month && VALID_MONTHS.includes(month)) {
    return db
      .prepare(
        `SELECT month,
        SUM(wechat_added) as total_wechat,
        SUM(interaction) as total_interaction,
        SUM(demand) as total_demand,
        SUM(deal) as total_deal,
        ROUND(AVG(wechat_added), 1) as avg_wechat,
        ROUND(AVG(interaction), 1) as avg_interaction,
        ROUND(AVG(demand), 1) as avg_demand,
        ROUND(AVG(deal), 1) as avg_deal,
        COUNT(*) as count
      FROM sales_performance WHERE month = ?
      GROUP BY month ORDER BY month`,
      )
      .all(month) as Array<{
      month: string;
      total_wechat: number;
      total_interaction: number;
      total_demand: number;
      total_deal: number;
      avg_wechat: number;
      avg_interaction: number;
      avg_demand: number;
      avg_deal: number;
      count: number;
    }>;
  }
  return db
    .prepare(
      `SELECT month,
      SUM(wechat_added) as total_wechat,
      SUM(interaction) as total_interaction,
      SUM(demand) as total_demand,
      SUM(deal) as total_deal,
      ROUND(AVG(wechat_added), 1) as avg_wechat,
      ROUND(AVG(interaction), 1) as avg_interaction,
      ROUND(AVG(demand), 1) as avg_demand,
      ROUND(AVG(deal), 1) as avg_deal,
      COUNT(*) as count
    FROM sales_performance
    GROUP BY month ORDER BY month`,
    )
    .all() as Array<{
    month: string;
    total_wechat: number;
    total_interaction: number;
    total_demand: number;
    total_deal: number;
    avg_wechat: number;
    avg_interaction: number;
    avg_demand: number;
    avg_deal: number;
    count: number;
  }>;
}

export function getDepartmentSummary(month?: string): Array<{
  department: string;
  total_wechat: number;
  total_interaction: number;
  total_demand: number;
  total_deal: number;
  count: number;
}> {
  const db = getDb();
  const sql =
    month && VALID_MONTHS.includes(month)
      ? `SELECT department,
        SUM(wechat_added) as total_wechat,
        SUM(interaction) as total_interaction,
        SUM(demand) as total_demand,
        SUM(deal) as total_deal,
        COUNT(*) as count
      FROM sales_performance WHERE month = ?
      GROUP BY department ORDER BY total_deal DESC`
      : `SELECT department,
        SUM(wechat_added) as total_wechat,
        SUM(interaction) as total_interaction,
        SUM(demand) as total_demand,
        SUM(deal) as total_deal,
        COUNT(*) as count
      FROM sales_performance
      GROUP BY department ORDER BY total_deal DESC`;

  const params = month && VALID_MONTHS.includes(month) ? [month] : [];
  return db.prepare(sql).all(...params) as Array<{
    department: string;
    total_wechat: number;
    total_interaction: number;
    total_demand: number;
    total_deal: number;
    count: number;
  }>;
}

export function getTopPerformers(
  month?: string,
  metric: MetricColumn = 'deal',
  limit: number = 10,
): SalesRecord[] {
  const db = getDb();
  if (!METRIC_COLUMNS.includes(metric)) {
    metric = 'deal';
  }

  // When month is specified, return top performers for that month
  if (month && VALID_MONTHS.includes(month)) {
    return db
      .prepare(
        `SELECT * FROM sales_performance
         WHERE month = ?
         ORDER BY ${metric} DESC, name
         LIMIT ?`,
      )
      .all(month, limit) as SalesRecord[];
  }

  // When month is NOT specified, return top performers for EACH month
  // This matches user intent when asking "这4个月排名" or "各月排行"
  const results: SalesRecord[] = [];
  for (const m of VALID_MONTHS) {
    const rows = db
      .prepare(
        `SELECT * FROM sales_performance
         WHERE month = ?
         ORDER BY ${metric} DESC, name
         LIMIT ?`,
      )
      .all(m, limit) as SalesRecord[];
    results.push(...rows);
  }

  return results;
}
