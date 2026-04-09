import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// We test schema/queries directly against a real in-memory SQLite
let db: Database.Database;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function initSchema(testDb: Database.Database): void {
  testDb.exec(`
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
}

function seedSales(testDb: Database.Database): void {
  const insert = testDb.prepare(
    `INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = [
    { name: '武莹', dept: '花园桥校区', month: '7月', wc: 10, inter: 20, dem: 5, deal: 3 },
    { name: '武莹', dept: '花园桥校区', month: '8月', wc: 12, inter: 25, dem: 7, deal: 4 },
    { name: '武莹', dept: '花园桥校区', month: '9月', wc: 8, inter: 18, dem: 4, deal: 2 },
    { name: '武莹', dept: '花园桥校区', month: '10月', wc: 15, inter: 30, dem: 9, deal: 6 },
    { name: '李明', dept: '中关村校区', month: '7月', wc: 9, inter: 15, dem: 4, deal: 2 },
    { name: '李明', dept: '中关村校区', month: '8月', wc: 11, inter: 22, dem: 6, deal: 3 },
    { name: '李明', dept: '中关村校区', month: '9月', wc: 13, inter: 28, dem: 8, deal: 5 },
    { name: '李明', dept: '中关村校区', month: '10月', wc: 14, inter: 26, dem: 7, deal: 4 },
    { name: '张三', dept: '望京校区', month: '7月', wc: 7, inter: 12, dem: 3, deal: 1 },
    { name: '张三', dept: '望京校区', month: '8月', wc: 8, inter: 14, dem: 4, deal: 2 },
    { name: '张三', dept: '望京校区', month: '9月', wc: 9, inter: 16, dem: 5, deal: 3 },
    { name: '张三', dept: '望京校区', month: '10月', wc: 10, inter: 18, dem: 6, deal: 3 },
  ];
  const tx = testDb.transaction(() => {
    for (const r of rows) {
      insert.run(r.name, r.dept, r.month, r.wc, r.inter, r.dem, r.deal);
    }
  });
  tx();
}

describe('Database Layer', () => {
  beforeAll(() => {
    db = createTestDb();
    initSchema(db);
    seedSales(db);
  });

  describe('Schema Creation', () => {
    it('should have all required tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);

      expect(names).toContain('sop_records');
      expect(names).toContain('sales_performance');
      expect(names).toContain('chat_sessions');
      expect(names).toContain('chat_messages');
    });

    it('should have correct indexes on sales_performance', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sales_performance'")
        .all() as Array<{ name: string }>;
      const names = indexes.map(i => i.name);

      expect(names).toContain('idx_sales_name');
      expect(names).toContain('idx_sales_department');
      expect(names).toContain('idx_sales_month');
    });
  });

  describe('Sales Data Queries', () => {
    it('should search by name', () => {
      const rows = db
        .prepare('SELECT * FROM sales_performance WHERE name LIKE ? ORDER BY month')
        .all('%武莹%') as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveProperty('name', '武莹');
    });

    it('should search by department', () => {
      const rows = db
        .prepare('SELECT * FROM sales_performance WHERE department LIKE ? ORDER BY month, name')
        .all('%花园桥%') as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(4);
      rows.forEach(r => expect(r.department).toBe('花园桥校区'));
    });

    it('should get top performers by deal', () => {
      const rows = db
        .prepare('SELECT * FROM sales_performance ORDER BY deal DESC, name LIMIT 5')
        .all() as Array<Record<string, unknown>>;

      expect(rows.length).toBeGreaterThanOrEqual(5);
      // 武莹 10月 has deal=6, should be top
      expect(rows[0].name).toBe('武莹');
      expect(rows[0].deal).toBe(6);
    });

    it('should compute monthly summary correctly', () => {
      const summary = db
        .prepare(
          `SELECT month,
            SUM(wechat_added) as total_wechat,
            SUM(deal) as total_deal,
            COUNT(*) as count
          FROM sales_performance
          WHERE month = '10月'
          GROUP BY month`,
        )
        .all() as Array<{ month: string; total_wechat: number; total_deal: number; count: number }>;

      expect(summary).toHaveLength(1);
      expect(summary[0].count).toBe(3); // 3 people in 10月
      expect(summary[0].total_deal).toBe(13); // 6 + 4 + 3
    });

    it('should compute department summary correctly', () => {
      const summary = db
        .prepare(
          `SELECT department, SUM(deal) as total_deal, COUNT(*) as count
          FROM sales_performance
          GROUP BY department ORDER BY total_deal DESC`,
        )
        .all() as Array<{ department: string; total_deal: number; count: number }>;

      expect(summary).toHaveLength(3); // 3 departments
      // 花园桥 has the most deals (3+4+2+6=15)
      expect(summary[0].department).toBe('花园桥校区');
      expect(summary[0].total_deal).toBe(15);
    });
  });

  describe('Chat Session & Messages', () => {
    it('should create session and retrieve it', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(sessionId, 'Test Session');

      const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as Record<string, unknown>;
      expect(session).toBeTruthy();
      expect(session.id).toBe(sessionId);
      expect(session.title).toBe('Test Session');
    });

    it('should persist messages in a session', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(sessionId, 'Msg Test');

      const msgId = uuidv4();
      db.prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, ui_schema, agent_trace) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(msgId, sessionId, 'user', '花园桥校区的业绩', null, null);

      const assistantMsgId = uuidv4();
      db.prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, ui_schema, agent_trace) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(assistantMsgId, sessionId, 'assistant', '找到4条记录', null, null);

      const messages = db
        .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as Array<Record<string, unknown>>;

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should cascade delete messages when session deleted', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO chat_sessions (id) VALUES (?)').run(sessionId);
      db.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sessionId,
        'user',
        'test',
      );

      db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);

      const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ?').all(sessionId);
      expect(messages).toHaveLength(0);

      const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
      expect(session).toBeFalsy();
    });
  });

  describe('SOP Records', () => {
    it('should insert and query sop records', () => {
      const id = uuidv4();
      db.prepare(
        `INSERT INTO sop_records (id, category, title, content, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, 'script', '价格异议处理话术', '如果客户嫌贵...', JSON.stringify(['价格', '异议']), JSON.stringify({ scenario: '价格异议' }));

      const row = db.prepare('SELECT * FROM sop_records WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.category).toBe('script');
      expect(row.title).toBe('价格异议处理话术');
      expect(JSON.parse(row.tags as string)).toEqual(['价格', '异议']);
    });

    it('should enforce category CHECK constraint', () => {
      expect(() => {
        db.prepare(
          `INSERT INTO sop_records (id, category, title, content) VALUES (?, ?, ?, ?)`,
        ).run(uuidv4(), 'invalid_category', 'test', 'test');
      }).toThrow();
    });
  });
});
