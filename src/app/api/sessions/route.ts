import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/connection';
import { cleanupOldSessions } from '@/lib/db/queries';
import { v4 as uuidv4 } from 'uuid';

const MAX_SESSIONS = 20;

// GET /api/sessions - List all sessions (max 20, auto-cleanup old ones)
export async function GET() {
  try {
    // Auto-cleanup sessions beyond the limit
    const deleted = cleanupOldSessions(MAX_SESSIONS);
    if (deleted > 0) {
      console.log(`[Sessions] Cleaned up ${deleted} old sessions`);
    }

    const db = getDb();
    const sessions = db
      .prepare(
        `SELECT s.id, s.title, s.created_at,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
         FROM chat_sessions s
         ORDER BY s.created_at DESC
         LIMIT ?`,
      )
      .all(MAX_SESSIONS) as Array<{
        id: string;
        title: string | null;
        created_at: string;
        message_count: number;
      }>;

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Sessions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/sessions - Create new session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { title } = body as { title?: string };

    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)').run(
      id,
      title || null,
      now,
    );

    return NextResponse.json({
      id,
      title: title || null,
      created_at: now,
    });
  } catch (error) {
    console.error('Sessions POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/sessions?id=xxx - Delete session
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const db = getDb();

    // Delete messages first (due to foreign key)
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);

    // Delete session
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sessions DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}