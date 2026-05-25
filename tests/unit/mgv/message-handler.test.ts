import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';

describe('setupMGVMessageHandler', () => {
  const mockAddEventListener = vi.fn();
  const mockRemoveEventListener = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    });
    mockAddEventListener.mockClear();
    mockRemoveEventListener.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('注册 window.addEventListener 并在收到 MGV_TABLE_DATA 时调用回调', () => {
    const records = [{ name: '张三', deal: 100 }];
    const columns = ['name', 'deal'];
    const callback = vi.fn();

    const cleanup = setupMGVMessageHandler(callback);
    expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    const handler = mockAddEventListener.mock.calls[0][1];
    const event = new MessageEvent('message', {
      data: { type: 'MGV_TABLE_DATA', records, columns },
    });
    handler(event);

    expect(callback).toHaveBeenCalledWith(records, columns, undefined);
    cleanup();
    expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('收到带 context 的消息时传递 context', () => {
    const records = [{ name: '张三' }];
    const columns = ['name'];
    const context = { page: 'team-analysis', kanbanId: 123 };
    const callback = vi.fn();

    const cleanup = setupMGVMessageHandler(callback);
    const handler = mockAddEventListener.mock.calls[0][1];
    const event = new MessageEvent('message', {
      data: { type: 'MGV_TABLE_DATA', records, columns, context },
    });
    handler(event);

    expect(callback).toHaveBeenCalledWith(records, columns, context);
    cleanup();
  });

  it('忽略非 MGV_TABLE_DATA 消息', () => {
    const callback = vi.fn();
    const cleanup = setupMGVMessageHandler(callback);

    const handler = mockAddEventListener.mock.calls[0][1];
    const event = new MessageEvent('message', { data: { type: 'OTHER' } });
    handler(event);

    expect(callback).not.toHaveBeenCalled();
    cleanup();
  });

  it('忽略无 type 字段的消息', () => {
    const callback = vi.fn();
    const cleanup = setupMGVMessageHandler(callback);

    const handler = mockAddEventListener.mock.calls[0][1];
    const event = new MessageEvent('message', { data: {} });
    handler(event);

    expect(callback).not.toHaveBeenCalled();
    cleanup();
  });

  it('cleanup 返回移除监听器的函数', () => {
    const cleanup = setupMGVMessageHandler(vi.fn());
    cleanup();
    expect(mockRemoveEventListener).toHaveBeenCalledTimes(1);
  });
});
