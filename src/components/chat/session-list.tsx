'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

type SessionInfo = {
  id: string;
  title: string | null;
  created_at: string;
  message_count: number;
};

type SessionListProps = {
  activeSessionId?: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
};

export function SessionList({ activeSessionId, onSelectSession, onNewSession }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSessions();
    const handler = () => loadSessions();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [loadSessions]);

  useEffect(() => {
    loadSessions();
  }, [activeSessionId, loadSessions]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除此对话？此操作不可恢复。')) return;
    try {
      await fetch(`/api/sessions?id=${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) {
        onNewSession();
      }
    } catch {
      // ignore
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}小时前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex h-full w-56 flex-col border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <h3 className="text-sm font-semibold">对话历史</h3>
        <Button variant="ghost" size="sm" onClick={onNewSession} className="h-7 px-2 text-xs">
          + 新对话
        </Button>
      </div>
      <Separator />

      {/* Session list with scroll */}
      <ScrollArea className="h-[calc(100vh-120px)]">
        <div className="flex flex-col gap-0.5 p-2">
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无对话历史
            </p>
          )}
          {sessions.map(session => (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSession(session.id)}
              onKeyDown={e => { if (e.key === 'Enter') onSelectSession(session.id); }}
              className={`group flex items-center gap-1 rounded-md px-2 py-2 text-left text-sm transition-colors cursor-pointer ${
                activeSessionId === session.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-foreground/80'
              }`}
            >
              <div className="w-[140px] shrink-0">
                <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">
                  {session.title || `对话 (${session.message_count} 条消息)`}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatDate(session.created_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={e => handleDelete(session.id, e)}
                className="ml-auto h-5 w-5 shrink-0 p-0 text-muted-foreground/60 hover:text-destructive"
                title="删除对话"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
