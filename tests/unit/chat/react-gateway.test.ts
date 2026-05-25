import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActGateway } from '@/lib/chat/react-gateway';
import { DEFAULT_TENANT, type RequestContext } from '@/lib/chat/types';
import type { SSESender } from '@/lib/chat/sse-helper';

// ---- Mocks ----

vi.mock('@/lib/chat/react-executor', () => ({
  executeReActLoop: vi.fn().mockResolvedValue({
    text: '张三成交10笔，排名第一。',
    steps: [{ type: 'text', content: '张三成交10笔，排名第一。' }],
    toolResults: [],
  }),
}));

vi.mock('@/lib/chat/session', () => ({
  ensureSession: vi.fn().mockReturnValue('session-1'),
  persistMessage: vi.fn().mockReturnValue('msg-1'),
  loadSessionMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/db/queries', () => ({
  getSession: vi.fn().mockReturnValue({ id: 'session-1', title: null }),
  updateSessionTitle: vi.fn(),
}));

// Grab hoisted mocks
const mockExecuteReActLoop = vi.mocked(await import('@/lib/chat/react-executor')).executeReActLoop;
const mockPersistMessage = vi.mocked(await import('@/lib/chat/session')).persistMessage;
const mockLoadSessionMessages = vi.mocked(await import('@/lib/chat/session')).loadSessionMessages;

// ---- Helpers ----

function makeCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    sessionId: 'session-1',
    tenant: DEFAULT_TENANT,
    message: '9月成交top5',
    ...overrides,
  };
}

// ---- Tests ----

describe('ReActGateway', () => {
  let gateway: ReActGateway;
  let send: SSESender;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new ReActGateway();
    send = vi.fn() as unknown as SSESender;
  });

  it('returns greeting for greeting messages and does NOT call executeReActLoop', async () => {
    const ctx = makeCtx({ message: '你好' });

    await gateway.execute('你好', ctx, send);

    // Should send greeting text and done
    expect(send).toHaveBeenCalledWith('text', { text: expect.stringContaining('ChatBI') });
    expect(send).toHaveBeenCalledWith('done', {});

    // Should NOT call the ReAct loop
    expect(mockExecuteReActLoop).not.toHaveBeenCalled();

    // Should persist the greeting response
    expect(mockPersistMessage).toHaveBeenCalledWith('session-1', 'assistant', expect.stringContaining('ChatBI'));
  });

  it('calls executeReActLoop for non-greeting messages', async () => {
    const ctx = makeCtx({ message: '9月成交top5' });

    await gateway.execute('9月成交top5', ctx, send);

    expect(mockExecuteReActLoop).toHaveBeenCalledTimes(1);
    expect(mockExecuteReActLoop).toHaveBeenCalledWith(
      '9月成交top5',
      [], // empty history from mock
      expect.objectContaining({
        tenant: DEFAULT_TENANT,
        sessionId: 'session-1',
        originalQuery: '9月成交top5',
        data: [],
        columns: [],
        dataSource: 'local',
        send,
      }),
      null, // no previous query context (empty history)
      undefined, // no embeddedData in local mode
    );
  });

  it('sends done event after execution', async () => {
    const ctx = makeCtx({ message: '各部门成交汇总' });

    await gateway.execute('各部门成交汇总', ctx, send);

    expect(send).toHaveBeenCalledWith('done', {});
  });

  it('persists messages for non-greeting queries', async () => {
    const ctx = makeCtx({ message: '9月成交top5' });

    await gateway.execute('9月成交top5', ctx, send);

    expect(mockPersistMessage).toHaveBeenCalledWith(
      'session-1',
      'assistant',
      '张三成交10笔，排名第一。',
      undefined, // no chart data
    );
  });

  it('loads and filters chat history for non-greeting queries', async () => {
    // Mock loadSessionMessages to return DB rows with all required fields
    mockLoadSessionMessages.mockReturnValue([
      { id: '1', session_id: 'session-1', role: 'user', content: '你好', ui_schema: null, agent_trace: null, created_at: '2026-01-01' },
      { id: '2', session_id: 'session-1', role: 'assistant', content: '你好！', ui_schema: null, agent_trace: null, created_at: '2026-01-01' },
      { id: '3', session_id: 'session-1', role: 'user', content: '9月数据', ui_schema: null, agent_trace: null, created_at: '2026-01-01' },
      { id: '4', session_id: 'session-1', role: 'assistant', content: '9月成交汇总如下', ui_schema: null, agent_trace: null, created_at: '2026-01-01' },
    ]);

    const ctx = makeCtx({ message: '8月数据' });

    await gateway.execute('8月数据', ctx, send);

    // History passed to executeReActLoop should only contain user/assistant messages
    const historyArg = mockExecuteReActLoop.mock.calls[0][1] as Array<{ role: string }>;
    expect(historyArg).toHaveLength(4);
    expect(historyArg.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });
});