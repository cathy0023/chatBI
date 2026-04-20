'use client';

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageItem } from './message-item';
import type { ChatMessage } from '@/lib/chat/use-chat';

type MessageListProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  selectedMessageId?: string | null;
  onSelectMessage?: (message: ChatMessage) => void;
};

export function MessageList({ messages, isLoading, selectedMessageId, onSelectMessage }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isLoading]);

  return (
    <ScrollArea className="flex-1 min-h-0 px-4">
      <div className="flex flex-col gap-2 py-2">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm py-4">
            <p>开始对话，提出您的数据分析问题</p>
          </div>
        )}
        {messages.map(msg => {
          const hasData = msg.role === 'assistant' && ((msg.records?.length ?? 0) > 0 || !!msg.chartHtml);
          const isSelected = msg.id === selectedMessageId;
          return (
            <div key={msg.id} data-role={msg.role} data-phase={msg.phase} className={isSelected && hasData ? 'ring-2 ring-blue-400 rounded-lg' : ''}>
              <MessageItem
                message={msg}
                hasData={hasData}
                onClick={hasData && onSelectMessage ? () => onSelectMessage(msg) : undefined}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
