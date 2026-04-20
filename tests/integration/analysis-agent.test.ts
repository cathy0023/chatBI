import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';

// ==================== Mocks ====================

const testDb = new Database(':memory:');
testDb.pragma('foreign_keys = ON');
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
const insert = testDb.prepare(
  `INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const seedRows = [
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
  for (const r of seedRows) insert.run(...r);
});
tx();

vi.mock('@/lib/db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock AI SDK to simulate LLM analysis responses
const mockGenerateText = vi.fn().mockResolvedValue({
  text: JSON.stringify({
    summary: '各部门10月成交表现优秀，花园桥校区领先',
    insights: ['花园桥校区成交最高', '中关村校区稳步增长', '加微转化率有提升空间'],
    dataSummary: { departments: { '花园桥校区': 4, '中关村校区': 4 }, totalCount: 8, totalDeal: 29 },
    suggestedChartType: 'bar',
  }),
});

const mockGenerateObject = vi.fn().mockResolvedValue({
  object: {
    summary: '各部门10月成交表现优秀，花园桥校区领先',
    insights: ['花园桥校区成交最高', '中关村校区稳步增长', '加微转化率有提升空间'],
    dataSummary: { departments: { '花园桥校区': 4, '中关村校区': 4 }, totalCount: 8, totalDeal: 29 },
    suggestedChartType: 'bar',
  },
});

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock('@/lib/llm/provider', () => ({
  openai: {},
  DEFAULT_MODEL: 'test-model',
  getDefaultModel: () => 'test-model',
}));

// Import AFTER mocks
import { AnalysisAgent } from '@/lib/agents/analysis-agent';

describe('Analysis Agent', () => {
  let agent: AnalysisAgent;

  beforeAll(() => {
    agent = new AnalysisAgent();
  });

  describe('Input validation', () => {
    it('should accept valid input with records', async () => {
      const records = [
        { name: '武莹', department: '花园桥校区', month: '10月', wechat_added: 15, interaction: 30, demand: 9, deal: 6 },
      ];
      const result = await agent.execute({ query: '各部门10月成交', records });
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('dataSummary');
    });

    it('should reject empty records array', async () => {
      await expect(
        agent.execute({ query: 'test', records: [] }),
      ).rejects.toThrow();
    });

    it('should reject more than 50 records', async () => {
      const records = Array.from({ length: 51 }, (_, i) => ({
        name: `Person${i}`, department: 'dept', month: '1月', wechat_added: 1, interaction: 1, demand: 1, deal: 1,
      }));
      await expect(
        agent.execute({ query: 'test', records }),
      ).rejects.toThrow();
    });
  });

  describe('Output structure', () => {
    it('should return structured analysis with summary and insights', async () => {
      const records = [
        { name: '武莹', department: '花园桥校区', month: '10月', wechat_added: 15, interaction: 30, demand: 9, deal: 6 },
        { name: '李明', department: '中关村校区', month: '10月', wechat_added: 14, interaction: 26, demand: 7, deal: 4 },
      ];
      const result = await agent.execute({ query: '10月成交分析', records });

      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(result.insights)).toBe(true);
      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.dataSummary).toBeTruthy();
      expect(result.suggestedChartType).toBeTruthy();
    });

    it('should include department distribution in dataSummary', async () => {
      const records = [
        { name: '武莹', department: '花园桥校区', month: '10月', wechat_added: 15, interaction: 30, demand: 9, deal: 6 },
        { name: '李明', department: '中关村校区', month: '10月', wechat_added: 14, interaction: 26, demand: 7, deal: 4 },
      ];
      const result = await agent.execute({ query: '部门分析', records });

      const ds = result.dataSummary as Record<string, unknown>;
      expect(ds.departments).toBeTruthy();
      // totalCount is computed by AnalysisAgent from input.records.length
      expect(typeof ds.totalCount).toBe('number');
      expect(ds.totalCount).toBeGreaterThan(0);
    });
  });

  describe('LLM response parsing', () => {
    it('should handle generateObject returning custom analysis', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: { summary: 'test', insights: ['a'], dataSummary: { totalCount: 1 }, suggestedChartType: 'table' },
      });

      const result = await agent.execute({
        query: 'test',
        records: [{ name: 'A', department: 'D', month: '1月', wechat_added: 1, interaction: 1, demand: 1, deal: 1 }],
      });

      expect(result.summary).toBe('test');
      expect(result.insights).toEqual(['a']);
    });

    it('should handle generateObject returning pie chart type', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: { summary: 'raw', insights: ['b'], dataSummary: { totalCount: 1 }, suggestedChartType: 'pie' },
      });

      const result = await agent.execute({
        query: 'test',
        records: [{ name: 'A', department: 'D', month: '1月', wechat_added: 1, interaction: 1, demand: 1, deal: 1 }],
      });

      expect(result.summary).toBe('raw');
      expect(result.suggestedChartType).toBe('pie');
    });

    it('should fallback to defaults for missing optional LLM fields', async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: { summary: '', insights: [], dataSummary: {} },
      });

      const result = await agent.execute({
        query: 'test',
        records: [{ name: 'A', department: 'D', month: '1月', wechat_added: 1, interaction: 1, demand: 1, deal: 1 }],
      });

      expect(result.summary).toBe('');
      expect(result.insights).toEqual([]);
      expect(result.suggestedChartType).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should retry and recover from LLM error on second attempt', async () => {
      // First call throws, second call returns valid object (retry)
      mockGenerateObject
        .mockRejectedValueOnce(new Error('LLM error'))
        .mockResolvedValueOnce({
          object: { summary: 'recovered', insights: ['ok'], dataSummary: {}, suggestedChartType: 'table' },
        });

      // BaseAgent retries once — second attempt should succeed
      const result = await agent.execute({
        query: 'test',
        records: [{ name: 'A', department: 'D', month: '1月', wechat_added: 1, interaction: 1, demand: 1, deal: 1 }],
      });
      expect(result.summary).toBe('recovered');
    });
  });
});
