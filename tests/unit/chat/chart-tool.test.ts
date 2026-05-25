import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChartTool } from '@/lib/chat/tools/chart-tool';
import { DEFAULT_TENANT, type ToolContext } from '@/lib/chat/types';
import type { SSESender } from '@/lib/chat/sse-helper';

vi.mock('@/lib/chart/code-generator', () => ({
  generateChartCode: vi.fn().mockResolvedValue('<html><div>chart</div></html>'),
}));

describe('createChartTool', () => {
  let mockSend: SSESender;
  let ctx: ToolContext;

  beforeEach(() => {
    mockSend = vi.fn() as unknown as SSESender;
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

  it('stores chart HTML in tool context (SSE sent by gateway)', async () => {
    const t = createChartTool(ctx);
    const result = await t.execute!({ chartType: 'bar', dimension: 'name', metric: 'deal' }, { toolCallId: 'tc-1', messages: [] });
    expect((result as { generated: boolean }).generated).toBe(true);
    expect((result as { chartType: string }).chartType).toBe('bar');
    // chartTool no longer sends `chart` SSE directly — gateway sends it after ReAct loop
    expect(mockSend).not.toHaveBeenCalledWith('chart', expect.anything());
    expect(ctx.chartHtml).toBeTruthy();
  });
});