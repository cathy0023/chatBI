import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeReActLoop } from '@/lib/chat/react-executor';
import { DEFAULT_TENANT, type ToolContext } from '@/lib/chat/types';

// ---- Mocks ----

// Must use indirect reference because vi.mock is hoisted above const declarations
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return { ...actual, generateText: vi.fn() };
});

vi.mock('@/lib/semantic/nl2sql', () => ({
  NL2SQLEngine: vi.fn().mockImplementation(function () {
    return { query: vi.fn().mockResolvedValue({ sql: 'SELECT 1', records: [], columns: [] }) };
  }),
}));

vi.mock('@/lib/db/connection', () => ({
  getDb: vi.fn().mockReturnValue({ prepare: vi.fn() }),
}));

vi.mock('@/lib/llm/provider', () => ({
  getDefaultModel: vi.fn().mockReturnValue('mock-model'),
  generateTextCompat: vi.fn().mockResolvedValue({ text: 'mock analysis' }),
}));

vi.mock('@/lib/chart/code-generator', () => ({
  generateChartCode: vi.fn().mockResolvedValue('<div>chart</div>'),
}));

vi.mock('@/lib/agents/chart-recommender', () => ({
  recommendChart: vi.fn().mockReturnValue({ dimension: 'name', metric: 'deal' }),
  aggregateBy: vi.fn().mockReturnValue({ '张三': 10 }),
}));

vi.mock('@/lib/agents/stats-computer', () => ({
  computeStats: vi.fn().mockReturnValue({}),
  formatStatsPrompt: vi.fn().mockReturnValue('stats'),
}));

// Grab the hoisted mock after module setup
const mockGenerateText = vi.mocked(await import('ai')).generateText;

// ---- Helpers ----

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    tenant: DEFAULT_TENANT,
    sessionId: 'test-session',
    send: vi.fn(),
    data: [],
    columns: [],
    originalQuery: '9月成交top5',
    ...overrides,
  };
}

// ---- Tests ----

describe('executeReActLoop', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeCtx();
  });

  it('returns text result from generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: '张三成交10笔，排名第一。',
      steps: [{ text: '张三成交10笔，排名第一。', toolCalls: [] }],
      toolResults: [],
    });

    const result = await executeReActLoop('9月成交top5', [], ctx);

    expect(result.text).toBe('张三成交10笔，排名第一。');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe('text');
  });

  it('passes tools and stopWhen to generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      steps: [],
      toolResults: [],
    });

    await executeReActLoop('hello', [], ctx);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.stopWhen).toBeDefined();
    expect(callArg.tools).toBeDefined();
    expect(callArg.tools.queryTool).toBeDefined();
    expect(callArg.tools.analysisTool).toBeDefined();
    expect(callArg.tools.chartTool).toBeDefined();
  });

  it('passes chat history as messages', async () => {
    mockGenerateText.mockResolvedValue({
      text: '继续分析',
      steps: [],
      toolResults: [],
    });

    const history = [
      { role: 'user' as const, content: '你好' },
      { role: 'assistant' as const, content: '你好！我是ChatBI助手。' },
    ];

    await executeReActLoop('9月数据如何', history, ctx);

    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！我是ChatBI助手。' },
      { role: 'user', content: '9月数据如何' },
    ]);
  });

  it('sends step events via SSE onStepFinish', async () => {
    const onStepFinish = vi.fn();
    mockGenerateText.mockImplementation(async (opts) => {
      // Simulate the SDK calling onStepFinish for each step
      if (opts.onStepFinish) {
        await opts.onStepFinish({ text: 'thinking...', toolCalls: [] });
        await opts.onStepFinish({ text: '', toolCalls: [{ toolName: 'queryTool' }] });
      }
      return {
        text: '分析完成',
        steps: [
          { text: 'thinking...', toolCalls: [] },
          { text: '', toolCalls: [{ toolName: 'queryTool' }] },
        ],
        toolResults: [{ records: [], columns: [] }],
      };
    });

    const result = await executeReActLoop('查询数据', [], ctx);

    // Verify SSE events were sent
    expect(ctx.send).toHaveBeenCalledTimes(2);
    expect(ctx.send).toHaveBeenCalledWith('step', {
      type: 'text',
      toolName: undefined,
      content: 'thinking...',
    });
    expect(ctx.send).toHaveBeenCalledWith('step', {
      type: 'tool_call',
      toolName: 'queryTool',
      content: '',
    });

    // Verify result includes steps
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].type).toBe('tool_call');
    expect(result.steps[1].toolName).toBe('queryTool');
  });
});
