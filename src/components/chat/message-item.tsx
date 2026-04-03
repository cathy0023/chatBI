'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import type { ChatMessage } from '@/lib/chat/use-chat';

type MessageItemProps = {
  message: ChatMessage;
};

/**
 * Minimal inline markdown rendering.
 * Handles bold (**text**), headers (## ), and bullet lists (- ).
 */
function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const htmlLines = lines.map(line => {
    let processed = line
      // Headers: ## Heading -> <strong>Heading</strong>
      .replace(/^#{1,6}\s+(.+)$/, '<strong class="text-base">$1</strong>')
      // Bold: **text** -> <strong>text</strong>
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Bullet list: - item -> padded item
      .replace(/^[-*]\s+(.+)$/, '<span class="ml-3 block">&#8226; $1</span>');

    return processed;
  });
  return htmlLines.join('<br />');
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={isUser ? 'bg-blue-600 text-white text-xs' : 'bg-muted text-xs'}>
          {isUser ? 'U' : 'AI'}
        </AvatarFallback>
      </Avatar>
      <Card className={`max-w-[80%] ${isUser ? 'bg-blue-600 text-white' : 'bg-muted'}`}>
        <CardContent className="px-3 py-2 text-sm">
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
