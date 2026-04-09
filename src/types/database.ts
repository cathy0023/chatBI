export type SopCategory = 'script' | 'kpi' | 'case' | 'training';

export type SopRecord = {
  id: string;
  category: SopCategory;
  title: string;
  content: string;
  tags: string[];        // JSON array parsed
  metadata: Record<string, unknown>; // JSON parsed
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
};

export type SopRecordRow = {
  id: string;
  category: SopCategory;
  title: string;
  content: string;
  tags: string;           // JSON string
  metadata: string;       // JSON string
  embedding: string | null; // JSON string
  created_at: string;
  updated_at: string;
};

export type ChatSession = {
  id: string;
  title: string | null;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  ui_schema: string | null;  // JSON string of UISchema
  agent_trace: string | null; // JSON string
  created_at: string;
};

// Helper: convert DB row to typed record
export function parseSopRecord(row: SopRecordRow): SopRecord {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
  };
}

// Sales performance types
export type SalesRecord = {
  id: number;
  name: string;
  department: string;
  month: string;
  wechat_added: number;
  interaction: number;
  demand: number;
  deal: number;
};

// Column metadata — single source of truth for display names and roles
// When adding new data sources, extend or replace this map.
export const SALES_COLUMN_META = {
  name:          { label: '姓名',   role: 'dimension' as const },
  department:    { label: '部门',   role: 'dimension' as const },
  month:         { label: '月份',   role: 'dimension' as const },
  wechat_added:  { label: '加微数', role: 'metric' as const },
  interaction:   { label: '互动数', role: 'metric' as const },
  demand:        { label: '需求数', role: 'metric' as const },
  deal:          { label: '成交数', role: 'metric' as const },
} as const;

export type SalesColumnKey = keyof typeof SALES_COLUMN_META;
export type MetricColumnKey = {
  [K in SalesColumnKey]: typeof SALES_COLUMN_META[K]['role'] extends 'metric' ? K : never
}[SalesColumnKey];

// Generic helper: get display label for any column key, fallback to key itself
export function getColumnLabel(key: string): string {
  const meta = SALES_COLUMN_META[key as SalesColumnKey];
  return meta ? meta.label : key;
}

// All metric column keys derived from meta
export const METRIC_KEYS = (Object.entries(SALES_COLUMN_META)
  .filter(([, m]) => m.role === 'metric')
  .map(([k]) => k)) as MetricColumnKey[];