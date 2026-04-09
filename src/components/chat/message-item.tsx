'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import type { ChatMessage } from '@/lib/chat/use-chat';

type MessageItemProps = {
  message: ChatMessage;
  isSelected?: boolean;
  onClick?: (message: ChatMessage) => void;
};

export function MessageItem({ message, isSelected, onClick }: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={`message-${message.id}`}
      data-role={message.role}
      className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${!isUser && message.uiSchema ? 'cursor-pointer hover:bg-muted/50 rounded-lg p-1 -mx-1' : ''}`}
      onClick={() => {
        if (!isUser && message.uiSchema && onClick) {
          onClick(message);
        }
      }}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className={isUser ? 'bg-blue-600 text-white text-xs' : 'bg-muted text-xs'}>
          {isUser ? 'U' : 'AI'}
        </AvatarFallback>
      </Avatar>
      <Card className={`max-w-[80%] py-1 ${isUser ? 'bg-blue-600 text-white' : 'bg-muted'} ${isSelected && !isUser ? 'ring-2 ring-blue-400' : ''}`}>
        <CardContent className="px-3 py-1.5 text-sm">
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-1.5 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-1 prose-pre:my-1 prose-blockquote:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
