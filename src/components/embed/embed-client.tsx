'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { setupMGVMessageHandler } from '@/lib/mgv/message-handler';
import type { MGVContext } from '@/lib/mgv/types';

interface EmbedClientProps {
  onDataReady?: (
    records: Record<string, unknown>[],
    columns: string[],
    context?: MGVContext,
  ) => void;
}

export function EmbedClient({ onDataReady }: EmbedClientProps) {
  const [status, setStatus] = useState<'waiting' | 'ready'>('waiting');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      records?: Record<string, unknown>[];
      columns?: string[];
      chartHtml?: string;
    }>
  >([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = setupMGVMessageHandler((recs, cols, ctx) => {
      setRecords(recs);
      setColumns(cols);
      setStatus(recs.length === 0 ? 'waiting' : 'ready');
      setMessages([]); // 清空历史对话
      onDataReady?.(recs, cols, ctx);
    });
    return cleanup;
  }, [onDataReady]);

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content: text };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, embedded: true, records, columns }),
        });

        if (!res.ok) {
          const text2 = await res.text();
          console.error('[EmbedClient] API error:', res.status, text2);
          setError(`请求失败: ${res.status}`);
          setIsLoading(false);
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventType = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const raw = line.slice(6);
                try {
                  const event = JSON.parse(raw);
                  // event.type is from the SSE event name, not the JSON body
                  const type = eventType || event.type;

                  if (type === 'step') { eventType = ''; continue; }

                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (type === 'text') {
                      const newContent = (last?.role === 'assistant' ? last.content : '') + event.text;
                      eventType = '';
                      if (last?.role === 'assistant') {
                        return [...prev.slice(0, -1), { ...last, content: newContent }];
                      }
                      return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: newContent }];
                    }
                    if (type === 'data' && last?.role === 'assistant') {
                      eventType = '';
                      return [...prev.slice(0, -1), {
                        ...last,
                        records: event.records,
                        columns: event.columns,
                      }];
                    }
                    if (type === 'chart' && last?.role === 'assistant') {
                      eventType = '';
                      return [...prev.slice(0, -1), { ...last, chartHtml: event.html }];
                    }
                    return prev;
                  });
                } catch { /* ignore parse errors */ }
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '分析失败');
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, records, columns],
  );

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background gap-4">
        <div className="text-destructive">出错: {error}</div>
        <button className="text-sm text-blue-600" onClick={() => setError(null)}>重试</button>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background gap-4">
        <div className="text-4xl" aria-hidden>📊</div>
        <div className="text-muted-foreground">等待数据...</div>
        <div className="text-xs text-muted-foreground">请在 MGV AI 页面打开 AI 分析</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 列名展示 */}
      <div className="border-b px-4 py-2 text-xs text-muted-foreground">
        共 {records.length} 条数据 · {columns.length} 列
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block rounded px-3 py-2 text-sm max-w-[80%] ${
                m.role === 'user' ? 'bg-blue-100 text-left' : 'bg-gray-100 text-left'
              }`}
            >
              {m.content.split('\n').map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </div>
            {m.chartHtml && (
              <div className="mt-2 border rounded overflow-hidden">
                <iframe
                  srcDoc={m.chartHtml}
                  className="w-full border-0"
                  style={{ height: '300px' }}
                  title="chart"
                />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="text-left">
            <div className="inline-block rounded bg-gray-100 px-3 py-2 text-sm text-muted-foreground">
              分析中...
            </div>
          </div>
        )}
        {error && (
          <div className="text-destructive text-sm">出错: {error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="问我关于这些数据的问题..."
            disabled={isLoading}
          />
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
