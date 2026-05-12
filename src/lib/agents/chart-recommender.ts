/**
 * Unified chart recommendation and UI schema building.
 * Single source of truth — replaces the scattered detectChartDimension,
 * detectMetricFromQuery, buildUISchema, aggregateBy functions.
 */

import { getColumnLabel, SALES_COLUMN_META } from '@/types/database';

/**
 * Resolve metric value from a record.
 * When SQL uses aggregates like SUM(deal), the column name is 'SUM(deal)' not 'deal'.
 * This function tries exact match first, then falls back to a column containing the metric name.
 */
function resolveMetricValue(record: Record<string, unknown>, metric: string): number {
  if (metric in record) return Number(record[metric]) || 0;
  for (const key of Object.keys(record)) {
    if (key.includes(metric)) return Number(record[key]) || 0;
  }
  return 0;
}

// ==================== Chart Type Recommendation ====================

export type ChartType = 'table' | 'bar' | 'pie' | 'line' | 'radar';

interface ChartRecommendation {
  uiType: ChartType;
  dimension: 'name' | 'month' | 'department';
  metric: string;
}

/**
 * Recommend chart type based on query intent + data characteristics.
 * Falls back to the LLM-recommended uiType when available.
 */
export function recommendChart(
  query: string,
  records: Record<string, unknown>[],
  llmUiType?: string,
  llmSuggestedChartType?: string,
): ChartRecommendation {
  const dimension = detectDimension(query, records);
  const metric = detectMetric(query);
  const isMultiMonthRanking = detectMultiMonthRanking(query, records);

  // Multi-month ranking → always table
  if (isMultiMonthRanking) {
    return { uiType: 'table', dimension, metric };
  }

  // Detect chart type from user query keywords
  const queryChartType = detectChartTypeFromQuery(query);
  if (queryChartType) {
    return { uiType: queryChartType, dimension, metric };
  }

  // Prefer LLM recommendation when available
  if (llmUiType || llmSuggestedChartType) {
    const uiType = (llmUiType || llmSuggestedChartType) as ChartType;
    const validTypes: ChartType[] = ['table', 'bar', 'pie', 'line', 'radar'];
    if (validTypes.includes(uiType)) {
      return { uiType, dimension, metric };
    }
  }

  return { uiType: 'table', dimension, metric };
}

// ==================== UI Schema Builder ====================

export interface UISchemaData {
  type: string;
  data: {
    rows: Array<Record<string, unknown>>;
    chartData: Record<string, number>;
    dimension: string;
    metric: string;
    metricLabel: string;
    dimensionLabel: string;
    totalCount: number;
    [key: string]: unknown;
  };
  title: string;
  summary?: string;
  insights?: string[];
}

export function buildUISchema(
  records: Record<string, unknown>[],
  query: string,
  analysis?: {
    summary?: string;
    insights?: string[];
    dataSummary?: Record<string, unknown>;
    suggestedChartType?: string;
  },
  uiType?: string,
): UISchemaData {
  const recommendation = recommendChart(query, records, uiType, analysis?.suggestedChartType);
  const isMultiMonthRanking = detectMultiMonthRanking(query, records);

  const rows = records.map(r => ({
    name: String(r.name || ''),
    department: String(r.department || ''),
    month: String(r.month || ''),
    wechat_added: Number(r.wechat_added || 0),
    interaction: Number(r.interaction || 0),
    demand: Number(r.demand || 0),
    deal: Number(r.deal || 0),
  }));

  const chartData = isMultiMonthRanking
    ? buildRankingChartData(records, recommendation.metric)
    : aggregateBy(records, recommendation.dimension, recommendation.metric);

  return {
    type: recommendation.uiType,
    data: {
      rows,
      chartData,
      dimension: recommendation.dimension,
      metric: recommendation.metric,
      metricLabel: getColumnLabel(recommendation.metric),
      dimensionLabel: getColumnLabel(recommendation.dimension),
      totalCount: records.length,
      ...(analysis?.dataSummary || {}),
    },
    title: query,
    summary: analysis?.summary,
    insights: analysis?.insights,
  };
}

// ==================== Private Helpers ====================

function detectChartTypeFromQuery(query: string): ChartType | null {
  if (/饼图|占比|比例|百分比|分布/.test(query)) return 'pie';
  if (/折线|趋势|走势|变化趋势/.test(query)) return 'line';
  if (/柱状|柱形|条形|对比图/.test(query)) return 'bar';
  if (/表格|明细|列表|详情/.test(query)) return 'table';
  return null;
}

