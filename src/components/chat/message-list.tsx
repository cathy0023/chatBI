'use client';

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageItem } from './message-item';
import type { ChatMessage } from '@/lib/chat/use-chat';

type MessageListProps = {
  messages: ChatMessage[];
  isLoading: boolean;
};

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <ScrollArea className="flex-1 px-4">
      <div className="flex flex-col gap-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm py-12">
            <p>开始对话，提出您的数据分析问题</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageItem key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
