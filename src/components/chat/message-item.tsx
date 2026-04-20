'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import type { ChatMessage } from '@/lib/chat/use-chat';
import { getPhaseLabel } from '@/lib/chat/use-chat';

type MessageItemProps = {
  message: ChatMessage;
  hasData?: boolean;
  onClick?: () => void;
};

export function MessageItem({ message, hasData, onClick }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isLoading = message.phase && message.phase !== 'done' && message.phase !== 'error';
  const phaseLabel = getPhaseLabel(message.phase);

  return (
    <div
      className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${hasData ? 'cursor-pointer hover:bg-muted/50 rounded-lg p-1 -mx-1' : ''}`}
      onClick={onClick}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className={isUser ? 'bg-blue-600 text-white text-xs' : 'bg-muted text-xs'}>
          {isUser ? 'U' : 'AI'}
        </AvatarFallback>
      </Avatar>
      <Card className={`max-w-[80%] py-1 ${isUser ? 'bg-blue-600 text-white' : 'bg-muted'} ${isLoading ? 'ring-1 ring-blue-300' : ''}`}>
        <CardContent className="px-3 py-1.5 text-sm">
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <>
              {isLoading && phaseLabel && (
                <div className="flex items-center gap-2 mb-2 text-blue-600">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  <span className="text-xs">{phaseLabel}</span>
                </div>
              )}
              {message.content ? (
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-1.5 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-1 prose-pre:my-1 prose-blockquote:my-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              ) : !isLoading ? (
                <span className="text-muted-foreground">...</span>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
