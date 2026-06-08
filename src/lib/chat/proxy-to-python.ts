// src/lib/chat/proxy-to-python.ts
import type { NextRequest } from 'next/server';

const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8000/agent/chat';

export async function proxyToPython(request: NextRequest): Promise<Response> {
  const body = await request.json();

  const pythonRes = await fetch(PYTHON_AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!pythonRes.ok) {
    return Response.json(
      { error: `Python agent error: ${pythonRes.statusText}` },
      { status: pythonRes.status },
    );
  }

  // Pipe SSE stream directly
  return new Response(pythonRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
