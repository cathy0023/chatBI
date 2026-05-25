export type DimensionDef = {
  column: string;
  label: string;
  synonyms: string[];
  description: string;
  enum?: string[];
  valueMap?: Record<string, string>;
};

export type MetricDef = {
  column: string;
  label: string;
  synonyms: string[];
  description: string;
  defaultAgg: 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN';
};

export type TableDef = {
  name: string;
  description: string;
  dimensions: DimensionDef[];
  metrics: MetricDef[];
};

export type SemanticModel = {
  domain: string;
  description: string;
  tables: TableDef[];
  businessContext: string;
};

export type NL2SQLResult = {
  sql: string;
  records: Record<string, unknown>[];
  confidence: number;
  source: 'generated' | 'repaired' | 'fallback';
};

// ---- 错误模式自进化 P0 类型 ----

export type QueryStatus = 'success' | 'failed' | 'repaired';

export type ErrorPatternKey =
  | 'alias_chinese_column'
  | 'missing_group_by'
  | 'wrong_aggregate'
  | 'all_zero_result'
  | 'invalid_month_format'
  | 'unknown_department';

export interface QueryRecord {
  id?: number;
  question: string;
  generatedSQL: string;
  status: QueryStatus;
  repairedSQL?: string;
  errorMessage?: string;
  resultRowCount: number;
  hasAllZeroRows: boolean;
  executionTimeMs: number;
  createdAt?: number;
}

export interface CorrectionRule {
  id: string;
  patternKey: ErrorPatternKey;
  rule: string;
  priority: 'critical' | 'high' | 'normal';
  status: 'auto' | 'approved' | 'rejected';
  occurrenceCount: number;
  effectiveness: number;
  firstSeen: number;
  lastSeen: number;
  createdAt?: number;
}
