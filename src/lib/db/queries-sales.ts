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

// ==================== Keyword Extraction ====================

const MONTH_MAP: Record<string, string> = {
  '7月': '7月',
  七月: '7月',
  '7月份': '7月',
  '8月': '8月',
  八月: '8月',
  '8月份': '8月',
  '9月': '9月',
  九月: '9月',
  '9月份': '9月',
  '10月': '10月',
  十月: '10月',
  '10月份': '10月',
};

const METRIC_MAP: Record<string, MetricColumn> = {
  加微: 'wechat_added',
  加微信: 'wechat_added',
  微信: 'wechat_added',
  互动: 'interaction',
  企微: 'interaction',
  需求: 'demand',
  有意向: 'demand',
  成交: 'deal',
  销量: 'deal',
  销售: 'deal',
};

const RANKING_KEYWORDS = ['排行榜', '排名', '排行', 'top', '最好', '最高', '最多', 'top10', '前10'];
const SUMMARY_KEYWORDS = ['汇总', '总结', '整体', '概览', '各部门', '所有部门', '各月'];

// Patterns that indicate the user wants records where a metric > 0
const HAS_METRIC_PATTERNS: Array<{ pattern: RegExp; metric: MetricColumn }> = [
  { pattern: /有没有.*成交/, metric: 'deal' },
  { pattern: /有成交/, metric: 'deal' },
  { pattern: /有没有.*加微/, metric: 'wechat_added' },
  { pattern: /有加微/, metric: 'wechat_added' },
  { pattern: /有没有.*互动/, metric: 'interaction' },
  { pattern: /有互动/, metric: 'interaction' },
  { pattern: /有没有.*需求/, metric: 'demand' },
  { pattern: /有需求/, metric: 'demand' },
  { pattern: /成交了/, metric: 'deal' },
  { pattern: /加到微信/, metric: 'wechat_added' },
  { pattern: /加了微/, metric: 'wechat_added' },
];

type ExtractedParams = {
  name?: string;
  department?: string;
  month?: string;
  metric?: MetricColumn;
  metricMinValue?: number;
  isRanking: boolean;
  isSummary: boolean;
};

export function extractQueryParams(query: string): ExtractedParams {
  const result: ExtractedParams = { isRanking: false, isSummary: false };

  // 1. Ranking / Summary
  result.isRanking = RANKING_KEYWORDS.some(kw => query.toLowerCase().includes(kw));
  result.isSummary = SUMMARY_KEYWORDS.some(kw => query.includes(kw));

  // 2. Extract month
  for (const [kw, val] of Object.entries(MONTH_MAP)) {
    if (query.includes(kw)) {
      result.month = val;
      break;
    }
  }

  // 3. Extract metric
  for (const [kw, col] of Object.entries(METRIC_MAP)) {
    if (query.includes(kw)) {
      result.metric = col;
      break;
    }
  }

  // 3.5 Check "has metric" patterns (e.g. "有没有成交" → deal > 0)
  for (const { pattern, metric } of HAS_METRIC_PATTERNS) {
    if (pattern.test(query)) {
      result.metric = metric;
      result.metricMinValue = 1;
      break;
    }
  }

  // 4. Extract name — fuzzy match against known DB names
  // DB stores "武莹1", query has "武莹". Try exact includes, then try prefix matching.
  const allNames = getAllNames();
  for (const name of allNames) {
    if (query.includes(name)) {
      result.name = name;
      break;
    }
  }
  // Try prefix matching: if DB name like "武莹1", query has "武莹"
  if (!result.name) {
    const chineseTerms = query.match(/[\u4e00-\u9fff]{2}/g) || [];
    for (const term of chineseTerms) {
      for (const name of allNames) {
        if (name.startsWith(term)) {
          result.name = name;
          break;
        }
      }
      if (result.name) break;
    }
  }

  // 5. Extract department — match known departments or short names
  const allDepts = getAllDepartments();
  for (const dept of allDepts) {
    const shortName = dept.split('-').pop() || '';
    if (query.includes(shortName) || query.includes(dept)) {
      result.department = dept;
      break;
    }
  }

  return result;
}

// ==================== LLM-driven Search ====================

type LLMQueryParams = {
  name: string | null;
  department: string | null;
  month: string | null;
  metric: string | null;
  metricMinValue: number | null;
  isRanking: boolean;
  isSummary: boolean;
};

/**
 * Accept structured params from LLM extraction.
 * Reuses the same WHERE-clause logic as searchSales() but skips regex extraction.
 */
