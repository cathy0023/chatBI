'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChatPanel } from '@/components/chat/chat-panel';
import { RenderArea } from '@/components/renderer/render-area';
import { SessionList } from '@/components/chat/session-list';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useChat, type ChatMessage } from '@/lib/chat/use-chat';

export default function Home() {
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  // Get the selected message's data, or fall back to latest assistant data
  const { activeSchema, activeVisualization } = (() => {
    const findMessageData = (msgId: string | null) => {
      if (msgId) {
        const selected = chat.messages.find(m => m.id === msgId);
        if (selected) {
          return {
            schema: selected.uiSchema ?? null,
            vis: selected.visualization,
          };
        }
      }
      // Default: show latest assistant message's data
      const last = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.uiSchema || m.visualization)
      );
      if (last) {
        return {
          schema: last.uiSchema ?? null,
          vis: last.visualization,
        };
      }
      return { schema: null, vis: undefined };
    };
    return {
      activeSchema: findMessageData(selectedMessageId).schema,
      activeVisualization: findMessageData(selectedMessageId).vis,
    };
  })();

  // Update selectedMessageId when new messages arrive
  useEffect(() => {
    if (!selectedMessageId) {
      const lastAssistantWithData = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.uiSchema || m.visualization)
      );
      if (lastAssistantWithData) {
        setSelectedMessageId(lastAssistantWithData.id);
      }
    }
  }, [chat.messages, selectedMessageId]);

  // Expose setSelectedMessageId via chat panel callback
  const handleSelectMessage = useCallback((msg: ChatMessage) => {
    if (msg.uiSchema || msg.visualization) {
      setSelectedMessageId(prev => prev === msg.id ? null : msg.id);
    }
  }, []);

  // Load messages from a historical session
  const loadSession = useCallback(async (sessionId: string) => {
    setSelectedMessageId(null);
    await chat.loadSessionMessages(sessionId);
  }, [chat]);

  const handleNewSession = useCallback(() => {
    setSelectedMessageId(null);
    chat.clearMessages();
  }, [chat]);

  // Toggle sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="h-7 px-2"
        >
          {sidebarOpen ? '◀' : '▶'}
        </Button>
        <h1 className="text-xl font-bold tracking-tight">ChatBI</h1>
        <span className="text-muted-foreground text-sm">
          AI 驱动的商业智能分析
        </span>
      </header>
      <Separator />

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Session sidebar */}
        {sidebarOpen && (
          <SessionList
            activeSessionId={chat.sessionId}
            onSelectSession={loadSession}
            onNewSession={handleNewSession}
          />
        )}

        {/* Chat + Render area */}
        <div className="grid flex-1 overflow-hidden md:grid-cols-[3fr_2fr]">
          {/* Chat Panel - 60% */}
          <div className="flex h-full flex-col overflow-hidden border-r">
            <ChatPanel
              messages={chat.messages}
              isLoading={chat.isLoading}
              error={chat.error}
              sendMessage={chat.sendMessage}
              clearMessages={handleNewSession}
            />
          </div>

          {/* Dynamic Rendering Area - 40% */}
          <div className="hidden md:flex h-full flex-col overflow-hidden">
            <RenderArea
              schema={activeSchema as Parameters<typeof RenderArea>[0]['schema']}
              isLoading={chat.isLoading}
              visualization={activeVisualization}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
