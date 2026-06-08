import { NextRequest } from 'next/server';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { createSSEStream } from '@/lib/chat/sse-helper';
import { ReActGateway } from '@/lib/chat/react-gateway';
import { DEFAULT_TENANT } from '@/lib/chat/types';
import { proxyToPython } from '@/lib/chat/proxy-to-python';

interface ChatBody {
  message: string;
  sessionId?: string;
  // 嵌入模式字段
  embedded?: boolean;
  records?: Record<string, unknown>[];
  columns?: string[];
  labels?: string[];
}

export async function POST(request: NextRequest) {
  // Route to Python Pydantic AI agent if requested
  const url = new URL(request.url);
  if (url.searchParams.get('agent') === 'pydantic') {
    return proxyToPython(request);
  }

  try {
    const body: ChatBody = await request.json();
    const { message, sessionId, embedded, records, columns, labels } = body;

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    // embed 和独立模式统一走 ensureSession
    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    return createSSEStream(async (send) => {
      send('session', { sessionId: sid });
      await new ReActGateway().execute(
        message,
        { sessionId: sid, tenant: DEFAULT_TENANT, message },
        send,
        embedded ? { records: records ?? [], columns: columns ?? [], labels: labels ?? [] } : undefined,
      );
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
