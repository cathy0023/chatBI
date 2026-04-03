'use client';

import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageList } from './message-list';
import { ChatInput } from './chat-input';
import { useChat } from '@/lib/chat/use-chat';

export function ChatPanel() {
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat();

  return (
    <div className="flex h-full flex-col">
      {/* Chat Panel Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">对话</h2>
          {messages.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {messages.length} 条消息
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearMessages}
          disabled={messages.length === 0}
        >
          清空
        </Button>
      </div>
      <Separator />

      {/* Error display */}
      {error && (
        <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Messages */}
      <MessageList messages={messages} isLoading={isLoading} />

      {/* Input */}
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
