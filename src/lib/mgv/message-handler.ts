import type { MGVContext } from './types';

interface MGVMessage {
  type: 'MGV_TABLE_DATA';
  records: Record<string, unknown>[];
  columns: string[];
  context?: MGVContext;
}

/**
 * 监听 MGV iframe 通过 postMessage 传来的数据。
 * 返回 cleanup 函数，调用后移除监听器。
 */
export function setupMGVMessageHandler(
  onData: (
    records: Record<string, unknown>[],
    columns: string[],
    context?: MGVContext,
  ) => void,
): () => void {
  function handler(e: MessageEvent) {
    const data = e.data as MGVMessage;
    if (data?.type === 'MGV_TABLE_DATA') {
      onData(data.records ?? [], data.columns ?? [], data.context);
    }
  }

  window.addEventListener('message', handler);

  return () => {
    window.removeEventListener('message', handler);
  };
}
