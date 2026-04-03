import { NextRequest } from 'next/server';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { handleMessage } from '@/lib/chat/message-handler';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId?: string };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // Ensure session exists
    const sid = ensureSession(sessionId);

    // Persist user message FIRST (inspired by Claude Code's "persist before execute" pattern)
    persistMessage(sid, 'user', message);

    // Process through agent pipeline
    const result = await handleMessage(message, sid);

    // Persist assistant response
    persistMessage(
      sid,
      'assistant',
      result.text,
      result.uiSchema ? JSON.stringify(result.uiSchema) : undefined,
      result.agentTrace ? JSON.stringify(result.agentTrace) : undefined,
    );

    return Response.json({
      sessionId: sid,
      text: result.text,
      uiSchema: result.uiSchema || null,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}