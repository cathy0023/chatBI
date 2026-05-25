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
  const [isManualSelection, setIsManualSelection] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'chart'>('chat');

  // Get the active message for the render area
  const activeMessage = (() => {
    // Manual selection takes priority
    if (selectedMessageId) {
      const selected = chat.messages.find(m => m.id === selectedMessageId);
      if (selected && selected.role === 'assistant' && (selected.records || selected.chartHtml)) {
        return selected;
      }
    }
    // Default: latest assistant message with data
    const last = [...chat.messages].reverse().find(
      m => m.role === 'assistant' && (m.records || m.chartHtml),
    );
    return last || null;
  })();

  // Auto-follow latest message when not manually selected
  useEffect(() => {
    if (!isManualSelection) {
      const lastWithData = [...chat.messages].reverse().find(
        m => m.role === 'assistant' && (m.records || m.chartHtml),
      );
      if (lastWithData) {
        setSelectedMessageId(lastWithData.id);
      }
    }
  }, [chat.messages, isManualSelection]);

  // Auto-switch to chart view on mobile when chart becomes available
  useEffect(() => {
    const last = [...chat.messages].reverse().find(
      m => m.role === 'assistant' && m.chartHtml,
    );
    if (last && mobileView === 'chat') {
      setMobileView('chart');
    }
  }, [chat.messages]);

  const handleSelectMessage = useCallback((msg: ChatMessage) => {
    const isDeselecting = selectedMessageId === msg.id;
    if (isDeselecting) {
      setSelectedMessageId(null);
      setIsManualSelection(false);
      return;
    }

    // If user message: find the next assistant message with chart data
    let targetId = msg.id;
    if (msg.role === 'user') {
      const idx = chat.messages.findIndex(m => m.id === msg.id);
      for (let i = idx + 1; i < chat.messages.length; i++) {
        const m = chat.messages[i];
        if (m.role === 'assistant' && (((m.records?.length ?? 0) > 0) || !!m.chartHtml)) {
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
    setMobileView('chat');
    chat.sendMessage(content);
  }, [chat]);

  const loadSession = useCallback(async (sessionId: string) => {
    setSelectedMessageId(null);
    setIsManualSelection(false);
    await chat.loadSessionMessages(sessionId);
  }, [chat]);

  const handleNewSession = useCallback(() => {
    setSelectedMessageId(null);
    setIsManualSelection(false);
    chat.clearMessages();
  }, [chat]);

  // Toggle sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
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

        {/* Mobile: Tab-based single panel — CSS Grid guarantees definite heights */}
        <div className="grid min-h-0 flex-1 overflow-hidden md:hidden" style={{ gridTemplateRows: 'auto 1fr', height: '100%' }}>
          {/* Mobile tab bar */}
          <div className="flex border-b">
            <button
              className={`flex-1 py-2 text-sm font-medium ${mobileView === 'chat' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-muted-foreground'}`}
              onClick={() => setMobileView('chat')}
            >
              对话
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium ${mobileView === 'chart' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-muted-foreground'}`}
              onClick={() => setMobileView('chart')}
            >
              图表
            </button>
          </div>
          {/* Active mobile view — 1fr track gives definite height */}
          <div className="min-h-0 overflow-hidden">
            {mobileView === 'chat' ? (
              <ChatPanel
                messages={chat.messages}
                isLoading={chat.isLoading}
                error={chat.error}
                sendMessage={handleSendMessage}
                clearMessages={handleNewSession}
                selectedMessageId={selectedMessageId}
                onSelectMessage={handleSelectMessage}
              />
            ) : (
              <RenderArea message={activeMessage} isLoading={chat.isLoading} />
            )}
          </div>
        </div>

        {/* Desktop: side-by-side layout */}
        <div className="hidden md:grid flex-1 overflow-hidden md:grid-cols-[3fr_2fr]">
          {/* Chat Panel - 60% */}
          <div className="flex h-full flex-col overflow-hidden border-r">
            <ChatPanel
              messages={chat.messages}
              isLoading={chat.isLoading}
              error={chat.error}
              sendMessage={handleSendMessage}
              clearMessages={handleNewSession}
              selectedMessageId={selectedMessageId}
              onSelectMessage={handleSelectMessage}
            />
          </div>

          {/* Dynamic Rendering Area - 40% */}
          <div data-testid="render-area" className="flex h-full flex-col overflow-hidden">
            <RenderArea
              message={activeMessage}
              isLoading={chat.isLoading}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
