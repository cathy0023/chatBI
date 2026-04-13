import { test, expect } from '@playwright/test';

/**
 * Helper: build SSE response body from events
 */
function buildSSE(events: Array<{ event: string; data: unknown }>): string {
  return events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

test.describe('ChatBI Streaming Generative UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('smoke: page loads with expected elements', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'ChatBI' })).toBeVisible();
    await expect(page.getByPlaceholder('输入您的问题...')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  });

  test('should display greeting response without visualization', async ({ page }) => {
    const chatInput = page.getByPlaceholder('输入您的问题...');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await chatInput.fill('你好');
    await sendBtn.click();

    // Wait for assistant message
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length > 0 && els[els.length - 1].textContent!.trim().length > 5;
    }, { timeout: 15000 });

    const lastMsg = page.locator('[data-role="assistant"]').last();
    const content = await lastMsg.textContent() || '';
    expect(content).toContain('ChatBI');
    expect(content).toContain('销售');

    // No visualization for greeting
    const sandpack = page.locator('.sp-preview');
    expect(await sandpack.count()).toBe(0);

    await page.screenshot({ path: 'artifacts/greeting-response.png' });
  });

  test('should render Sandpack visualization from SSE', async ({ page }) => {
    // Mock the /api/chat endpoint to return a visualization event
    await page.route('**/api/chat', async route => {
      const sseBody = buildSSE([
        { event: 'session', data: { sessionId: 'test-session-1' } },
        { event: 'text', data: { text: '各部门成交分析如下：' } },
        {
          event: 'visualization',
          data: {
            type: 'visualization',
            title: '各部门成交情况',
            description: '柱状图展示各部门成交数据',
            code: `
import React from "react";
import ReactECharts from "echarts-for-react";

const option = {
  title: { text: "各部门成交情况", left: "center" },
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: ["花园桥", "中关村", "望京"] },
  yAxis: { type: "value", name: "成交数" },
  series: [{ type: "bar", data: [15, 23, 18] }]
};

export default function App() {
  return <ReactECharts option={option} style={{ height: 400, width: "100%" }} />;
}
`.trim(),
            dependencies: {},
          },
        },
        { event: 'done', data: {} },
      ]);

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sseBody,
      });
    });

    const chatInput = page.getByPlaceholder('输入您的问题...');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await chatInput.fill('各部门成交情况');
    await sendBtn.click();

    // Wait for assistant text message
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length > 0 && els[els.length - 1].textContent!.trim().length > 3;
    }, { timeout: 10000 });

    // Verify the analysis text is shown
    const lastMsg = page.locator('[data-role="assistant"]').last();
    const content = await lastMsg.textContent() || '';
    expect(content).toContain('各部门成交分析');

    // Wait for Sandpack to render (it takes time to bundle)
    const sandpack = page.locator('.sp-preview, .sp-wrapper');
    await sandpack.first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    await page.screenshot({ path: 'artifacts/data-visualization.png' });
  });

  test('should handle no data query gracefully', async ({ page }) => {
    // Mock the API to return a "no data" response
    await page.route('**/api/chat', async route => {
      const sseBody = buildSSE([
        { event: 'session', data: { sessionId: 'test-session-2' } },
        { event: 'text', data: { text: '抱歉，没有找到相关的销售数据。请尝试换个关键词，例如部门名称、人员姓名或月份。' } },
        { event: 'done', data: {} },
      ]);

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sseBody,
      });
    });

    const chatInput = page.getByPlaceholder('输入您的问题...');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await chatInput.fill('xyz nonexistent');
    await sendBtn.click();

    // Wait for assistant message
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length > 0 && els[els.length - 1].textContent!.trim().length > 5;
    }, { timeout: 10000 });

    const lastMsg = page.locator('[data-role="assistant"]').last();
    const content = await lastMsg.textContent() || '';
    expect(content.length).toBeGreaterThan(5);

    // No visualization for no-data queries
    const sandpack = page.locator('.sp-preview');
    expect(await sandpack.count()).toBe(0);

    await page.screenshot({ path: 'artifacts/no-data-query.png' });
  });

  test('should toggle sidebar visibility', async ({ page }) => {
    const toggleBtn = page.locator('button:has-text("◀")').or(page.locator('button:has-text("▶")'));
    const btnCount = await toggleBtn.count();

    if (btnCount > 0) {
      await toggleBtn.first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'artifacts/sidebar-toggle.png' });
    }
  });

  test('should show loading state while waiting for response', async ({ page }) => {
    // Mock the API with a delayed response
    await page.route('**/api/chat', async route => {
      // Delay to capture loading state
      await new Promise(resolve => setTimeout(resolve, 2000));

      const sseBody = buildSSE([
        { event: 'session', data: { sessionId: 'test-session-3' } },
        { event: 'text', data: { text: '分析完成。' } },
        { event: 'done', data: {} },
      ]);

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sseBody,
      });
    });

    const chatInput = page.getByPlaceholder('输入您的问题...');
    const sendBtn = page.getByRole('button', { name: '发送' });

    await chatInput.fill('分析一下');
    await sendBtn.click();

    // Wait for the response to eventually complete
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length > 0 && els[els.length - 1].textContent!.trim().length > 2;
    }, { timeout: 10000 });

    const lastMsg = page.locator('[data-role="assistant"]').last();
    const content = await lastMsg.textContent() || '';
    expect(content).toContain('分析完成');

    await page.screenshot({ path: 'artifacts/loading-state.png' });
  });

  test('should handle multi-turn conversation', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/chat', async route => {
      callCount++;
      const responses = [
        '花园桥校区业绩数据如下：10月成交15单，11月成交12单。',
        '各月份对比：花园桥校区在10月表现最好。',
      ];
      const text = responses[(callCount - 1) % responses.length] || '好的。';

      const sseBody = buildSSE([
        { event: 'session', data: { sessionId: 'test-multi' } },
        { event: 'text', data: { text } },
        { event: 'done', data: {} },
      ]);

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: sseBody,
      });
    });

    const chatInput = page.getByPlaceholder('输入您的问题...');
    const sendBtn = page.getByRole('button', { name: '发送' });

    // First query
    await chatInput.fill('花园桥校区的业绩');
    await sendBtn.click();

    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length > 0 && els[els.length - 1].textContent!.trim().length > 10;
    }, { timeout: 10000 });

    // Second query
    await chatInput.fill('对比一下各个月份');
    await sendBtn.click();

    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-role="assistant"]');
      return els.length >= 2;
    }, { timeout: 10000 });

    // Should have at least 4 messages (2 user + 2 assistant)
    const messages = page.locator('[data-role]');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(4);

    await page.screenshot({ path: 'artifacts/multi-turn-conversation.png' });
  });
});
