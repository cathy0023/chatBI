import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock DB module with isolated in-memory DB
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

// Import AFTER mock setup
import { ensureSession, persistMessage, loadSessionMessages } from '@/lib/chat/session';

describe('Session Management', () => {
  describe('ensureSession', () => {
    it('should create a new session when no id provided', () => {
      const sessionId = ensureSession();
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should return existing session when valid id provided', () => {
      const sessionId = ensureSession();
      const sameId = ensureSession(sessionId);
      expect(sameId).toBe(sessionId);
    });

    it('should create new session when non-existent id provided', () => {
      const fakeId = 'non-existent-session-id';
      const newId = ensureSession(fakeId);
      // Should create a NEW session (UUID), not reuse the fake id
      expect(newId).not.toBe(fakeId);
    });
  });

  describe('persistMessage', () => {
    it('should persist a user message', () => {
      const sessionId = ensureSession();
      const msgId = persistMessage(sessionId, 'user', '花园桥校区业绩');
      expect(msgId).toBeTruthy();
    });

    it('should persist an assistant message with uiSchema', () => {
      const sessionId = ensureSession();
      const msgId = persistMessage(
        sessionId,
        'assistant',
        '找到4条记录',
        JSON.stringify({ type: 'table', data: {} }),
        JSON.stringify({ route: { intent: 'query' } }),
      );
      expect(msgId).toBeTruthy();
    });

    it('should reject invalid role', () => {
      const sessionId = ensureSession();
      // TypeScript won't allow this at compile time, but runtime check via DB constraint
      expect(() => {
        testDb.prepare('INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
          'test-id', sessionId, 'invalid_role' as 'user', 'test'
        );
      }).toThrow();
    });
  });

  describe('loadSessionMessages', () => {
    it('should load all messages for a session in order', () => {
      const sessionId = ensureSession();
      persistMessage(sessionId, 'user', '查询武莹');
      persistMessage(sessionId, 'assistant', '找到4条记录');

      const messages = loadSessionMessages(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('查询武莹');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('找到4条记录');
    });

    it('should return empty array for session with no messages', () => {
      const sessionId = ensureSession();
      const messages = loadSessionMessages(sessionId);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Full session lifecycle', () => {
    it('should support create → message → load flow', () => {
      const sid = ensureSession();
      persistMessage(sid, 'user', '各部门成交情况');
      persistMessage(sid, 'assistant', '汇总数据如下...');

      const msgs = loadSessionMessages(sid);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('各部门成交情况');
      expect(msgs[1].content).toBe('汇总数据如下...');
    });
  });
});
