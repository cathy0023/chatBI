import { getDb } from './connection';
import { parseSopRecord, type SopRecord, type SopCategory } from '@/types/database';
import type { SopRecordRow, ChatSession, ChatMessage } from '@/types/database';
import { v4 as uuidv4 } from 'uuid';

export function searchSopRecords(
  query?: string,
  category?: SopCategory,
  limit: number = 20,
  offset: number = 0
): SopRecord[] {
  const db = getDb();
  let sql = 'SELECT * FROM sop_records WHERE 1=1';
  const params: unknown[] = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (query) {
    sql += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)';
    const likeQuery = `%${query}%`;
    params.push(likeQuery, likeQuery, likeQuery);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Array<SopRecordRow>;
  return rows.map(parseSopRecord);
}

export function getSopRecordById(id: string): SopRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sop_records WHERE id = ?').get(id) as SopRecordRow | undefined;
  return row ? parseSopRecord(row) : null;
}

export function getSopRecordsByCategory(category: SopCategory): SopRecord[] {
  return searchSopRecords(undefined, category);
}

export function countSopRecords(category?: SopCategory): number {
  const db = getDb();
  if (category) {
    const row = db.prepare('SELECT COUNT(*) as count FROM sop_records WHERE category = ?').get(category) as { count: number };
    return row.count;
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM sop_records').get() as { count: number };
  return row.count;
}

// Session and message queries
export function createSession(id: string, title?: string): void {
  const db = getDb();
  db.prepare('INSERT INTO chat_sessions (id, title) VALUES (?, ?)').run(id, title || null);
}

export function getSession(id: string): ChatSession | null {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession || null;
}

export function addMessage(sessionId: string, role: 'user' | 'assistant', content: string, uiSchema?: string, agentTrace?: string): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO chat_messages (id, session_id, role, content, ui_schema, agent_trace) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, sessionId, role, content, uiSchema || null, agentTrace || null
  );
  return id;
}

export function getMessagesBySession(sessionId: string): ChatMessage[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatMessage[];
}
