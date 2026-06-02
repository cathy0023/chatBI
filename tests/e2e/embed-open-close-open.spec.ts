import { test, expect } from '@playwright/test';

/**
 * 模拟真实用户场景：打开 ChatBI → 发消息 → 关闭 → 再打开 → 验证恢复
 *
 * 在 ChatBI 侧（localhost:3000/embed）模拟完整生命周期
 */
test('embed survives close+reopen (iframe destroy+recreate)', async ({ page }) => {
  const MGV_DATA = {
    type: 'MGV_TABLE_DATA',
    records: [
      { name: '张三', department: '销售一部', month: '9月', deal: 10 },
      { name: '李四', department: '销售二部', month: '9月', deal: 8 },
    ],
    columns: ['name', 'department', 'month', 'deal'],
    labels: ['姓名', '部门', '月份', '成交'],
  };

  // ===== Round 1: 首次打开 =====
  console.log('--- Round 1: 首次打开 /embed ---');
  await page.goto('http://localhost:3000/embed');
  await page.waitForSelector('text=等待数据', { timeout: 10000 });

  // 模拟 Vue 发送 MGV_TABLE_DATA
  await page.evaluate((data) => window.postMessage(data, '*'), MGV_DATA);
  await page.waitForFunction(() => !document.body.textContent?.includes('等待数据'), { timeout: 5000 });

  // 发送消息
  const input = page.locator('textarea, input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('各部门成交汇总');
  await input.press('Enter');

  // 等待 AI 回复
  await page.waitForFunction(
    () => document.querySelectorAll('[class*="prose"]').length > 0,
    { timeout: 60000 },
  );

  const sessionId = await page.evaluate(() => localStorage.getItem('chatbi_embed_session_id'));
  console.log('Session created:', sessionId);
  expect(sessionId).toBeTruthy();

  const messagesBefore = await page.evaluate(() =>
    document.querySelectorAll('[class*="prose"]').length
  );
  console.log('Messages before close:', messagesBefore);

  // ===== Round 2: 模拟关闭再打开（iframe 销毁重建）=====
  console.log('--- Round 2: 模拟关闭再打开 (page.reload) ---');
  await page.reload();

  // Vue 会在 iframe load 后重发 MGV_TABLE_DATA
  // 但 React 可能先从 localStorage 恢复了消息
  // 等一下让恢复逻辑跑完
  await page.waitForTimeout(2000);

  // 模拟 Vue 重发数据
  await page.evaluate((data) => window.postMessage(data, '*'), MGV_DATA);
  await page.waitForTimeout(2000);

  // 验证 sessionId 没变
  const sessionIdAfter = await page.evaluate(() => localStorage.getItem('chatbi_embed_session_id'));
  console.log('Session after reopen:', sessionIdAfter);
  expect(sessionIdAfter).toBe(sessionId);

  // 验证消息恢复了
  const messagesAfter = await page.evaluate(() =>
    document.querySelectorAll('[class*="prose"]').length
  );
  console.log('Messages after reopen:', messagesAfter);
  expect(messagesAfter).toBeGreaterThanOrEqual(messagesBefore);

  // 验证用户消息文本存在
  const userText = await page.locator('text=各部门成交汇总').count();
  console.log('User message visible:', userText);
  expect(userText).toBeGreaterThan(0);

  console.log('--- 全部验证通过 ✅ ---');
});
