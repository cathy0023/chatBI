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

    const sid = ensureSession(sessionId);

    // Persist user message FIRST
    persistMessage(sid, 'user', message);

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // 1. Send session info immediately
        send('session', { sessionId: sid });

        try {
          // 2. Process through agent pipeline
          const result = await handleMessage(message, sid);

          // 3. Send text
          send('text', { text: result.text });

          // 4. Send UI schema (if any)
          if (result.uiSchema) {
            send('uiSchema', { uiSchema: result.uiSchema });
          }

          // 5. Persist assistant response
          persistMessage(
            sid,
            'assistant',
            result.text,
            result.uiSchema ? JSON.stringify(result.uiSchema) : undefined,
            result.agentTrace ? JSON.stringify(result.agentTrace) : undefined,
          );

          send('done', {});
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          send('error', { error: errorMsg });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