function detectDimension(query: string, records?: Record<string, unknown>[]): 'name' | 'month' | 'department' {
  const personKws = ['销售', '销售员', '销售人员', '人员', '谁', '个人', '每个人', '各人', '各位', '名字'];
  const monthKws = ['月份', '各月', '每月', '月度', '趋势', '变化', '走势', '月对比', '月比较', '对比月'];
  const deptKws = ['部门', '校区', '各部', '各部门', '团队', '中心'];

  // Keyword-based hints (may be wrong if query mentions a month as filter, not dimension)
  let keywordDimension: 'name' | 'month' | 'department' | null = null;
  if (personKws.some(kw => query.includes(kw))) keywordDimension = 'name';
  else if (deptKws.some(kw => query.includes(kw))) keywordDimension = 'department';
  else if (monthKws.some(kw => query.includes(kw))) keywordDimension = 'month';
  else if (/\d+月/.test(query)) keywordDimension = 'month';

  // Validate keyword hint against actual data columns
  // Scan ALL records for available columns (merged data may have inconsistent columns)
  if (keywordDimension && records && records.length > 0) {
    const allKeys = new Set<string>();
    for (const r of records) for (const k of Object.keys(r)) allKeys.add(k);
    if (allKeys.has(keywordDimension)) return keywordDimension;
    // Keyword dimension not in data — fall through to data-driven detection
  } else if (keywordDimension) {
    return keywordDimension; // No data to validate, trust keyword
  }

  // Data-driven detection: infer dimension from actual data columns
  // Scan ALL records for available columns (merged data may have inconsistent columns)
  if (records && records.length > 0) {
    const allKeys = new Set<string>();
    for (const r of records) for (const k of Object.keys(r)) allKeys.add(k);

    if (allKeys.has('month')) {
      const uniqueMonths = new Set(records.map(r => String(r.month || '')));
      if (uniqueMonths.size > 1) return 'month';
    }
    if (allKeys.has('name')) {
      const uniqueNames = new Set(records.map(r => String(r.name || '')));
      if (uniqueNames.size > 1) return 'name';
    }
    if (allKeys.has('department')) return 'department';
  }

  return 'name';
}

function detectMetric(query: string): string {
  for (const [key, meta] of Object.entries(SALES_COLUMN_META)) {
    if (meta.role === 'metric') {
      const labelBase = meta.label.replace('数', '');
      if (query.includes(labelBase)) return key;
    }
  }
  if (/成交|销量|成单/.test(query)) return 'deal';
  if (/互动|企微/.test(query)) return 'interaction';
  return 'deal';
}

function detectMultiMonthRanking(query: string, records: Record<string, unknown>[]): boolean {
  const rankingKws = ['排名', '排行', '前五', '前5', 'top', '前几', '前10', '前十', '最好', '最高', '最多'];
  const multiMonthKws = ['各月', '每个月', '各自', '四个月', '各个月', '分别', '每月', '个月'];
  const hasRanking = rankingKws.some(kw => query.toLowerCase().includes(kw));
  const hasMultiMonth = multiMonthKws.some(kw => query.includes(kw));
  const monthsInData = new Set(records.map(r => String(r.month || '')));
  return hasRanking && (hasMultiMonth || monthsInData.size > 1);
}

export function aggregateBy(
  records: Record<string, unknown>[],
  dimension: string,
  metric: string,
): Record<string, number> {
  // If dimension column doesn't exist in data, auto-detect a usable dimension
  const firstRecord = records[0];
  const availableDimensions = firstRecord
    ? Object.keys(firstRecord).filter(k => ['name', 'month', 'department'].includes(k))
    : [];

  let effectiveDimension = dimension;
  if (!firstRecord || !(dimension in firstRecord)) {
    // Fall back to first available dimension, or skip aggregation entirely
    if (availableDimensions.length > 0) {
      effectiveDimension = availableDimensions[0];
    } else {
      // No dimension available — return total as single entry
      const total = records.reduce((sum, r) => sum + Number(r[metric] || 0), 0);
      return { '合计': total };
    }
  }

  const agg: Record<string, number> = {};
  for (const r of records) {
    const rawKey = r[effectiveDimension];
    const key = rawKey != null && String(rawKey).trim() !== '' ? String(rawKey) : '其他';
    const value = resolveMetricValue(r, metric);
    agg[key] = (agg[key] || 0) + value;
  }
  if (effectiveDimension !== 'month') {
    return Object.fromEntries(Object.entries(agg).sort(([, a], [, b]) => b - a));
  }
  return agg;
}

function buildRankingChartData(
  records: Record<string, unknown>[],
  metric: string,
): Record<string, number> {
  const byMonth: Record<string, Array<{ key: string; value: number }>> = {};
  for (const r of records) {
    const month = String(r.month || '');
    const name = String(r.name || '');
    const value = resolveMetricValue(r, metric);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push({ key: `${month} ${name}`, value });
  }
  const result: Record<string, number> = {};
  for (const month of Object.keys(byMonth).sort()) {
    const items = byMonth[month].sort((a, b) => b.value - a.value).slice(0, 5);
    for (const item of items) {
      result[item.key] = item.value;
    }
  }
  return result;
}
