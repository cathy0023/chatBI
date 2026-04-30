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
  const columns = db.prepare("PRAGMA table_info(chat_messages)").all().map((c: { name: string }) => c.name);
  if (!columns.includes('ui_schema')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN ui_schema TEXT');
  }
  if (!columns.includes('agent_trace')) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN agent_trace TEXT');
  }
}
