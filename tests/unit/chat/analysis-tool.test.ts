import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnalysisTool } from '@/lib/chat/tools/analysis-tool';
import { DEFAULT_TENANT, type ToolContext } from '@/lib/chat/types';

vi.mock('@/lib/llm/provider', () => ({
  generateTextCompat: vi.fn().mockResolvedValue({
    text: '张三表现优异，成交10单领先团队。',
  }),
}));

vi.mock('@/lib/agents/chart-recommender', () => ({
  recommendChart: vi.fn().mockReturnValue({ uiType: 'bar', dimension: 'name', metric: 'deal' }),
  aggregateBy: vi.fn().mockReturnValue({ '张三': 10, '李四': 8 }),
}));

describe('createAnalysisTool', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockSend = vi.fn();
    ctx = {
      tenant: DEFAULT_TENANT,
      sessionId: 'test-session',
      send: mockSend,
      data: [
        { name: '张三', deal: 10 },
        { name: '李四', deal: 8 },
      ],
      columns: ['name', 'deal'],
      originalQuery: '分析销售表现',
    };
  });

  it('returns a tool with description', () => {
    const t = createAnalysisTool(ctx);
    expect(t.description).toContain('分析销售数据');
  });

  it('generates analysis text and sends via SSE', async () => {
    const t = createAnalysisTool(ctx);
    const result = await t.execute({ query: '分析销售表现', focus: '排名' });
    expect(result.analysis).toContain('张三');
    expect(mockSend).toHaveBeenCalledWith('text', expect.objectContaining({
      text: expect.stringContaining('张三'),
    }));
  });

  it('returns fallback message when data is empty', async () => {
    ctx.data = [];
    const t = createAnalysisTool(ctx);
    const result = await t.execute({ query: '分析销售表现' });
    expect(result.analysis).toContain('暂无数据');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