export function searchSalesByParams(params: LLMQueryParams, limit?: number): SalesRecord[] {
  const db = getDb();

  // Validate metric against allowed columns
  const validMetric = METRIC_COLUMNS.includes(params.metric as MetricColumn)
    ? (params.metric as MetricColumn)
    : null;

  // --- Ranking: keep explicit limit (default 50) ---
  if (params.isRanking) {
    return getTopPerformers(params.month || undefined, validMetric || 'deal', limit ?? 50);
  }

  // --- Build WHERE from LLM params ---
  const conditions: string[] = [];
  const sqlParams: (string | number)[] = [];

  if (params.name) {
    conditions.push('name = ?');
    sqlParams.push(params.name);
  }
  if (params.department) {
    // Use LIKE for department to handle partial matches like "花园桥校区" → "学习机-花园桥校区"
    conditions.push('department LIKE ?');
    sqlParams.push(`%${params.department}%`);
  }
  if (params.month && VALID_MONTHS.includes(params.month)) {
    conditions.push('month = ?');
    sqlParams.push(params.month);
  }
  if (params.metricMinValue != null && validMetric) {
    conditions.push(`${validMetric} >= ?`);
    sqlParams.push(params.metricMinValue);
  }

  if (conditions.length > 0) {
    const rowLimit = limit ?? 5000;
    const where = conditions.join(' AND ');
    const rows = db
      .prepare(`SELECT * FROM sales_performance WHERE ${where} ORDER BY month, name LIMIT ?`)
      .all(...sqlParams, rowLimit) as SalesRecord[];

    // If no results and we had a name filter, fall back to LIKE for fuzzy matching
    // (names in DB may have trailing digits like "武莹1" vs "武莹")
    if (rows.length === 0 && params.name) {
      const fuzzy = db
        .prepare(`SELECT * FROM sales_performance WHERE name LIKE ? ORDER BY month, name LIMIT ?`)
        .all(`%${params.name}%`, rowLimit) as SalesRecord[];
      if (fuzzy.length > 0) return fuzzy;
    }
    return rows;
  }

  // --- Summary: return all data (no limit) ---
  if (params.isSummary) {
    return db
      .prepare('SELECT * FROM sales_performance ORDER BY month, department, name')
      .all() as SalesRecord[];
  }

  // --- No specific filters → return all data for analysis ---
  if (limit != null) {
    return db
      .prepare('SELECT * FROM sales_performance ORDER BY month, department, name LIMIT ?')
      .all(limit) as SalesRecord[];
  }
  return db
    .prepare('SELECT * FROM sales_performance ORDER BY month, department, name')
    .all() as SalesRecord[];
}

// ==================== Main Search (legacy) ====================

export function searchSales(query: string, limit?: number): SalesRecord[] {
  const effectiveLimit = limit ?? 5000;
  const db = getDb();
  const params = extractQueryParams(query);

  // Build WHERE clause from extracted params
  const conditions: string[] = [];
  const sqlParams: (string | number)[] = [];

  if (params.name) {
    conditions.push('name = ?');
    sqlParams.push(params.name);
  }
  if (params.department) {
    conditions.push('department = ?');
    sqlParams.push(params.department);
  }
  if (params.month) {
    conditions.push('month = ?');
    sqlParams.push(params.month);
  }
  if (params.metricMinValue !== undefined && params.metric) {
    conditions.push(`${params.metric} >= ?`);
    sqlParams.push(params.metricMinValue);
  }

  // --- Ranking ---
  if (params.isRanking) {
    return getTopPerformers(params.month, params.metric || 'deal', effectiveLimit);
  }

  // --- If we extracted specific filters, use them ---
  if (conditions.length > 0) {
    const where = conditions.join(' AND ');
    return db
      .prepare(`SELECT * FROM sales_performance WHERE ${where} ORDER BY month, name LIMIT ?`)
      .all(...sqlParams, effectiveLimit) as SalesRecord[];
  }

  // --- Summary (全量返回，可能按月/部门分组) ---
  if (params.isSummary) {
    return db
      .prepare('SELECT * FROM sales_performance ORDER BY month, department, name')
      .all() as SalesRecord[];
  }

  // --- Fallback: raw LIKE search against name/dept ---
  const likeQuery = `%${query}%`;
  const byName = db
    .prepare('SELECT * FROM sales_performance WHERE name LIKE ? ORDER BY month LIMIT ?')
    .all(likeQuery, effectiveLimit) as SalesRecord[];
  if (byName.length > 0) return byName;

  const byDept = db
    .prepare('SELECT * FROM sales_performance WHERE department LIKE ? ORDER BY month, name LIMIT ?')
    .all(likeQuery, effectiveLimit) as SalesRecord[];
  if (byDept.length > 0) return byDept;

  // --- Chinese segment fallback ---
  const chineseChars = [...query].filter(c => /[\u4e00-\u9fff]/.test(c));
  if (chineseChars.length >= 2) {
    const seen = new Set<number>();
    const results: SalesRecord[] = [];
    for (let si = 0; si < chineseChars.length - 1 && results.length < effectiveLimit; si++) {
      const seg = chineseChars[si] + chineseChars[si + 1];
      const segLike = `%${seg}%`;
      const rows = db
        .prepare(
          `SELECT * FROM sales_performance
           WHERE name LIKE ? OR department LIKE ?
           ORDER BY month, name LIMIT ?`,
        )
        .all(segLike, segLike, effectiveLimit) as SalesRecord[];
      for (const r of rows) {
        if (!seen.has(r.id) && results.length < effectiveLimit) {
          seen.add(r.id);
          results.push(r);
        }
      }
    }
    if (results.length > 0) return results;
  }

  return [];
}
