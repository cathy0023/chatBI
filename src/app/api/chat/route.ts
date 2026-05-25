import { NextRequest } from 'next/server';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { createSSEStream } from '@/lib/chat/sse-helper';
import { ReActGateway } from '@/lib/chat/react-gateway';
import { DEFAULT_TENANT } from '@/lib/chat/types';

interface ChatBody {
  message: string;
  sessionId?: string;
  // 嵌入模式字段
  embedded?: boolean;
  records?: Record<string, unknown>[];
  columns?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatBody = await request.json();
    const { message, sessionId, embedded, records, columns } = body;

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // 嵌入模式：跳过 session，用临时 ID
    if (embedded) {
      const sid = 'embed-' + crypto.randomUUID();
      return createSSEStream(async (send) => {
        await new ReActGateway().execute(
          message,
          { sessionId: sid, tenant: DEFAULT_TENANT, message },
          send,
          { records: records ?? [], columns: columns ?? [] },
        );
      });
    }

    // 独立模式
    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    return createSSEStream(async (send) => {
      send('session', { sessionId: sid });
      await new ReActGateway().execute(
        message,
        { sessionId: sid, tenant: DEFAULT_TENANT, message },
        send,
      );
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
