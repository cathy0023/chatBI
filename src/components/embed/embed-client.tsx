'use client';

import { useState, useEffect } from 'react';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import { ChatPanel } from '@/components/chat/chat-panel';
import { useEmbedChat } from '@/lib/chat/use-embed-chat';

export function EmbedClient() {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler((recs, cols) => {
      setRecords(recs);
      setColumns(cols);
    });
    window.parent.postMessage({ type: 'CHATBI_READY' }, '*');
    return cleanup;
  }, []);

  const chat = useEmbedChat(records, columns);

  if (records.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">等待数据...</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      {/* 列名展示 */}
      <div className="border-b px-4 py-2 text-xs text-muted-foreground">
        共 {records.length} 条数据 · {columns.length} 列
      </div>

      {/* 主界面 ChatPanel 复用，图表内嵌 */}
      <ChatPanel
        messages={chat.messages}
        isLoading={chat.isLoading}
        error={chat.error}
        sendMessage={chat.sendMessage}
        clearMessages={chat.clearMessages}
        inlineChart={true}
      />
    </div>
  );
}
