import { test, expect } from '@playwright/test';

// Wait for a NEW assistant response (count must exceed previousCount)
async function waitForAssistantResponse(page: import('@playwright/test').Page, timeout = 60000, previousCount = 0) {
  await page.waitForFunction(
    (prev) => {
      const msgs = document.querySelectorAll('[data-role="assistant"]');
      if (msgs.length <= prev) return false;
      const last = msgs[msgs.length - 1];
      return last.textContent && last.textContent.trim().length > 0;
    },
    previousCount,
    { timeout },
  );
}

// Wait for the full pipeline to complete using locator-based assertions (auto-retry)
// 1. Wait for the last assistant message to have data-phase="done"
// 2. Wait for the right panel to render actual content (iframe or table)
async function waitForPipelineAndRender(page: import('@playwright/test').Page, timeout = 90000) {
  // Step 1: SSE pipeline is done
  const lastAssistant = page.locator('[data-role="assistant"]').last();
  await expect(lastAssistant).toHaveAttribute('data-phase', 'done', { timeout });

  // Step 2: Right panel has actual content (iframe for chart or table for data)
  const rightPanel = page.locator('[data-testid="render-area"]');
  const iframe = rightPanel.locator('iframe');
  const table = rightPanel.locator('table');
  await expect(iframe.or(table)).toBeVisible({ timeout: 10000 });
}

// Get current assistant message count
async function getAssistantCount(page: import('@playwright/test').Page) {
  return page.locator('[data-role="assistant"]').count();
}

test.describe('ChatBI E2E - Critical User Flows', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ==================== Flow 1: Page loads correctly ====================
  test('page loads with correct layout', async ({ page }) => {
    // Header
    await expect(page.locator('header')).toContainText('ChatBI');

    // Chat panel heading (exact match to avoid sidebar items)
    await expect(page.getByRole('heading', { name: '对话', exact: true })).toBeVisible();

    // Input area
    await expect(page.locator('textarea[placeholder="输入您的问题..."]')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();

    // Right panel placeholder
    await expect(page.getByText('在左侧对话面板中提出问题后')).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/01-page-loaded.png' });
  });

  // ==================== Flow 2: Greeting ====================
  test('greeting returns welcome message', async ({ page }) => {
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    await input.fill('你好');
    await input.press('Enter');

    await waitForAssistantResponse(page);

    // Should contain welcome text
    const assistantMsgs = page.locator('[data-role="assistant"]');
    await expect(assistantMsgs.last()).toContainText('ChatBI 销售数据分析助手');

    await page.screenshot({ path: 'tests/e2e/artifacts/02-greeting.png' });
  });

  // ==================== Flow 3: Simple query ====================
  test('simple query: 武莹的销售数据', async ({ page }) => {
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    await input.fill('武莹的销售数据');
    await input.press('Enter');

    await waitForAssistantResponse(page, 60000);

    // Assistant should respond with substantial content
    const assistantMsgs = page.locator('[data-role="assistant"]');
    const count = await assistantMsgs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const lastMsg = assistantMsgs.last();
    const text = await lastMsg.textContent();
    expect(text!.length).toBeGreaterThan(5);

    await page.screenshot({ path: 'tests/e2e/artifacts/03-simple-query.png' });
  });

  // ==================== Flow 4: Analysis query with chart ====================
  test('analysis query: 分析各部门10月成交情况', async ({ page }) => {
    test.setTimeout(120000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    await input.fill('分析各部门10月成交情况');
    await input.press('Enter');

    await waitForPipelineAndRender(page, 90000);

    // Wait for substantial text content in the assistant response
    const assistantMsgs = page.locator('[data-role="assistant"]');
    await page.waitForFunction(
      (prev) => {
        const msgs = document.querySelectorAll('[data-role="assistant"]');
        const last = msgs[msgs.length - 1];
        return last && last.textContent && last.textContent.trim().length > prev;
      },
      10,
      { timeout: 10000 },
    );
    const text = await assistantMsgs.last().textContent();
    expect(text!.length).toBeGreaterThan(10);

    // Wait for ECharts to fully render chart content inside iframe
    // (canvas element creation and chart drawing are separate async steps)
    await page.waitForFunction(
      () => {
        const iframe = document.querySelector('[data-testid="render-area"] iframe');
        if (!iframe || !iframe.contentDocument) return false;
        const canvas = iframe.contentDocument.querySelector('canvas');
        if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
        // A rendered chart produces a much longer data URL than a blank canvas
        try { return canvas.toDataURL().length > 10000; } catch { return false; }
      },
      { timeout: 15000 },
    );

    await page.screenshot({ path: 'tests/e2e/artifacts/04-analysis-query.png' });
    await page.locator('[data-testid="render-area"]').screenshot({ path: 'tests/e2e/artifacts/04-render-area-only.png' });
  });

  // ==================== Flow 5: Ranking query ====================
  test('ranking query: 成交排行榜', async ({ page }) => {
    test.setTimeout(120000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    await input.fill('成交排行榜');
    await input.press('Enter');

    await waitForPipelineAndRender(page, 90000);

    const assistantMsgs = page.locator('[data-role="assistant"]');
    const text = await assistantMsgs.last().textContent();
    expect(text!.length).toBeGreaterThan(5);

    await page.screenshot({ path: 'tests/e2e/artifacts/05-ranking.png' });
  });

  // ==================== Flow 6: Multi-message conversation ====================
  test('multi-turn conversation', async ({ page }) => {
    test.setTimeout(120000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');

    // Turn 1: simple greeting (fast, no LLM)
    await input.fill('你好');
    await input.press('Enter');
    await waitForAssistantResponse(page, 30000, 0);

    const countAfterTurn1 = await getAssistantCount(page);

    // Turn 2: actual data query (needs LLM)
    await input.fill('武莹的销售数据');
    await input.press('Enter');

    // Wait for pipeline to complete (right panel tested separately in tests 4-5)
    const lastAssistant = page.locator('[data-role="assistant"]').last();
    await expect(lastAssistant).toHaveAttribute('data-phase', 'done', { timeout: 90000 });

    // Should have 4 messages total (2 user + 2 assistant)
    const userMsgs = page.locator('[data-role="user"]');
    const assistantMsgs = page.locator('[data-role="assistant"]');
    expect(await userMsgs.count()).toBe(2);
    expect(await assistantMsgs.count()).toBe(2);

    await page.screenshot({ path: 'tests/e2e/artifacts/06-multi-turn.png' });
  });

  // ==================== Flow 7: Clear conversation ====================
  test('clear conversation', async ({ page }) => {
    const input = page.locator('textarea[placeholder="输入您的问题..."]');

    // Send a message first
    await input.fill('你好');
    await input.press('Enter');
    await waitForAssistantResponse(page);

    // Verify messages exist
    const userMsgs = page.locator('[data-role="user"]');
    expect(await userMsgs.count()).toBe(1);

    // Click the clear button inside the chat panel (not sidebar)
    const chatPanel = page.locator('.flex.h-full.flex-col.min-h-0');
    await chatPanel.locator('button:has-text("清空")').click();

    // Messages should be cleared
    await page.waitForTimeout(500);
    const remaining = page.locator('[data-role="user"]');
    expect(await remaining.count()).toBe(0);

    await page.screenshot({ path: 'tests/e2e/artifacts/07-cleared.png' });
  });
});
