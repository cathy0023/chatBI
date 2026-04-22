import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

describe('ReAct mode smoke test', () => {
  it('responds to greeting via react mode', async () => {
    const response = await fetch(`${BASE_URL}/api/chat?mode=react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('event: session');
    expect(text).toContain('event: done');
  });

  it('processes a data query via react mode', async () => {
    const response = await fetch(`${BASE_URL}/api/chat?mode=react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '各部门成交汇总' }),
    });

    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain('event: session');
    expect(text).toContain('event: done');
  }, 30_000);
});
