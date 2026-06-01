import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, LoadingPhase } from './use-chat';

export function useEmbedChat(records: Record<string, unknown>[], columns: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
      };
      setMessages(prev => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      const assistantId = crypto.randomUUID();
      setMessages(prev => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', phase: 'generating_sql' },
      ]);

      try {
        const ac = new AbortController();
        abortRef.current = ac;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, embedded: true, records, columns }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const text2 = await res.text();
          throw new Error(`请求失败: ${res.status} ${text2}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const raw = line.slice(6);
              try {
                const parsed = JSON.parse(raw);

                switch (currentEvent) {
                  case 'status':
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, phase: parsed.phase as LoadingPhase }
                          : m,
                      ),
                    );
                    break;
                  case 'text':
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId ? { ...m, content: parsed.text } : m,
                      ),
                    );
                    break;
                  case 'data':
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, records: parsed.records, columns: parsed.columns }
                          : m,
                      ),
                    );
                    break;
                  case 'chart':
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId ? { ...m, chartHtml: parsed.html } : m,
                      ),
                    );
                    break;
                  case 'step':
                    if (parsed.type === 'tool_call') {
                      const toolPhase: Record<string, LoadingPhase> = {
                        queryTool: 'generating_sql',
                        analysisTool: 'analyzing',
                        chartTool: 'generating_chart',
                      };
                      const phase = toolPhase[parsed.toolName];
                      if (phase) {
                        setMessages(prev =>
                          prev.map(m =>
                            m.id === assistantId ? { ...m, phase } : m,
                          ),
                        );
                      }
                    }
                    break;
                  case 'done':
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId ? { ...m, phase: 'done' as LoadingPhase } : m,
                      ),
                    );
                    break;
                  case 'error':
                    setError(parsed.error || parsed.message);
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? { ...m, content: `处理出错: ${parsed.error || parsed.message}`, phase: 'error' as LoadingPhase }
                          : m,
                      ),
                    );
                    break;
                }
              } catch {
                // skip malformed
              }
              currentEvent = '';
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : '分析失败';
        setError(msg);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: msg, phase: 'error' as LoadingPhase }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, records, columns],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsLoading(false);
    setError(null);
  }, []);

  return { messages, isLoading, error, sendMessage, clearMessages };
}
