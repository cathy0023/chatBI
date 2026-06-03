import type { MGVContext } from './types';

interface MGVTableDataMessage {
  type: 'MGV_TABLE_DATA';
  records: Record<string, unknown>[];
  columns: string[];
  labels?: string[];
  context?: MGVContext;
}

interface MGVDrawerModeMessage {
  type: 'DRAWER_MODE_CHANGE';
  mode: 'normal' | 'maximized';
}

type MGVMessage = MGVTableDataMessage | MGVDrawerModeMessage;

export interface MGVHandlers {
  onData: (
    records: Record<string, unknown>[],
    columns: string[],
    labels: string[],
    context?: MGVContext,
  ) => void;
  onModeChange?: (mode: 'normal' | 'maximized') => void;
}

/**
 * 监听 MGV iframe 通过 postMessage 传来的数据。
 * 返回 cleanup 函数，调用后移除监听器。
 *
 * 会自动重放 inline script 缓冲的消息（解决 Vue @load 竞态条件）。
 */
export function setupMGVMessageHandler(handlers: MGVHandlers): () => void {
  const log = (window as any).__chatbiLog || (() => {});
  log('setupMGVMessageHandler called');

  function handler(e: MessageEvent) {
    const data = e.data as MGVMessage;
    if (!data?.type) return;
    log('handler received: type=' + data.type);

    if (data.type === 'MGV_TABLE_DATA') {
      log('calling onData with ' + (data.records?.length ?? 0) + ' records, ' + (data.columns?.length ?? 0) + ' columns');
      handlers.onData(data.records ?? [], data.columns ?? [], data.labels ?? data.columns ?? [], data.context);
    } else if (data.type === 'DRAWER_MODE_CHANGE' && handlers.onModeChange) {
      handlers.onModeChange(data.mode);
    }
  }

  window.addEventListener('message', handler);

  // Stop inline buffer and replay captured messages
  const w = window as unknown as { __CHATBI_BUFFERING?: boolean; __CHATBI_BUFFER?: MessageEvent[] };
  w.__CHATBI_BUFFERING = false;
  const buffer = w.__CHATBI_BUFFER;
  log('buffer length=' + (buffer?.length ?? 'undefined'));
  if (buffer && buffer.length > 0) {
    for (const e of buffer) {
      handler(e);
    }
    buffer.length = 0;
  }

  return () => {
    window.removeEventListener('message', handler);
  };
}
