import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import Database from 'better-sqlite3';

// Mock generateTextCompat (the actual function used by NL2SQLEngine)
const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock('@/lib/llm/provider', () => ({
  generateTextCompat: (...args: unknown[]) => mockGenerateText(...args),
  getDefaultModel: () => 'mock-model',
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      month TEXT NOT NULL,
      wechat_added INTEGER DEFAULT 0,
      interaction INTEGER DEFAULT 0,
      demand INTEGER DEFAULT 0,
      deal INTEGER DEFAULT 0
    )
  `);
  const insert = db.prepare(
    `INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = [
    ['武莹', '花园桥校区', '7月', 10, 20, 5, 3],
    ['武莹', '花园桥校区', '8月', 12, 25, 7, 4],
    ['李明', '中关村校区', '7月', 9, 15, 4, 2],
    ['李明', '中关村校区', '8月', 11, 22, 6, 3],
    ['张三', '望京校区', '7月', 7, 12, 3, 1],
  ] as const;
  const tx = db.transaction(() => {
    for (const r of rows) insert.run(...r);
  });
  tx();
  return db;
}

describe('NL2SQLEngine', () => {
  let engine: NL2SQLEngine;
  let testDb: Database.Database;

  beforeAll(() => {
    testDb = createTestDb();
    engine = new NL2SQLEngine(testDb);
  });

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('should generate SQL and return records', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "SELECT name, month, deal FROM sales_performance WHERE month IN ('7月','8月') ORDER BY name, month",
    });

    const result = await engine.query('对比7月和8月成交');

    // Few-shot now returns results first
    expect(['generated', 'fewshot-direct']).toContain(result.source);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.sql).toContain('SELECT');
  });

  it('should self-repair on SQL execution error', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "SELECT name FROM nonexistent_table",
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "SELECT name FROM sales_performance LIMIT 5",
    });

    const result = await engine.query('随便查一下');

    expect(result.source).toBe('repaired');
    expect(result.confidence).toBe(0.7);
    expect(result.records.length).toBeGreaterThan(0);
  });

  it('should fallback to empty results on repeated failure', async () => {
    mockGenerateText.mockResolvedValue({ text: "SELECT * FROM nonexistent" });

    const result = await engine.query('查不到的');

    expect(result.source).toBe('fallback');
    expect(result.confidence).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('should fallback when LLM returns non-SQL', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '对不起，我不理解您的问题。',
    });

    const result = await engine.query('今天天气怎么样');

    expect(result.source).toBe('fallback');
    expect(result.confidence).toBe(0);
  });

  it('should reject dangerous SQL and fallback', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "DROP TABLE sales_performance",
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "DELETE FROM sales_performance WHERE 1=1",
    });

    const result = await engine.query('删除数据');

    expect(result.source).toBe('fallback');
  });

  it('should handle ranking query with GROUP BY', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'SELECT name, SUM(deal) AS "总成交" FROM sales_performance GROUP BY name ORDER BY "总成交" DESC LIMIT 10',
    });

    const result = await engine.query('成交排行榜');

    // Few-shot pattern matches first
    expect(['generated', 'fewshot-direct']).toContain(result.source);
    expect(result.records.length).toBeGreaterThan(0);
  });

  it('should strip markdown code blocks from LLM response', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "```sql\nSELECT * FROM sales_performance WHERE name = '武莹'\n```",
    });

    const result = await engine.query('查询武莹数据');

    expect(result.source).toBe('generated');
    expect(result.records.length).toBe(2);
  });

  it('should remove trailing semicolons', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "SELECT * FROM sales_performance WHERE name = '武莹';",
    });

    const result = await engine.query('查询李明数据');

    expect(result.source).toBe('generated');
    expect(result.sql).not.toContain(';');
  });
});
