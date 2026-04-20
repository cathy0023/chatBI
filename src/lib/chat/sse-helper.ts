/**
 * SSE stream factory — eliminates the 3x duplicated ReadableStream creation in route.ts.
 */

export type SSESender = (event: string, data: unknown) => void;

export function createSSEStream(handler: (send: SSESender) => Promise<void>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send: SSESender = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await handler(send);
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
