import { test, expect } from '@playwright/test';

async function waitForAssistantResponse(page: import('@playwright/test').Page, timeout = 90000, previousCount = 0) {
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

function getAssistantCount(page: import('@playwright/test').Page) {
  return page.locator('[data-role="assistant"]').count();
}

test.describe('Visual Verification', () => {
  test('verify right panel updates on each query', async ({ page }) => {
    test.setTimeout(180000);
    const input = page.locator('textarea[placeholder="输入您的问题..."]');
    const placeholder = page.getByText('在左侧对话面板中提出问题后');

    // Step 1: Initial page load
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'tests/e2e/artifacts/v-01-initial.png', fullPage: true });
    console.log('Step 1: Initial page loaded');

    // Placeholder should be visible initially
    const placeholderInitial = await placeholder.isVisible();
    console.log(`Placeholder visible initially: ${placeholderInitial}`);
    expect(placeholderInitial).toBe(true);

    // Step 2: First query
    await input.fill('武莹的销售数据');
    await input.press('Enter');
    console.log('Step 2: First query sent');

    // Wait for response text to appear first
    await waitForAssistantResponse(page, 90000, 0);

    // Wait for loading to finish (SSE stream fully consumed, including visualization event)
    await page.waitForFunction(() => {
      const spinner = document.querySelector('.animate-spin');
      return !spinner;
    }, { timeout: 60000 });

    // Extra buffer for React re-render after isLoading becomes false
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'tests/e2e/artifacts/v-02-first-query.png', fullPage: true });
    console.log('Step 2: First query fully loaded');

    // Check placeholder visibility after first query
    const placeholderAfterFirst = await placeholder.isVisible().catch(() => false);
    console.log(`Placeholder visible after first query: ${placeholderAfterFirst}`);

    // Check what's in the right panel
    const rightPanelContent = await page.locator('.hidden.md\\:flex').textContent().catch(() => 'empty');
    console.log(`Right panel content length: ${rightPanelContent?.length || 0}`);

    // Log if the panel has actual content (chart or table)
    const hasChart = await page.locator('.echarts-for-react').count();
    const hasTable = await page.locator('table').count();
    const hasLoadingSpinner = await page.locator('.animate-spin').count();
    console.log(`Charts found: ${hasChart}, Tables found: ${hasTable}, Spinners: ${hasLoadingSpinner}`);

    const countAfterTurn1 = await getAssistantCount(page);

    // Step 3: Second query
    await input.fill('成交排行榜');
    await input.press('Enter');
    console.log('Step 3: Second query sent');

    await waitForAssistantResponse(page, 90000, countAfterTurn1);

    // Wait for loading to finish completely
    await page.waitForFunction(() => {
      const spinner = document.querySelector('.animate-spin');
      return !spinner;
    }, { timeout: 60000 });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'tests/e2e/artifacts/v-03-second-query.png', fullPage: true });
    console.log('Step 3: Second query fully loaded');

    const placeholderAfterSecond = await placeholder.isVisible().catch(() => false);
    console.log(`Placeholder visible after second query: ${placeholderAfterSecond}`);

    const hasChart2 = await page.locator('.echarts-for-react').count();
    const hasTable2 = await page.locator('table').count();
    console.log(`After 2nd query - Charts: ${hasChart2}, Tables: ${hasTable2}`);

    // Step 4: Third query (analysis type)
    const countAfterTurn2 = await getAssistantCount(page);
    await input.fill('分析各部门成交情况');
    await input.press('Enter');
    console.log('Step 4: Third query sent');

    await waitForAssistantResponse(page, 90000, countAfterTurn2);

    // Wait for loading to finish completely
    await page.waitForFunction(() => {
      const spinner = document.querySelector('.animate-spin');
      return !spinner;
    }, { timeout: 60000 });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'tests/e2e/artifacts/v-04-analysis-query.png', fullPage: true });

    const placeholderAfterThird = await placeholder.isVisible().catch(() => false);
    console.log(`Placeholder visible after third query: ${placeholderAfterThird}`);
    const hasChart3 = await page.locator('.echarts-for-react').count();
    const hasTable3 = await page.locator('table').count();
    console.log(`After 3rd query - Charts: ${hasChart3}, Tables: ${hasTable3}`);

    // Assertions
    expect(placeholderAfterFirst).toBe(false);
    expect(placeholderAfterSecond).toBe(false);
    expect(placeholderAfterThird).toBe(false);
  });
});
