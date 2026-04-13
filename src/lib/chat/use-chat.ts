'use client';

import { useState, useCallback, useRef } from 'react';

export type VisualizationData = {
  title: string;
  description: string;
  code: string;
  dependencies?: Record<string, string>;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  uiSchema?: unknown;
  visualization?: VisualizationData;
};

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    // Placeholder assistant message (will be filled via SSE)
    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', uiSchema: undefined, visualization: undefined },
    ]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, sessionId }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            // Empty line = end of event
            try {
              const parsed = JSON.parse(currentData);

              switch (currentEvent) {
                case 'session':
                  setSessionId(parsed.sessionId);
                  break;

                case 'text':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, content: parsed.text } : m,
                    ),
                  );
                  break;

                case 'uiSchema':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, uiSchema: parsed.uiSchema }
                        : m,
                    ),
                  );
                  break;

                case 'visualization':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, visualization: parsed as VisualizationData }
                        : m,
                    ),
                  );
                  break;

                case 'error':
                  setError(parsed.error);
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: `处理出错: ${parsed.error}` }
                        : m,
                    ),
                  );
                  break;

                case 'done':
                  break;
              }
            } catch {
              // Skip malformed events
            }

            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, content: `请求失败: ${errorMsg}` } : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [isLoading, sessionId]);

  const clearMessages = useCallback(() => {
    // Abort any pending request
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(undefined);
    setError(null);
  }, []);

  const loadSessionMessages = useCallback(async (targetSessionId: string) => {
    abortRef.current?.abort();
    setIsLoading(true);
    try {
      const res = await fetch(`/api/sessions/${targetSessionId}/messages`);
      if (!res.ok) throw new Error('Failed to load session');
      const data = await res.json();
      const loaded: ChatMessage[] = (data.messages || []).map(
        (m: { id: string; role: string; content: string; uiSchema: unknown }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          uiSchema: m.uiSchema,
        }),
      );
      setMessages(loaded);
      setSessionId(targetSessionId);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load session';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, isLoading, error, sendMessage, clearMessages, loadSessionMessages, sessionId };
}
