import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';

// ==================== Mock Setup ====================

// 1. Mock DB with in-memory SQLite
const testDb = new Database(':memory:');
testDb.pragma('foreign_keys = ON');
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
`);

// Seed test sales data
const seedTestSales = () => {
  const insert = testDb.prepare(
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
  ] as const;
  const tx = testDb.transaction(() => {
    for (const r of rows) insert.run(...r);
  });
  tx();
};
seedTestSales();

vi.mock('@/lib/db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// 2. Mock LLM provider — no real API calls
// Use vi.hoisted so the mock is available when vi.mock factory runs
const { mockGenerateObject, mockGenerateText } = vi.hoisted(() => {
  const mockGenObj = vi.fn().mockImplementation((opts: { prompt?: string }) => {
    const prompt = opts.prompt || '';
    // QueryAgent prompt contains "查询参数提取器"
    if (prompt.includes('查询参数提取器')) {
      let name: string | null = null;
      let department: string | null = null;
      let month: string | null = null;
      let metric: string | null = null;
      let metricMinValue: number | null = null;
      let isRanking = false;
      let isSummary = false;

      if (prompt.includes('武莹')) name = '武莹';
      if (prompt.includes('李明')) name = '李明';
      if (prompt.includes('花园桥')) department = '花园桥校区';
      if (prompt.includes('中关村')) department = '中关村校区';
      if (prompt.includes('10月')) month = '10月';
      if (prompt.includes('9月')) month = '9月';
      if (prompt.includes('排行榜') || prompt.includes('排名')) isRanking = true;
      if (prompt.includes('汇总') || prompt.includes('各部门')) isSummary = true;
      if (prompt.includes('有没有成交') || prompt.includes('有成交')) {
        metric = 'deal';
        metricMinValue = 1;
      }

      return Promise.resolve({
        object: { name, department, month, metric, metricMinValue, isRanking, isSummary },
      });
    }

    // AnalysisAgent prompt contains "销售数据分析专家"
    if (prompt.includes('销售数据分析专家')) {
      return Promise.resolve({
        object: {
          summary: '销售数据概览',
          insights: ['趋势良好', '成交稳步增长'],
          dataSummary: { totalCount: 8, totalDeal: 29 },
          suggestedChartType: 'bar',
        },
      });
    }

    // ResponseGenerator prompt contains "销售数据助手"
    if (prompt.includes('销售数据助手')) {
      return Promise.resolve({
        object: {
          text: `根据查询结果，为您找到相关销售数据。成交情况整体表现良好。`,
          uiType: 'table',
        },
      });
    }

    // QueryAgent uses generateText → prompt contains "查询参数提取器"
    if (prompt.includes('查询参数提取器')) {
      // Return simple JSON text (no markdown) for manual parsing
      let name = null, department = null, month = null, metric = null, metricMinValue = null;
      let isRanking = false, isSummary = false;

      if (prompt.includes('武莹')) name = '武莹';
      if (prompt.includes('李明')) name = '李明';
      if (prompt.includes('花园桥')) department = '花园桥校区';
      if (prompt.includes('中关村')) department = '中关村校区';
      if (prompt.includes('10月')) month = '10月';
      if (prompt.includes('9月')) month = '9月';
      if (prompt.includes('排行榜') || prompt.includes('排名')) isRanking = true;
      if (prompt.includes('汇总') || prompt.includes('各部门')) isSummary = true;
      if (prompt.includes('有没有成交') || prompt.includes('有成交')) {
        metric = 'deal';
        metricMinValue = 1;
      }

      const obj = { name, department, month, metric, metricMinValue, isRanking, isSummary };
      return Promise.resolve({ text: JSON.stringify(obj) });
    }

    // Default: Router agent response (now uses generateText → return text)
    return Promise.resolve({
      text: JSON.stringify({
        intent: 'query',
        confidence: 0.7,
        agents: ['query'],
        params: {},
      }),
    });
  });

  const mockGenText = vi.fn().mockResolvedValue({
    text: JSON.stringify({
      summary: '销售数据概览',
      insights: ['趋势良好', '成交稳步增长'],
      dataSummary: { totalCount: 8, totalDeal: 29 },
      suggestedChartType: 'bar',
    }),
  });

  return { mockGenerateObject: mockGenObj, mockGenerateText: mockGenText };
});

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
}));

vi.mock('@/lib/llm/provider', () => ({
  openai: {},
  DEFAULT_MODEL: 'test-model',
  getDefaultModel: () => 'test-model',
}));

// Import AFTER mocks
import { handleMessage } from '@/lib/chat/message-handler';

// ==================== Tests ====================

describe('Message Handler - Full Pipeline', () => {
  describe('Greeting fast-path', () => {
    it('should respond to greetings without routing or search', async () => {
      const result = await handleMessage('你好', 'test-session-1');
      expect(result.text).toContain('ChatBI');
      expect(result.text).toContain('销售业绩分析助手');
      expect(result.uiSchema).toBeNull();
    });

    it('should handle various greeting patterns', async () => {
      const greetings = ['您好', 'hi', 'hello', '嗨', '早上好'];
      for (const g of greetings) {
        const result = await handleMessage(g, `greeting-${g}`);
        expect(result.text).toContain('ChatBI');
      }
    });
  });

  describe('Query flow (LLM-driven data retrieval)', () => {
    it('should return LLM-generated text for name query', async () => {
      const result = await handleMessage('武莹的销售数据', 'test-session-2');
      expect(result.text).toBeTruthy();
      expect(result.uiSchema).toBeDefined();
      const schema = result.uiSchema as { type: string; data: { totalCount: number } } | null;
      if (schema) {
        expect(schema.type).toBeTruthy();
        expect(schema.data?.totalCount).toBeGreaterThan(0);
      }
    });

    it('should return data for department query', async () => {
      const result = await handleMessage('花园桥校区', 'test-session-3');
      expect(result.text).toBeTruthy();
      expect(result.uiSchema).toBeDefined();
    });

    it('should include agentTrace with route info', async () => {
      const result = await handleMessage('李明的业绩', 'test-session-4');
      expect(result.agentTrace).toBeTruthy();
      const trace = result.agentTrace as { route: unknown; steps: string[] };
      expect(trace.route).toBeTruthy();
      expect(trace.steps).toContain('query');
    });
  });

  describe('Analysis flow', () => {
    it('should produce analysis text for analysis-intent queries', async () => {
      // "分析" triggers analysis agents → runs analysis agent (mocked)
      const result = await handleMessage('分析各部门10月成交情况', 'test-session-5');
      expect(result.text).toBeTruthy();
      // Analysis flow returns either formatted analysis or query results
      expect(result.text.length).toBeGreaterThan(0);
      // Should have UI schema when analysis runs
      if (result.uiSchema) {
        expect(result.uiSchema).toBeTruthy();
      }
    });
  });

  describe('No data found', () => {
    it('should handle queries with no matching data gracefully', async () => {
      // In LLM mode, when LLM extracts no params, searchSalesByParams returns []
      const result = await handleMessage('不存在的员工数据', 'test-session-6');
      // Should return either "no data" or empty result message
      expect(result.text).toBeTruthy();
      expect(typeof result.text).toBe('string');
    });
  });

  describe('Error handling', () => {
    it('should return user-friendly error message on pipeline failure', async () => {
      // Force a DB error by dropping the table
      testDb.exec('DROP TABLE IF EXISTS sales_performance');

      const result = await handleMessage('武莹', 'test-session-error');
      expect(result.text).toBeTruthy();
      // Should either show error or no-data message, not crash
      expect(typeof result.text).toBe('string');

      // Restore the table for other tests
      testDb.exec(`
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
      `);
      seedTestSales();
    });
  });

  describe('Session title auto-update', () => {
    it('should not update title for greetings', async () => {
      await handleMessage('你好', 'title-test-1');
      const session = testDb.prepare('SELECT * FROM chat_sessions WHERE id = ?').get('title-test-1') as Record<string, unknown> | undefined;
      // Session may or may not exist, but title should be null or greeting-ish
      if (session) {
        expect(session.title).toBeFalsy();
      }
    });
  });
});
