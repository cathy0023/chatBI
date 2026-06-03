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
  inlineChart?: boolean;
  embed?: boolean;
};

export function MessageList({ messages, isLoading, selectedMessageId, onSelectMessage, inlineChart, embed }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isLoading]);

  return (
    <ScrollArea className="flex-1 min-h-0 px-4">
      <div className="flex flex-col gap-2 py-2">
        {messages.length === 0 && !isLoading && (
          <div className={`text-muted-foreground text-sm ${embed ? 'text-center py-3 text-xs' : 'flex flex-1 items-center justify-center py-4'}`}>
            <p>{embed ? '输入问题开始分析' : '开始对话，提出您的数据分析问题'}</p>
          </div>
        )}
        {messages.map(msg => {
  const isUser = msg.role === 'user';
  // For user messages: check if there's a following assistant message with chart data
  const userHasChart = isUser && (() => {
    const idx = messages.indexOf(msg);
    for (let i = idx + 1; i < messages.length; i++) {
      const next = messages[i];
      if (next.role === 'assistant' && (((next.records?.length ?? 0) > 0) || !!next.chartHtml)) {
        return true;
      }
    }
    return false;
  })();
  const hasData = !isUser && ((msg.records?.length ?? 0) > 0 || !!msg.chartHtml);
  const isClickable = (isUser && userHasChart) || hasData;
  const isSelected = msg.id === selectedMessageId;
  return (
    <div
      key={msg.id}
      data-role={msg.role}
      data-phase={msg.phase}
      className={isSelected && isClickable ? 'bg-blue-50/40 dark:bg-blue-900/20 rounded-lg' : ''}
    >
      <MessageItem
        message={msg}
        hasData={isClickable}
        onClick={isClickable && onSelectMessage ? () => onSelectMessage(msg) : undefined}
        inlineChart={inlineChart}
      />
    </div>
  );
})}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
