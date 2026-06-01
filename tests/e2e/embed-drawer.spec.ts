import { test, expect } from '@playwright/test';

const SAMPLE_DATA = {
  type: 'MGV_TABLE_DATA',
  records: [
    { name: '张三', department: '销售一部', month: '7月', wechat_added: 50, interaction: 120, demand: 30, deal: 10 },
    { name: '李四', department: '销售二部', month: '7月', wechat_added: 40, interaction: 90, demand: 20, deal: 8 },
  ],
  columns: ['name', 'department', 'month', 'wechat_added', 'interaction', 'demand', 'deal'],
};

const UPDATED_DATA = {
  type: 'MGV_TABLE_DATA',
  records: [
    { name: '王五', department: '销售三部', month: '8月', wechat_added: 60, interaction: 150, demand: 35, deal: 15 },
  ],
  columns: ['name', 'department', 'month', 'wechat_added', 'interaction', 'demand', 'deal'],
};

test.describe('ChatBI Embed Drawer', () => {
  // ===========================
  // 1. 输入框完整可见（不被截断）
  // ===========================
  test('input box is fully visible without truncation', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    // 发送数据触发 ChatPanel 渲染
    await page.evaluate((data) => window.postMessage(data, '*'), SAMPLE_DATA);

    // 等待 ChatPanel 出现
    await expect(page.getByText(/共 2 条数据/)).toBeVisible({ timeout: 5000 });

    // 输入框应该可见且完全在视口内
    const input = page.getByPlaceholder('输入您的问题...');
    await expect(input).toBeVisible();

    // 验证输入框在视口内（不被截断）
    const inputBox = await input.boundingBox();
    expect(inputBox).not.toBeNull();
    const viewportHeight = page.viewportSize()?.height ?? 800;
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(viewportHeight);

    // 发送按钮也应该可见
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-01-input-visible.png' });
  });

  // ===========================
  // 2. ChatPanel 组件复用验证
  // ===========================
  test('ChatPanel components are reused in embed mode', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    await page.evaluate((data) => window.postMessage(data, '*'), SAMPLE_DATA);

    await expect(page.getByText(/共 2 条数据/)).toBeVisible({ timeout: 5000 });

    // ChatPanel header: "对话" 标题
    await expect(page.getByRole('heading', { name: '对话' })).toBeVisible();

    // ChatPanel header: "清空" 按钮（messages=0 时 disabled）
    const clearBtn = page.getByRole('button', { name: '清空' });
    await expect(clearBtn).toBeVisible();
    await expect(clearBtn).toBeDisabled();

    // MessageList: 空状态欢迎文案
    await expect(page.getByText('开始对话，提出您的数据分析问题')).toBeVisible();

    // ChatInput: textarea + 发送按钮
    await expect(page.getByPlaceholder('输入您的问题...')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-02-chatpanel.png' });
  });

  // ===========================
  // 3. 数据变化感知提示
  // ===========================
  test('shows data change prompt when data updates after conversation started', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    // 第一次数据
    await page.evaluate((data) => window.postMessage(data, '*'), SAMPLE_DATA);
    await expect(page.getByText(/共 2 条数据/)).toBeVisible({ timeout: 5000 });

    // 发送一条消息让对话开始
    const input = page.getByPlaceholder('输入您的问题...');
    await input.fill('谁的成交最高？');
    await input.press('Enter');

    // 等待 assistant 消息出现（data-role="assistant"）
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({ timeout: 30000 });

    // 发送第二次数据（模拟看板切换）
    await page.evaluate((data) => window.postMessage(data, '*'), UPDATED_DATA);

    // 应该出现数据变化提示条
    await expect(page.getByText('数据已更新，是否切换到新数据分析？')).toBeVisible({ timeout: 5000 });

    // 两个按钮都应该可见
    await expect(page.getByRole('button', { name: '切换新数据' })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续当前' })).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-03-data-change.png' });

    // 点击"继续当前" → 提示消失，对话保留
    await page.getByRole('button', { name: '继续当前' }).click();
    await expect(page.getByText('数据已更新')).not.toBeVisible();
    // 对话还在
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-04-keep-current.png' });
  });

  test('clicking "switch to new data" clears conversation', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    await page.evaluate((data) => window.postMessage(data, '*'), SAMPLE_DATA);
    await expect(page.getByText(/共 2 条数据/)).toBeVisible({ timeout: 5000 });

    const input = page.getByPlaceholder('输入您的问题...');
    await input.fill('谁的成交最高？');
    await input.press('Enter');

    // 等 assistant 消息完成（phase=done），否则 clearMessages 后 isLoading 仍为 true
    await expect(page.locator('[data-phase="done"][data-role="assistant"]').first()).toBeVisible({ timeout: 30000 });

    // 发送更新数据
    await page.evaluate((data) => window.postMessage(data, '*'), UPDATED_DATA);
    await expect(page.getByText('数据已更新，是否切换到新数据分析？')).toBeVisible({ timeout: 5000 });

    // 点击"切换新数据"
    await page.getByRole('button', { name: '切换新数据' }).click();

    // 提示消失
    await expect(page.getByText('数据已更新')).not.toBeVisible();
    // 旧消息被清空 — user 消息和 assistant 消息都消失
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
    // 回到欢迎文案
    await expect(page.getByText('开始对话，提出您的数据分析问题')).toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-05-switch-new.png' });
  });

  // ===========================
  // 4. 等待数据初始状态
  // ===========================
  test('shows waiting state before data arrives', async ({ page }) => {
    await page.goto('/embed');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('等待数据...')).toBeVisible();
    // 没有 ChatPanel
    await expect(page.getByRole('heading', { name: '对话' })).not.toBeVisible();

    await page.screenshot({ path: 'tests/e2e/artifacts/embed-drawer-06-waiting.png' });
  });
});