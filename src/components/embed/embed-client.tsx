'use client';

import { useState, useEffect, useCallback } from 'react';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import { ChatPanel } from '@/components/chat/chat-panel';
import { SessionList } from '@/components/chat/session-list';
import { ChartDisplay } from '@/components/embed/chart-display';
import { useEmbedChat } from '@/lib/chat/use-embed-chat';
import type { ChatMessage } from '@/lib/chat/use-chat';

export function EmbedClient() {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [layoutMode, setLayoutMode] = useState<'normal' | 'maximized'>(() => {
    try {
      const saved = localStorage.getItem('chatbi_embed_layout');
      return saved === 'maximized' ? 'maximized' : 'normal';
    } catch { return 'normal'; }
  });

  // Message selection (mirrors page.tsx logic)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isManualSelection, setIsManualSelection] = useState(false);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler({
      onData: (recs, cols, lbls) => {
        setRecords(recs);
        setColumns(cols);
        setLabels(lbls);
        setDataVersion((v) => v + 1);
      },
      onModeChange: (mode) => {
        setLayoutMode(mode);
        try { localStorage.setItem('chatbi_embed_layout', mode); } catch { /* ignore */ }
      },
    });
    window.parent.postMessage({ type: 'CHATBI_READY' }, '*');
    return cleanup;
  }, []);

  const chat = useEmbedChat(records, columns, labels);

  // Compute activeMessage for chart display
  const activeMessage = (() => {
    if (selectedMessageId) {
      const selected = chat.messages.find(m => m.id === selectedMessageId);
      if (selected && selected.role === 'assistant' && (selected.records || selected.chartHtml || selected.chartOption)) {
        return selected;
      }
    }
    const last = [...chat.messages].reverse().find(
      m => m.role === 'assistant' && (m.records || m.chartHtml || m.chartOption),
    );
    return last || null;
  })();

  // Auto-follow latest message when not manually selected
  useEffect(() => {
    if (!isManualSelection) {
      const lastWithData = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.records || m.chartHtml || m.chartOption),
      );
      if (lastWithData) {
        setSelectedMessageId(lastWithData.id);
      }
    }
  }, [chat.messages, isManualSelection]);

  const handleSelectMessage = useCallback((msg: ChatMessage) => {
    const isDeselecting = selectedMessageId === msg.id;
    if (isDeselecting) {
      setSelectedMessageId(null);
      setIsManualSelection(false);
      return;
    }

    let targetId = msg.id;
    if (msg.role === 'user') {
      const idx = chat.messages.findIndex(m => m.id === msg.id);
      for (let i = idx + 1; i < chat.messages.length; i++) {
        const m = chat.messages[i];
        if (m.role === 'assistant' && (((m.records?.length ?? 0) > 0) || !!m.chartHtml || !!m.chartOption)) {
          targetId = m.id;
          break;
        }
      }
    }

    setSelectedMessageId(targetId);
    setIsManualSelection(true);
  }, [selectedMessageId, chat.messages]);

  const handleSendMessage = useCallback((content: string) => {
    setIsManualSelection(false);
    setSelectedMessageId(null);
    chat.sendMessage(content);
  }, [chat]);

  const clearAndReset = useCallback(() => {
    chat.clearMessages();
  }, [chat]);

  const handleLoadSession = useCallback(async (targetSessionId: string) => {
    setSelectedMessageId(null);
    setIsManualSelection(false);
    await chat.loadSessionMessages(targetSessionId);
  }, [chat]);

  const handleNewSession = useCallback(() => {
    setSelectedMessageId(null);
    setIsManualSelection(false);
    chat.clearMessages();
  }, [chat]);

  const showDataChangePrompt = dataVersion > 1 && chat.messages.length > 0;

  if (records.length === 0 && chat.messages.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">等待数据...</div>
      </div>
    );
  }

  // Normal mode: compact single-column layout
  if (layoutMode === 'normal') {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden">
        {showDataChangePrompt && (
          <div className="bg-amber-50 border-b px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0">
            <span className="text-xs text-amber-800">数据已更新，切换到新数据？</span>
            <div className="flex gap-1.5">
              <button
                className="text-xs px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={clearAndReset}
              >
                切换
              </button>
              <button
                className="text-xs px-2 py-0.5 rounded text-muted-foreground hover:bg-muted"
                onClick={() => setDataVersion(1)}
              >
                继续
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0">
          <ChatPanel
            messages={chat.messages}
            isLoading={chat.isLoading}
            error={chat.error}
            sendMessage={handleSendMessage}
            clearMessages={chat.clearMessages}
            inlineChart={true}
            embed={true}
          />
        </div>

        <div className="flex-shrink-0 border-t px-3 py-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/60">
            {records.length}条 · {columns.length}列
          </span>
        </div>
      </div>
    );
  }

  // Maximized mode: three-column layout (sidebar + chat + chart)
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left: Session sidebar */}
      <SessionList
        activeSessionId={chat.sessionId}
        onSelectSession={handleLoadSession}
        onNewSession={handleNewSession}
      />

      {/* Center: Chat */}
      <div className="flex flex-col min-h-0 border-r" style={{ width: '40%' }}>
        {showDataChangePrompt && (
          <div className="bg-amber-50 border-b px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0">
            <span className="text-xs text-amber-800">数据已更新，切换到新数据？</span>
            <div className="flex gap-1.5">
              <button
                className="text-xs px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={clearAndReset}
              >
                切换
              </button>
              <button
                className="text-xs px-2 py-0.5 rounded text-muted-foreground hover:bg-muted"
                onClick={() => setDataVersion(1)}
              >
                继续
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ChatPanel
            messages={chat.messages}
            isLoading={chat.isLoading}
            error={chat.error}
            sendMessage={handleSendMessage}
            clearMessages={handleNewSession}
            selectedMessageId={selectedMessageId}
            onSelectMessage={handleSelectMessage}
            inlineChart={false}
            embed={true}
          />
        </div>
      </div>

      {/* Right: Chart + Data display */}
      <div className="flex-1 min-h-0">
        <ChartDisplay message={activeMessage} isLoading={chat.isLoading} />
      </div>
    </div>
  );
}
