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

  // Get the selected message's uiSchema, or fall back to latest assistant uiSchema
  const activeSchema = (() => {
    if (selectedMessageId) {
      const selected = chat.messages.find(m => m.id === selectedMessageId);
      if (selected?.uiSchema) return selected.uiSchema;
    }
    // Default: show latest assistant message's uiSchema
    return chat.messages.reduce<unknown>((acc, msg) => {
      if (msg.role === 'assistant' && msg.uiSchema) return msg.uiSchema;
      return acc;
    }, null);
  })();

  // Update selectedMessageId when new messages arrive
  useEffect(() => {
    if (!selectedMessageId) {
      const lastAssistantWithSchema = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && m.uiSchema
      );
      if (lastAssistantWithSchema) {
        setSelectedMessageId(lastAssistantWithSchema.id);
      }
    }
  }, [chat.messages, selectedMessageId]);

  // Expose setSelectedMessageId via chat panel callback
  const handleSelectMessage = useCallback((msg: ChatMessage) => {
    if (msg.uiSchema) {
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
            <RenderArea schema={activeSchema as Parameters<typeof RenderArea>[0]['schema']} isLoading={chat.isLoading} />
          </div>
        </div>
      </main>
    </div>
  );
}
