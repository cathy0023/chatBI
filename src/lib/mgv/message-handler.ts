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

// Early buffer: capture messages arriving before React mounts
const earlyBuffer: MessageEvent[] = [];

function earlyHandler(e: MessageEvent) {
  const data = e.data as MGVMessage;
  if (data?.type === 'MGV_TABLE_DATA' || data?.type === 'DRAWER_MODE_CHANGE') {
    earlyBuffer.push(e);
  }
}

// Register at module load time — runs before React mounts
if (typeof window !== 'undefined') {
  window.addEventListener('message', earlyHandler);
}

/**
 * 监听 MGV iframe 通过 postMessage 传来的数据。
 * 返回 cleanup 函数，调用后移除监听器。
 *
 * 会自动重放模块加载后、React mount 前收到的消息（解决竞态条件）。
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

  // Stop buffering and replay any messages that arrived before React mounted
  window.removeEventListener('message', earlyHandler);
  for (const e of earlyBuffer) {
    handler(e);
  }
  earlyBuffer.length = 0;

  return () => {
    window.removeEventListener('message', handler);
  };
}
