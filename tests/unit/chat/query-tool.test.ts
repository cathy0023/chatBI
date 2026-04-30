import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createQueryTool } from '@/lib/chat/tools/query-tool';
import { DEFAULT_TENANT, type ToolContext } from '@/lib/chat/types';

vi.mock('@/lib/semantic/nl2sql', () => ({
  NL2SQLEngine: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue({
        sql: 'SELECT name, deal FROM sales_performance LIMIT 5',
        records: [
          { name: '张三', deal: 10 },
          { name: '李四', deal: 8 },
        ],
        columns: ['name', 'deal'],
        confidence: 0.9,
        source: 'generated',
      }),
    };
  }),
}));

vi.mock('@/lib/db/connection', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ cnt: 0 }),
    }),
  }),
}));

describe('createQueryTool', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockSend = vi.fn();
    ctx = {
      tenant: DEFAULT_TENANT,
      sessionId: 'test-session',
      send: mockSend,
      data: [],
      columns: [],
      originalQuery: '9月成交top5',
    };
  });

  it('returns a tool with description and inputSchema', () => {
    const t = createQueryTool(ctx);
    expect(t.description).toContain('查询销售数据');
    expect(t.inputSchema).toBeDefined();
  });

  it('executes query and returns structured result', async () => {
    const t = createQueryTool(ctx);
    const result = await t.execute({ query: '9月成交top5' });
    expect(result.records).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(['name', 'deal']);
  });

  it('sends SSE data event with query results', async () => {
    const t = createQueryTool(ctx);
    await t.execute({ query: '9月成交top5' });
    expect(mockSend).toHaveBeenCalledWith('data', expect.objectContaining({
      sql: expect.any(String),
      records: expect.any(Array),
      columns: expect.any(Array),
    }));
  });
});
