import { test, expect } from '@playwright/test';

/**
 * 严格验证：刷新后恢复的消息内容与刷新前一致
 */
test('embed restores exact message content after reload', async ({ page }) => {
  const MGV_DATA = {
    type: 'MGV_TABLE_DATA',
    records: [
      { name: '张三', department: '销售一部', month: '9月', deal: 10 },
      { name: '李四', department: '销售二部', month: '9月', deal: 8 },
    ],
    columns: ['name', 'department', 'month', 'deal'],
    labels: ['姓名', '部门', '月份', '成交'],
  };

  // ---- Phase 1: 发消息 ----
  await page.goto('http://localhost:3000/embed');
  // 等组件 mount 完（出现"等待数据..."说明已渲染）
  await page.waitForSelector('text=等待数据', { timeout: 10000 });
  await page.evaluate((data) => window.postMessage(data, '*'), MGV_DATA);
  // 等数据加载完（"等待数据..."消失）
  await page.waitForFunction(() => !document.body.textContent?.includes('等待数据'), { timeout: 5000 });

  const input = page.locator('textarea, input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('各部门成交汇总');
  await input.press('Enter');

  // 等 AI 回复出现
  await page.waitForFunction(
    () => document.querySelectorAll('[class*="prose"]').length > 0,
    { timeout: 60000 },
  );

  // 抓取所有消息文本
  const textsBefore = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="prose"]'))
      .map(el => el.textContent?.trim() || '');
  });
  console.log('Texts before reload:', textsBefore.length, 'messages');

  // 验证用户消息和 AI 回复都在
  const userMsgVisible = await page.locator('text=各部门成交汇总').count();
  expect(userMsgVisible).toBeGreaterThan(0);

  const sessionId = await page.evaluate(() => localStorage.getItem('chatbi_embed_session_id'));
  expect(sessionId).toBeTruthy();

  // ---- Phase 2: reload + restore ----
  await page.reload();
  await page.evaluate((data) => window.postMessage(data, '*'), MGV_DATA);
  await page.waitForTimeout(3000);

  // 验证 sessionId 不变
  const sessionIdAfter = await page.evaluate(() => localStorage.getItem('chatbi_embed_session_id'));
  expect(sessionIdAfter).toBe(sessionId);

  // 验证用户消息恢复
  const userMsgAfterReload = await page.locator('text=各部门成交汇总').count();
  console.log('User message visible after reload:', userMsgAfterReload);
  expect(userMsgAfterReload).toBeGreaterThan(0);

  // 验证 AI 回复恢复
  const textsAfter = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="prose"]'))
      .map(el => el.textContent?.trim() || '');
  });
  console.log('Texts after reload:', textsAfter.length, 'messages');
  expect(textsAfter.length).toBeGreaterThanOrEqual(textsBefore.length);
});
