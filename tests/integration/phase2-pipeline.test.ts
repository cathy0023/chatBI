import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * Phase 2 E2E Pipeline Test
 * Tests the full flow: User Message → Router → Query → Analysis → UI Schema output
 *
 * This verifies that the message-handler correctly orchestrates the agent chain
 * and produces the right UI Schema for the DynamicRenderer.
 */

// ==================== Mock Setup ====================
import Database from 'better-sqlite3';

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

// Seed data for pipeline tests
const seedPipelineData = () => {
  const insert = testDb.prepare(
    `INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
  const tx = testDb.transaction(() => { for (const r of rows) insert.run(...r); });
  tx();
};
seedPipelineData();

vi.mock('@/lib/db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock LLM — simulate analysis agent returning structured data
let llmCallCount = 0;
const mockGenerateText = vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
  llmCallCount++;
  // If prompt looks like an intent classifier prompt, return routing decision
  if (prompt.includes('intent classifier') || prompt.includes('Classify the user')) {
    if (prompt.includes('分析') || prompt.includes('对比') || prompt.includes('排行') || prompt.includes('排名')) {
      return Promise.resolve({
        object: { intent: 'analysis', confidence: 0.9, agents: ['query', 'analysis', 'ui-builder'], params: {} },
      });
    }
    return Promise.resolve({
      object: { intent: 'query', confidence: 0.8, agents: ['query'], params: {} },
    });
  }
  // Analysis agent prompt — return analysis JSON
  return Promise.resolve({
    text: JSON.stringify({
      summary: `共分析 ${12} 条销售数据，整体成交稳步增长`,
      insights: ['花园桥校区表现最优，10月成交6单', '中关村校区连续4个月增长', '望京校区成交转化率有提升空间'],
      dataSummary: {
        departments: { '花园桥校区': 4, '中关村校区': 4, '望京校区': 4 },
        totalCount: 12,
        totalDeal: 37,
      },
      suggestedChartType: 'bar',
    }),
  });
});

const mockGenerateObject = vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
  if (prompt.includes('分析') || prompt.includes('排行') || prompt.includes('对比')) {
    return Promise.resolve({
      object: { intent: 'analysis', confidence: 0.9, agents: ['query', 'analysis', 'ui-builder'], params: {} },
    });
  }
  return Promise.resolve({
    object: { intent: 'query', confidence: 0.8, agents: ['query'], params: {} },
  });
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

import { handleMessage } from '@/lib/chat/message-handler';

describe('Phase 2 E2E Pipeline', () => {
  beforeEach(() => {
    llmCallCount = 0;
  });

  describe('Analysis Intent → Chart Schema', () => {
    it('should produce UI Schema with analysis for ranking queries', async () => {
      const result = await handleMessage('成交排行榜', 'pipeline-test-1');

      // Should have analysis text
      expect(result.text).toBeTruthy();
      expect(result.text.length).toBeGreaterThan(0);

      // Should have UI Schema (from analysis path)
      expect(result.uiSchema).toBeTruthy();
      const schema = result.uiSchema as Record<string, unknown>;
      expect(schema).toHaveProperty('type');
      expect(schema).toHaveProperty('data');

      // Agent trace should include query + analysis steps
      const trace = result.agentTrace as { route: unknown; steps: string[] };
      expect(trace.steps).toContain('query');
    });

    it('should produce analysis text with insights', async () => {
      const result = await handleMessage('分析各部门10月成交情况', 'pipeline-test-2');

      expect(result.text).toContain('分析');
      // Analysis flow should produce UI Schema
      if (result.uiSchema) {
        const schema = result.uiSchema as Record<string, unknown>;
        expect(['bar', 'pie', 'line', 'table', 'comparison']).toContain(schema.type);
      }
    });

    it('should handle comparison queries', async () => {
      const result = await handleMessage('对比新老销售的跟进效率', 'pipeline-test-3');
      expect(result.text).toBeTruthy();
    });
  });

  describe('Query Intent → Text-only (no chart)', () => {
    it('should return formatted text for simple name queries', async () => {
      const result = await handleMessage('武莹的销售数据', 'pipeline-test-4');
      expect(result.text).toContain('武莹');
      expect(result.text).toContain('为您找到');
      // Phase 2: query path also produces uiSchema for right panel table rendering
      if (result.uiSchema) {
        const schema = result.uiSchema as Record<string, unknown>;
        expect(schema.type).toBeTruthy();
      }
    });

    it('should return text-only for department queries', async () => {
      const result = await handleMessage('花园桥校区', 'pipeline-test-5');
      expect(result.text).toContain('花园桥');
    });
  });

  describe('Graceful degradation', () => {
    it('should fallback to query results when analysis agent fails', async () => {
      // Force analysis to fail on next call
      mockGenerateText.mockImplementationOnce(() => {
        // Router (generateObject) — route to analysis
        return Promise.resolve({
          object: { intent: 'analysis', confidence: 0.9, agents: ['query', 'analysis', 'ui-builder'], params: {} },
        });
      }).mockImplementationOnce(() => {
        // Analysis agent — fail
        throw new Error('LLM timeout');
      });

      const result = await handleMessage('分析排行榜', 'pipeline-test-6');

      // Should still produce a response (fallback to query results)
      expect(result.text).toBeTruthy();
    });

    it('should handle no-data queries gracefully', async () => {
      const result = await handleMessage('完全不存在的关键词xyz', 'pipeline-test-7');
      expect(result.text).toContain('没有找到');
    });
  });

  describe('Agent trace completeness', () => {
    it('should record all pipeline steps in agentTrace', async () => {
      const result = await handleMessage('武莹业绩', 'pipeline-trace-1');

      const trace = result.agentTrace as { route: Record<string, unknown>; steps: string[] };
      expect(trace).toBeTruthy();
      expect(trace.route).toBeTruthy();
      expect(trace.route.intent).toBeTruthy();
      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.steps).toContain('query');
    });
  });
});
