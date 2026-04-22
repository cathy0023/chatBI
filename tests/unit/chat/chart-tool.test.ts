import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChartTool } from '@/lib/chat/tools/chart-tool';
import { DEFAULT_TENANT, type ToolContext } from '@/lib/chat/types';

vi.mock('@/lib/chart/code-generator', () => ({
  generateChartCode: vi.fn().mockResolvedValue('<html><div>chart</div></html>'),
}));

describe('createChartTool', () => {
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
      originalQuery: '销售排名',
    };
  });

  it('returns a tool with description', () => {
    const t = createChartTool(ctx);
    expect(t.description).toContain('可视化图表');
  });

  it('generates chart HTML and sends via SSE', async () => {
    const t = createChartTool(ctx);
    const result = await t.execute({ chartType: 'bar', dimension: 'name', metric: 'deal' });
    expect(result.generated).toBe(true);
    expect(result.chartType).toBe('bar');
    expect(mockSend).toHaveBeenCalledWith('chart', expect.objectContaining({
      html: expect.any(String),
    }));
  });
});
