import { test, expect } from '@playwright/test';

const SAMPLE_DATA = {
  type: 'MGV_TABLE_DATA',
  records: [
    { name: '张三', department: '销售一部', month: '7月', deal: 10 },
    { name: '李四', department: '销售二部', month: '7月', deal: 8 },
  ],
  columns: ['name', 'department', 'month', 'deal'],
  labels: ['姓名', '部门', '月份', '成交'],
};

test.describe('ChatBI Embed: 拖拽 + 全屏切换', () => {
  // 等待组件 mount 后再发数据
  async function loadData(page) {
    await page.goto('/embed');
    await page.waitForSelector('text=等待数据', { timeout: 10000 });
    await page.evaluate((data) => window.postMessage(data, '*'), SAMPLE_DATA);
    await page.waitForFunction(() => !document.body.textContent?.includes('等待数据'), { timeout: 5000 });
  }

  test('normal 模式：数据加载后显示 ChatPanel', async ({ page }) => {
    await loadData(page);

    // embed 模式隐藏了 header，用输入框和底部统计确认布局
    await expect(page.getByPlaceholder('输入您的问题...')).toBeVisible();
    await expect(page.getByText(/2条/)).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drag-01-normal.png' });
  });

  test('DRAWER_MODE_CHANGE 消息切换布局', async ({ page }) => {
    await loadData(page);

    // 发送 maximized 模式切换
    await page.evaluate(() =>
      window.postMessage({ type: 'DRAWER_MODE_CHANGE', mode: 'maximized' }, '*'),
    );

    // 应该出现三栏布局（SessionList 含 "新对话" 按钮 + "对话历史" 标题）
    await expect(page.getByRole('heading', { name: '对话历史' })).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drag-02-maximized.png' });

    // 切回 normal 模式
    await page.evaluate(() =>
      window.postMessage({ type: 'DRAWER_MODE_CHANGE', mode: 'normal' }, '*'),
    );

    // 三栏布局应该消失
    await expect(page.getByRole('heading', { name: '对话历史' })).not.toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drag-03-back-normal.png' });
  });

  test('inline buffer 捕获早期 postMessage', async ({ page }) => {
    // 通过 addInitScript 在 DOMContentLoaded 时发送消息（模拟竞态）
    await page.addInitScript((data) => {
      window.addEventListener('DOMContentLoaded', () => {
        window.postMessage(data, '*');
      });
    }, SAMPLE_DATA);

    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    // 数据应该被 buffer 捕获并重放 — 确认输入框可见
    await expect(page.getByPlaceholder('输入您的问题...')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drag-04-buffer.png' });
  });
});
