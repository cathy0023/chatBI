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
 */
export function setupMGVMessageHandler(handlers: MGVHandlers): () => void {
  function handler(e: MessageEvent) {
    const data = e.data as MGVMessage;
    if (!data?.type) return;

    if (data.type === 'MGV_TABLE_DATA') {
      handlers.onData(data.records ?? [], data.columns ?? [], data.labels ?? data.columns ?? [], data.context);
    } else if (data.type === 'DRAWER_MODE_CHANGE' && handlers.onModeChange) {
      handlers.onModeChange(data.mode);
    }
  }

  window.addEventListener('message', handler);

  return () => {
    window.removeEventListener('message', handler);
  };
}
