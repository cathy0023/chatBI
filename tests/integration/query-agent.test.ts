import { describe, it, expect, beforeAll, vi } from 'vitest';
import { QueryAgent } from '@/lib/agents/query-agent';

// Mock the DB connection module to use an isolated test DB
// We need to set up the mock BEFORE importing anything that transitively imports getDb
const mockGetDb = vi.hoisted(() => {
  let _db: unknown = null;
  return {
    getDb: () => _db,
    setDb: (db: unknown) => { _db = db; },
  };
});

vi.mock('@/lib/db/connection', () => ({
  getDb: () => mockGetDb.getDb(),
  closeDb: () => {},
}));

import Database from 'better-sqlite3';

function createAndSeedTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
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
  `);

  const insert = db.prepare(
    `INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = [
    ['武莹', '花园桥校区', '7月', 10, 20, 5, 3],
    ['武莹', '花园桥校区', '8月', 12, 25, 7, 4],
    ['武莹', '花园桥校区', '9月', 8, 18, 4, 2],
    ['武莹', '花园桥校区', '10月', 15, 30, 9, 6],
    ['李明', '中关村校区', '7月', 9, 15, 4, 2],
    ['李明', '中关村校区', '8月', 11, 22, 6, 3],
    ['李明', '中关村校区', '9月', 13, 28, 8, 5],
    ['李明', '中关村校区', '10月', 14, 26, 7, 4],
    ['张三', '望京校区', '7月', 7, 12, 3, 1],
    ['张三', '望京校区', '8月', 8, 14, 4, 2],
    ['张三', '望京校区', '9月', 9, 16, 5, 3],
    ['张三', '望京校区', '10月', 10, 18, 6, 3],
  ] as const;
  const tx = db.transaction(() => {
    for (const r of rows) {
      insert.run(...r);
    }
  });
  tx();

  return db;
}

describe('Query Agent - Sales Search', () => {
  let queryAgent: QueryAgent;

  beforeAll(() => {
    const testDb = createAndSeedTestDb();
    mockGetDb.setDb(testDb);
    queryAgent = new QueryAgent();
  });

  describe('Search by name', () => {
    it('should find records by full name', async () => {
      const result = await queryAgent.execute({ query: '武莹', searchType: 'sales' });
      expect(result.totalCount).toBe(4);
      expect(result.records[0].name).toBe('武莹');
      expect(result.searchType).toBe('sales');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return empty for unknown name', async () => {
      const result = await queryAgent.execute({ query: '不存在的员工', searchType: 'sales' });
      expect(result.totalCount).toBe(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe('Search by department', () => {
    it('should find records by department short name', async () => {
      const result = await queryAgent.execute({ query: '花园桥', searchType: 'sales' });
      expect(result.totalCount).toBe(4);
      result.records.forEach(r => expect(r.department).toBe('花园桥校区'));
    });
  });

  describe('Search by month', () => {
    it('should find records by month', async () => {
      const result = await queryAgent.execute({ query: '10月', searchType: 'sales' });
      expect(result.totalCount).toBe(3);
      result.records.forEach(r => expect(r.month).toBe('10月'));
    });
  });

  describe('Ranking queries', () => {
    it('should return top performers for ranking keyword', async () => {
      const result = await queryAgent.execute({ query: '成交排行榜', searchType: 'sales' });
      expect(result.totalCount).toBeGreaterThan(0);
      // 武莹 10月 (deal=6) should be first
      expect(result.records[0].deal).toBe(6);
    });
  });

  describe('Input validation', () => {
    it('should reject empty query', async () => {
      await expect(queryAgent.execute({ query: '', searchType: 'sales' })).rejects.toThrow();
    });

    it('should default searchType to sales', async () => {
      // When searchType is omitted, it defaults to 'sales'
      const result = await queryAgent.execute({ query: '武莹' });
      expect(result.searchType).toBe('sales');
    });
  });

  describe('Confidence scoring', () => {
    it('should follow formula: min(0.6 + count * 0.02, 0.95)', async () => {
      const result = await queryAgent.execute({ query: '武莹', searchType: 'sales' });
      // 4 records → 0.6 + 4 * 0.02 = 0.68
      expect(result.confidence).toBeCloseTo(0.68, 1);
    });

    it('should return 0 confidence for no results', async () => {
      const result = await queryAgent.execute({ query: '不存在的员工', searchType: 'sales' });
      expect(result.confidence).toBe(0);
    });

    it('should cap confidence at 0.95', async () => {
      // Even with many results, confidence should not exceed 0.95
      const result = await queryAgent.execute({ query: '花园桥', searchType: 'sales' });
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });
  });
});
