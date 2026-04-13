import { NextRequest } from 'next/server';
import { streamText, stepCountIs } from 'ai';
import { ensureSession, persistMessage } from '@/lib/chat/session';
import { handleMessage } from '@/lib/chat/message-handler';
import { generateVisualization } from '@/lib/chat/tools/generate-visualization';
import { buildDataAnalystPrompt } from '@/lib/chat/prompts/data-analyst';
import { QueryAgent } from '@/lib/agents/query-agent';
import { getDefaultModel } from '@/lib/llm/provider';

const queryAgent = new QueryAgent();

const GREETING_PATTERNS = /^(你好|您好|嗨|hi|hello|hey|哈喽|早上好|下午好|晚上好)[\s!！。.]*$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId } = body as { message: string; sessionId?: string };

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sid = ensureSession(sessionId);
    persistMessage(sid, 'user', message);

    // Greeting fast-path: skip queryAgent, go directly to legacy handler
    if (GREETING_PATTERNS.test(message.trim())) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          send('session', { sessionId: sid });

          try {
            const legacyResult = await handleMessage(message, sid);
            send('text', { text: legacyResult.text });
            if (legacyResult.uiSchema) {
              send('uiSchema', { uiSchema: legacyResult.uiSchema });
            }
            persistMessage(
              sid,
              'assistant',
              legacyResult.text,
              legacyResult.uiSchema ? JSON.stringify(legacyResult.uiSchema) : undefined,
              legacyResult.agentTrace ? JSON.stringify(legacyResult.agentTrace) : undefined,
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
    }

    // Try to get data first for the new streaming path
    let queryResult: Awaited<ReturnType<typeof queryAgent.execute>> | null = null;
    try {
      queryResult = await queryAgent.execute({ query: message, searchType: 'sales' });
    } catch (e) {
      // If query fails, fall through to legacy handler
      console.error('[ChatAPI] queryAgent error:', e);
    }

    // New path: data found → streamText with generateVisualization tool, wrapped in SSE
    if (queryResult && queryResult.records.length > 0) {
      const systemPrompt = buildDataAnalystPrompt(message, queryResult.records);

      const streamResult = streamText({
        model: getDefaultModel(),
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
        tools: { generateVisualization },
        stopWhen: stepCountIs(2),
      });

      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          send('session', { sessionId: sid });
          send('debug', { records: queryResult!.records.length, promptLen: systemPrompt.length });

          try {
            let fullText = '';
            for await (const chunk of streamResult.textStream) {
              fullText += chunk;
              send('text', { text: fullText });
            }

            // Extract visualization from tool results
            const toolResults = await streamResult.toolResults;
            for (const tr of toolResults) {
              if (tr.type === 'tool-result') {
                const output = (tr as { type: string; output: unknown }).output as Record<string, unknown> | undefined;
                if (output?.type === 'visualization') {
                  send('visualization', output);
                }
              }
            }

            persistMessage(sid, 'assistant', fullText, toolResults.length > 0 ? JSON.stringify(toolResults) : undefined);
            send('done', {});
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            send('error', { error: errorMsg });
          }

          controller.close();
        },
      });

      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Legacy fallback: no data or query error → old SSE handler
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send('session', { sessionId: sid });

        try {
          const legacyResult = await handleMessage(message, sid);
          send('text', { text: legacyResult.text });
          if (legacyResult.uiSchema) {
            send('uiSchema', { uiSchema: legacyResult.uiSchema });
          }
          persistMessage(
            sid,
            'assistant',
            legacyResult.text,
            legacyResult.uiSchema ? JSON.stringify(legacyResult.uiSchema) : undefined,
            legacyResult.agentTrace ? JSON.stringify(legacyResult.agentTrace) : undefined,
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