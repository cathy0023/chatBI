import { v4 as uuidv4 } from 'uuid';
import { createSession, getSession, addMessage, getMessagesBySession } from '@/lib/db/queries';

export function ensureSession(sessionId?: string): string {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return sessionId;
  }
  const newId = uuidv4();
  createSession(newId);
  return newId;
}

export function persistMessage(sessionId: string, role: 'user' | 'assistant', content: string, uiSchema?: string, agentTrace?: string): string {
  return addMessage(sessionId, role, content, uiSchema, agentTrace);
}

export function loadSessionMessages(sessionId: string) {
  return getMessagesBySession(sessionId);
}
