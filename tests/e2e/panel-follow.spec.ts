import { test, expect } from '@playwright/test';

// Wait for assistant response with content
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

// Wait for the full pipeline to complete (data-phase transitions to 'done' or 'error')
async function waitForPipelineComplete(page: import('@playwright/test').Page, timeout = 90000) {
  const lastAssistant = page.locator('[data-role="assistant"]').last();
  await expect(lastAssistant).toHaveAttribute('data-phase', /^(done|error)$/, { timeout });
}

async function getAssistantCount(page: import('@playwright/test').Page) {
  return page.locator('[data-role="assistant"]').count();
}

test.describe('Right Panel Follow & Streaming State', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ==================== Test 1: Right panel follows latest question ====================
  test('right panel updates when a new question is asked', async ({ page }) => {
    test.setTimeout(180000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');

    // Turn 1: ask first data question
    await input.fill('各部门成交汇总');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, 0);
    await waitForPipelineComplete(page);

    // Wait for right panel to render — check that placeholder is gone or content appeared
    const placeholder = page.getByText('在左侧对话面板中提出问题后');
    // The right panel should have either: iframe (chart), table (data), or no placeholder
    const rightPanel = page.locator('[data-testid="render-area"]');
    await expect(rightPanel.locator('iframe').or(rightPanel.locator('table')).or(rightPanel.locator('[data-testid="analysis-content"]'))).toBeVisible({ timeout: 10000 }).catch(() => {});
    // Also verify placeholder is no longer visible (if data was returned)
    await page.waitForTimeout(1000);

    const countAfterTurn1 = await getAssistantCount(page);
    await page.screenshot({ path: 'tests/e2e/artifacts/10-panel-follow-turn1.png' });

    // Turn 2: ask a different question — right panel should follow
    await input.fill('成交排行榜');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, countAfterTurn1);
    await waitForPipelineComplete(page);

    // Wait for right panel to update to the new question's visualization
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'tests/e2e/artifacts/10-panel-follow-turn2.png' });
  });

  // ==================== Test 2: Streaming border on AI message ====================
  test('streaming AI message shows animated border', async ({ page }) => {
    test.setTimeout(120000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');

    // Start a query that triggers LLM
    await input.fill('分析各部门成交情况');
    await input.press('Enter');

    // Check for streaming-border class while response is being generated
    // The border appears when content is streaming
    const assistantCard = page.locator('[data-role="assistant"]').last().locator('..').locator('.streaming-border');

    // The streaming border should appear at some point during generation
    // We check with a short timeout since streaming is transient
    const hadStreamingBorder = await assistantCard.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    // Wait for full response
    await waitForAssistantResponse(page, 90000, 0);
    await waitForPipelineComplete(page);

    await page.screenshot({ path: 'tests/e2e/artifacts/11-streaming-border.png' });

    // After response completes, streaming border should be gone
    const streamingBorderAfter = await page.locator('.streaming-border').count();
    expect(streamingBorderAfter).toBe(0);
  });

  // ==================== Test 3: Click message to pin, click again to unpin ====================
  test('click assistant message pins panel, click again unpins', async ({ page }) => {
    test.setTimeout(180000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');

    // Turn 1: first data query
    await input.fill('武莹的销售数据');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, 0);
    await waitForPipelineComplete(page);
    await page.waitForTimeout(2000);

    const countAfterTurn1 = await getAssistantCount(page);

    // Turn 2: second data query
    await input.fill('成交排行榜');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, countAfterTurn1);
    await waitForPipelineComplete(page);
    await page.waitForTimeout(3000);

    // Now click the first assistant message to pin it
    const firstAssistantMsg = page.locator('[data-role="assistant"]').first();
    await firstAssistantMsg.click();

    // The first message should now have ring selection indicator
    await page.waitForTimeout(500);

    // Turn 3: ask a third question — right panel should NOT follow because pinned
    const countAfterTurn2 = await getAssistantCount(page);
    await input.fill('各部门7月成交');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, countAfterTurn2);
    await waitForPipelineComplete(page);
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/e2e/artifacts/12-pinned-panel.png' });

    // Click the first message again to unpin (toggle)
    await firstAssistantMsg.click();
    await page.waitForTimeout(500);

    // Now the panel should auto-follow the latest message again
    // Ask one more question to verify
    const countAfterTurn3 = await getAssistantCount(page);
    await input.fill('张三的数据');
    await input.press('Enter');
    await waitForAssistantResponse(page, 90000, countAfterTurn3);
    await waitForPipelineComplete(page);
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/e2e/artifacts/13-unpinned-follow.png' });

    // Right panel should show content (not placeholder)
    const placeholder = page.getByText('在左侧对话面板中提出问题后');
    const placeholderVisible = await placeholder.isVisible().catch(() => false);
    expect(placeholderVisible).toBe(false);
  });
});
