import { test, expect } from '@playwright/test';

test.describe('ChatBI Rebuild Verification', () => {
  test('query top 5 sales for September returns valid response', async ({ page }) => {
    test.setTimeout(180000);

    // Step 1: Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Step 2: Verify page loads with "ChatBI" title
    await expect(page.locator('header')).toContainText('ChatBI');
    await expect(page.locator('textarea[placeholder="输入您的问题..."]')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();

    // Wait for any in-progress loading from session restore to finish
    // The textarea becomes enabled when loading is done
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    await expect(input).toBeEnabled({ timeout: 60000 });

    // Clear any existing messages to start fresh
    const clearButton = page.locator('button:has-text("清空")');
    const clearEnabled = await clearButton.isEnabled().catch(() => false);
    if (clearEnabled) {
      await clearButton.click();
      await page.waitForTimeout(500);
    }

    // Step 3: Type the query into the textarea
    await input.fill('9月成交top5的销售');

    // Step 4: Click the send button
    await page.getByRole('button', { name: '发送' }).click();

    // Step 5: Wait for the assistant message to appear (SSE streaming, allow up to 60s)
    // The AI avatar shows "AI" text. Look for any span whose text is exactly "AI"
    await page.waitForFunction(
      () => {
        const allSpans = document.querySelectorAll('span');
        for (const el of allSpans) {
          if (el.textContent?.trim() === 'AI') return true;
        }
        return false;
      },
      { timeout: 60000 },
    );

    // Step 6: Wait for loading states to complete
    // Wait until no more loading spinners (animate-spin) are visible
    await page.waitForFunction(
      () => {
        const spinners = document.querySelectorAll('.animate-spin');
        return spinners.length === 0;
      },
      { timeout: 90000 },
    );

    // Extra buffer for final rendering and streaming to settle
    await page.waitForTimeout(8000);

    // Step 7: Verify assistant message has actual content (not empty, not just loading)
    // Check the message list area for content
    const messageArea = page.locator('.flex.flex-col.gap-2.py-2');
    const messageText = await messageArea.textContent();
    expect(messageText).not.toBeNull();

    // Should contain the user query
    expect(messageText).toContain('9月成交top5的销售');

    // Should contain more than just the user query (i.e., an AI response)
    const textWithoutUserQuery = messageText!.replace('9月成交top5的销售', '').trim();
    expect(textWithoutUserQuery.length).toBeGreaterThan(5);

    // Verify the response is not an error message
    expect(messageText).not.toContain('出错了');

    // Check right panel for data display (table or chart, not placeholder)
    await page.waitForTimeout(3000);

    // Look for a table in the right panel (data query results are shown as tables)
    const table = page.locator('table');
    const tableVisible = await table.isVisible().catch(() => false);

    // Check if placeholder is gone (replaced by content)
    const placeholder = page.getByText('在左侧对话面板中提出问题后');
    const placeholderVisible = await placeholder.isVisible().catch(() => false);

    // Either a table/chart is visible OR the placeholder is gone
    expect(tableVisible || !placeholderVisible).toBe(true);

    // Step 8: Take a screenshot after response is complete
    await page.screenshot({ path: 'tests/e2e/artifacts/rebuild-verify.png' });
  });
});
