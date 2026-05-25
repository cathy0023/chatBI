import { test, expect } from '@playwright/test';

test.describe('ChatBI Embed Flow (MGV iframe)', () => {
  // Capture console errors for debugging
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('[Browser console]', msg.text());
      }
    });
  });

  test('embed page shows waiting state initially', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('等待数据...')).toBeVisible();
    await expect(page.getByText('请在 MGV AI 页面打开 AI 分析')).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-01-waiting.png' });
  });

  test('receives MGV postMessage and shows ready state', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    // Verify initial waiting state
    await expect(page.getByText('等待数据...')).toBeVisible();

    // Inject MGV data via postMessage
    await page.evaluate(() => {
      window.postMessage({
        type: 'MGV_TABLE_DATA',
        records: [
          { name: '张三', department: '销售一部', deal: 50000, interaction: 120, month: '9月' },
          { name: '李四', department: '销售一部', deal: 42000, interaction: 98, month: '9月' },
          { name: '王五', department: '销售二部', deal: 38000, interaction: 85, month: '9月' },
        ],
        columns: ['name', 'department', 'deal', 'interaction', 'month'],
        context: { page: 'team-analysis', kanbanId: 1, dimension: 'member' },
      }, '*');
    });

    // Wait for ready state
    await expect(page.getByText('等待数据...')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/共 3 条数据/)).toBeVisible();

    // Input field should be visible
    await expect(page.getByPlaceholder('问我关于这些数据的问题...')).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-02-ready.png' });
  });

  test('sends question and receives AI analysis', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    // Inject MGV data
    await page.evaluate(() => {
      window.postMessage({
        type: 'MGV_TABLE_DATA',
        records: [
          { name: '张三', department: '销售一部', deal: 50000, interaction: 120, month: '9月' },
          { name: '李四', department: '销售一部', deal: 42000, interaction: 98, month: '9月' },
          { name: '王五', department: '销售二部', deal: 38000, interaction: 85, month: '9月' },
        ],
        columns: ['name', 'department', 'deal', 'interaction', 'month'],
        context: { page: 'team-analysis', kanbanId: 1, dimension: 'member' },
      }, '*');
    });

    // Wait for ready
    await expect(page.getByPlaceholder('问我关于这些数据的问题...')).toBeVisible({ timeout: 5000 });

    // Ask a question
    const input = page.getByPlaceholder('问我关于这些数据的问题...');
    await input.fill('谁的成交最高？');
    await input.press('Enter');

    // Wait for AI response
    await expect(page.getByText('分析中...')).toBeVisible();

    // Wait for actual response text (should mention 张三 or 50000)
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.rounded.bg-gray-100');
        for (const msg of Array.from(msgs)) {
          const text = msg.textContent || '';
          if (text.includes('张三') || text.includes('50000') || text.length > 20) {
            return true;
          }
        }
        return false;
      },
      { timeout: 90000 },
    );

    const msgs = await page.locator('.rounded.bg-gray-100').all();
    const lastAssistantMsg = msgs[msgs.length - 1];
    const text = await lastAssistantMsg.textContent();
    expect(text!.length).toBeGreaterThan(5);

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-03-ai-response.png' });
  });

  test('greeting still works in embed mode', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      window.postMessage({
        type: 'MGV_TABLE_DATA',
        records: [{ name: '张三', deal: 50000 }],
        columns: ['name', 'deal'],
        context: { page: 'team-analysis' },
      }, '*');
    });

    await expect(page.getByPlaceholder('问我关于这些数据的问题...')).toBeVisible({ timeout: 5000 });

    // Send greeting
    const input = page.getByPlaceholder('问我关于这些数据的问题...');
    await input.fill('你好');
    await input.press('Enter');

    // Should respond with greeting (embedded mode uses "数据分析助手" greeting)
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.rounded.bg-gray-100');
        for (const msg of Array.from(msgs)) {
          if (msg.textContent!.includes('数据分析助手')) return true;
        }
        return false;
      },
      { timeout: 30000 },
    );

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-04-greeting.png' });
  });
});
