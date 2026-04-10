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

export type FewShotExample = {
  patterns: string[];
  question: string;
  sql: string;
};

export type NL2SQLResult = {
  sql: string;
  records: Record<string, unknown>[];
  confidence: number;
  source: 'generated' | 'repaired' | 'fallback';
};
