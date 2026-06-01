'use client';

import { useState, useEffect, useCallback } from 'react';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import { ChatPanel } from '@/components/chat/chat-panel';
import { useEmbedChat } from '@/lib/chat/use-embed-chat';

export function EmbedClient() {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler((recs, cols) => {
      setRecords(recs);
      setColumns(cols);
      setDataVersion((v) => v + 1);
    });
    window.parent.postMessage({ type: 'CHATBI_READY' }, '*');
    return cleanup;
  }, []);

  const chat = useEmbedChat(records, columns);

  const clearAndReset = useCallback(() => {
    chat.clearMessages();
  }, [chat]);

  const showDataChangePrompt = dataVersion > 1 && chat.messages.length > 0;

  if (records.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">等待数据...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* 列名展示 */}
      <div className="border-b px-4 py-2 text-xs text-muted-foreground flex-shrink-0">
        共 {records.length} 条数据 · {columns.length} 列
      </div>

      {/* 数据变化提示 */}
      {showDataChangePrompt && (
        <div className="bg-amber-50 border-b px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
          <span className="text-sm text-amber-800">数据已更新，是否切换到新数据分析？</span>
          <div className="flex gap-2">
            <button
              className="text-xs px-3 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
              onClick={clearAndReset}
            >
              切换新数据
            </button>
            <button
              className="text-xs px-3 py-1 rounded text-muted-foreground hover:bg-muted"
              onClick={() => setDataVersion(1)}
            >
              继续当前
            </button>
          </div>
        </div>
      )}

      {/* 主界面 ChatPanel 复用，图表内嵌 */}
      <div className="flex-1 min-h-0">
        <ChatPanel
          messages={chat.messages}
          isLoading={chat.isLoading}
          error={chat.error}
          sendMessage={chat.sendMessage}
          clearMessages={chat.clearMessages}
          inlineChart={true}
        />
      </div>
    </div>
  );
}
