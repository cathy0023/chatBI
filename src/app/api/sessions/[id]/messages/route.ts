import { NextRequest, NextResponse } from 'next/server';
import { getMessagesBySession } from '@/lib/db/queries';

// GET /api/sessions/[id]/messages - Load messages for a session
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const messages = getMessagesBySession(id);

    return NextResponse.json({
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        uiSchema: m.ui_schema ? JSON.parse(m.ui_schema) : null,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Session messages GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
