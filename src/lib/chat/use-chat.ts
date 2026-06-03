'use client';

import { useState, useCallback, useRef } from 'react';

export type LoadingPhase =
  | 'generating_sql'
  | 'executing'
  | 'analyzing'
  | 'generating_chart'
  | 'done'
  | 'error';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  phase?: LoadingPhase;
  sql?: string;
  records?: Record<string, unknown>[];
  columns?: string[];
  chartHtml?: string;
  chartOption?: Record<string, unknown>;
};

const PHASE_LABELS: Record<LoadingPhase, string> = {
  generating_sql: '正在理解您的问题...',
  executing: '正在查询数据...',
  analyzing: '正在分析数据...',
  generating_chart: '正在生成图表...',
  done: '',
  error: '',
};

export function getPhaseLabel(phase?: LoadingPhase): string {
  if (!phase || phase === 'done' || phase === 'error') return '';
  return PHASE_LABELS[phase];
}

/**
 * Merge new records into existing records, deduplicating by name + month.
 * When the LLM calls queryTool multiple times (e.g., "A vs overall comparison"),
 * each call sends a separate `data` SSE event. Without merging, the frontend
 * only keeps the last batch — breaking multi-series chart detection.
 */
function mergeRecords(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const key = (r: Record<string, unknown>) =>
    `${r.name ?? ''}_${r.month ?? ''}`;

  const seen = new Map<string, Record<string, unknown>>();
  for (const r of existing) seen.set(key(r), r);
  for (const r of incoming) seen.set(key(r), r); // overwrite duplicates with newer data

  return Array.from(seen.values());
}

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

    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', phase: 'generating_sql' },
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

      if (!response.ok) throw new Error(`API error: ${response.status}`);

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
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);

              switch (currentEvent) {
                case 'session':
                  setSessionId(parsed.sessionId);
                  break;
                case 'status':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, phase: parsed.phase as LoadingPhase } : m,
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
                    prev.map(m => {
                      if (m.id !== assistantId) return m;
                      const existingRecords = m.records || [];
                      const existingColumns = m.columns || [];
                      const mergedRecords = mergeRecords(existingRecords, parsed.records || []);
                      const mergedColumns = [...new Set([...existingColumns, ...(parsed.columns || [])])];
                      return {
                        ...m,
                        sql: parsed.sql || m.sql,
                        records: mergedRecords,
                        columns: mergedColumns,
                      };
                    }),
                  );
                  break;
                case 'chart':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, chartHtml: parsed.html, chartOption: parsed.option }
                        : m,
                    ),
                  );
                  break;
                case 'step':
                  // ReAct loop progress — map tool calls to loading phases
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
                case 'done':
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, phase: 'done' as LoadingPhase } : m,
                    ),
                  );
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
          m.id === assistantId
            ? { ...m, content: `请求失败: ${errorMsg}`, phase: 'error' as LoadingPhase }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [isLoading, sessionId]);

  const clearMessages = useCallback(() => {
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
        (m: {
          id: string; role: string; content: string;
          chartHtml?: string | null;
          records?: Record<string, unknown>[] | null;
          columns?: string[] | null;
          sql?: string | null;
        }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          phase: 'done' as LoadingPhase,
          chartHtml: m.chartHtml ?? undefined,
          records: m.records ?? undefined,
          columns: m.columns ?? undefined,
          sql: m.sql ?? undefined,
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
