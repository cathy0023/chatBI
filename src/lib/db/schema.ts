import { getDb } from './connection';

export function initSchema(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS sop_records (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('script', 'kpi', 'case', 'training')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      embedding TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sop_category ON sop_records(category);
    CREATE INDEX IF NOT EXISTS idx_sop_tags ON sop_records(tags);

    CREATE TABLE IF NOT EXISTS sales_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      month TEXT NOT NULL,
      wechat_added INTEGER DEFAULT 0,
      interaction INTEGER DEFAULT 0,
      demand INTEGER DEFAULT 0,
      deal INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sales_name ON sales_performance(name);
    CREATE INDEX IF NOT EXISTS idx_sales_department ON sales_performance(department);
    CREATE INDEX IF NOT EXISTS idx_sales_month ON sales_performance(month);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      ui_schema TEXT,
      agent_trace TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
  `);

  // Migrations: add columns if they don't exist (safe for existing databases)
  const columns = (db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[]).map(c => c.name);
  if (!columns.includes('ui_schema')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN ui_schema TEXT');
  }
  if (!columns.includes('agent_trace')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN agent_trace TEXT');
  }

  // 查询日志表（错误模式自进化 P0）
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      generated_sql TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'repaired')),
      repaired_sql TEXT,
      error_message TEXT,
      result_row_count INTEGER DEFAULT 0,
      has_all_zero_rows BOOLEAN DEFAULT FALSE,
      execution_time_ms INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_query_logs_status ON query_logs(status);
    CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs(created_at);
  `);

  // 纠正规则表（错误模式自进化 P0）
  db.exec(`
    CREATE TABLE IF NOT EXISTS correction_rules (
      id TEXT PRIMARY KEY,
      pattern_key TEXT NOT NULL,
      rule TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'auto',
      occurrence_count INTEGER DEFAULT 0,
      effectiveness REAL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_correction_rules_pattern ON correction_rules(pattern_key);
    CREATE INDEX IF NOT EXISTS idx_correction_rules_status ON correction_rules(status);
  `);
}
