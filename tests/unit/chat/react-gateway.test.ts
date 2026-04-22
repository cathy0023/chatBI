import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActGateway } from '@/lib/chat/react-gateway';
import { DEFAULT_TENANT, type RequestContext } from '@/lib/chat/types';

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
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new ReActGateway();
    send = vi.fn();
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
      }),
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
    );
  });

  it('loads and filters chat history for non-greeting queries', async () => {
    mockLoadSessionMessages.mockReturnValue([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！' },
      { role: 'system', content: 'some system message' },
      { role: 'user', content: '9月数据' },
      { role: 'assistant', content: '9月成交汇总如下' },
    ]);

    const ctx = makeCtx({ message: '8月数据' });

    await gateway.execute('8月数据', ctx, send);

    // History passed to executeReActLoop should only contain user/assistant messages
    const historyArg = mockExecuteReActLoop.mock.calls[0][1];
    expect(historyArg).toHaveLength(4);
    expect(historyArg.every((m: { role: string }) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });
});
