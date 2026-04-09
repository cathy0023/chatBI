import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';

/**
 * Phase 2 Integration Test: Sessions API + History Loading
 * Verifies the full session lifecycle: create → message → list → load → delete
 */

const testDb = new Database(':memory:');
testDb.pragma('foreign_keys = ON');
testDb.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    ui_schema TEXT,
    agent_trace TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
`);

vi.mock('@/lib/db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  addMessage,
  getMessagesBySession,
  getAllSessions,
  deleteSession,
  updateSessionTitle,
} from '@/lib/db/queries';

describe('Sessions API Integration', () => {
  describe('Session CRUD', () => {
    it('should create and retrieve a session', () => {
      const id = uuidv4();
      createSession(id, 'Test Session');
      const session = getSession(id);
      expect(session).toBeTruthy();
      expect(session!.id).toBe(id);
      expect(session!.title).toBe('Test Session');
    });

    it('should return null for non-existent session', () => {
      const session = getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should update session title', () => {
      const id = uuidv4();
      createSession(id);
      updateSessionTitle(id, 'Updated Title');
      const session = getSession(id);
      expect(session!.title).toBe('Updated Title');
    });

    it('should delete session and its messages', () => {
      const id = uuidv4();
      createSession(id, 'To Delete');
      addMessage(id, 'user', 'test message');

      deleteSession(id);

      expect(getSession(id)).toBeNull();
      expect(getMessagesBySession(id)).toHaveLength(0);
    });
  });

  describe('Message persistence', () => {
    it('should persist and retrieve messages in order', () => {
      const sid = uuidv4();
      createSession(sid);

      addMessage(sid, 'user', '各部门10月成交');
      addMessage(sid, 'assistant', '找到12条记录');
      addMessage(sid, 'user', '分析趋势');
      addMessage(sid, 'assistant', '成交整体上升', JSON.stringify({ type: 'bar' }));

      const msgs = getMessagesBySession(sid);
      expect(msgs).toHaveLength(4);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('各部门10月成交');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('找到12条记录');
      expect(msgs[3].ui_schema).toBeTruthy(); // last assistant has ui_schema
    });

    it('should persist ui_schema JSON', () => {
      const sid = uuidv4();
      createSession(sid);
      const schema = { type: 'bar', data: { departments: { '花园桥': 4 } }, title: '部门成交' };

      addMessage(sid, 'assistant', '图表如下', JSON.stringify(schema));

      const msgs = getMessagesBySession(sid);
      expect(msgs).toHaveLength(1);
      const parsed = JSON.parse(msgs[0].ui_schema!);
      expect(parsed.type).toBe('bar');
      expect(parsed.data.departments).toEqual({ '花园桥': 4 });
    });

    it('should persist agent_trace JSON', () => {
      const sid = uuidv4();
      createSession(sid);
      const trace = { route: { intent: 'analysis' }, steps: ['query', 'analysis'] };

      addMessage(sid, 'assistant', '分析结果', undefined, JSON.stringify(trace));

      const msgs = getMessagesBySession(sid);
      const parsed = JSON.parse(msgs[0].agent_trace!);
      expect(parsed.route.intent).toBe('analysis');
      expect(parsed.steps).toContain('query');
    });
  });

  describe('Session listing', () => {
    it('should list sessions with message counts', () => {
      const s1 = uuidv4();
      const s2 = uuidv4();
      createSession(s1, 'Session 1');
      createSession(s2, 'Session 2');
      addMessage(s1, 'user', 'msg1');
      addMessage(s1, 'assistant', 'msg2');
      addMessage(s2, 'user', 'msg3');

      const sessions = getAllSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      const found1 = sessions.find(s => s.id === s1);
      const found2 = sessions.find(s => s.id === s2);
      expect(found1).toBeTruthy();
      expect(found1!.message_count).toBe(2);
      expect(found2!.message_count).toBe(1);
    });

    it('should return sessions ordered by created_at DESC', () => {
      const s1 = uuidv4();
      const s2 = uuidv4();
      // Insert with explicit timestamps to guarantee ordering
      testDb.prepare('INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)').run(s1, 'Older', '2026-01-01T00:00:00Z');
      testDb.prepare('INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)').run(s2, 'Newer', '2026-04-01T00:00:00Z');

      const sessions = getAllSessions();
      // s2 was created after s1, should appear first
      const idx1 = sessions.findIndex(s => s.id === s1);
      const idx2 = sessions.findIndex(s => s.id === s2);
      expect(idx2).toBeLessThan(idx1);
    });

    it('should limit to 50 sessions', () => {
      const sessions = getAllSessions();
      expect(sessions.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Full history lifecycle', () => {
    it('should support: create → chat → load → verify → delete', () => {
      const sid = uuidv4();

      // 1. Create
      createSession(sid, 'Lifecycle Test');
      expect(getSession(sid)).toBeTruthy();

      // 2. Chat (simulate conversation)
      addMessage(sid, 'user', '武莹的业绩');
      addMessage(sid, 'assistant', '找到4条记录', undefined, JSON.stringify({ route: { intent: 'query' } }));
      addMessage(sid, 'user', '分析成交趋势');
      addMessage(sid, 'assistant', '成交稳步增长', JSON.stringify({ type: 'bar' }), JSON.stringify({ route: { intent: 'analysis' } }));

      // 3. Load (simulate reopening)
      const msgs = getMessagesBySession(sid);
      expect(msgs).toHaveLength(4);
      expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

      // Verify UI schema is recoverable
      const lastAssistant = msgs.filter(m => m.role === 'assistant').pop()!;
      const uiSchema = lastAssistant.ui_schema ? JSON.parse(lastAssistant.ui_schema) : null;
      expect(uiSchema).toBeTruthy();
      expect(uiSchema.type).toBe('bar');

      // 4. Delete
      deleteSession(sid);
      expect(getSession(sid)).toBeNull();
      expect(getMessagesBySession(sid)).toHaveLength(0);
    });
  });
});
