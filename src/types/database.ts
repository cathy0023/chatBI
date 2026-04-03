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