export type ScriptMeta = {
  scenario: string;
  stage: string;
  target_customer: string;
  effectiveness_score?: number;
};

export type KpiMeta = {
  metric_name: string;
  period: string;
  department?: string;
  sales_person?: string;
  value: number;
  unit: string;
};

export type CaseMeta = {
  industry: string;
  customer_type: string;
  outcome: string;
  deal_amount?: number;
};

export type TrainingMeta = {
  module: string;
  difficulty: string;
  duration_minutes?: number;
};

// Type map by category
export type MetadataByCategory = {
  script: ScriptMeta;
  kpi: KpiMeta;
  case: CaseMeta;
  training: TrainingMeta;
};