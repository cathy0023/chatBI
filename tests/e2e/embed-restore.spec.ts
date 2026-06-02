import { test, expect } from '@playwright/test';

/**
 * E2E: 验证 embed 页面 iframe 重载后会话自动恢复
 *
 * 流程：
 * 1. 打开 /embed，通过 postMessage 模拟 MGV 发送数据
 * 2. 发送一条消息，等待 AI 回复完成
 * 3. 刷新页面（模拟 iframe 销毁重建）
 * 4. 再次 postMessage 模拟 MGV 发送数据
 * 5. 验证历史消息自动恢复
 */
test('embed session restores after page reload', async ({ page }) => {
  // ---- Phase 1: 首次加载，发送消息 ----
  await page.goto('http://localhost:3000/embed');

  // 等待组件 mount（出现"等待数据..."说明已渲染）
  await page.waitForSelector('text=等待数据', { timeout: 10000 });

  // 模拟 MGV 发送数据
  await page.evaluate(() => {
    window.postMessage({
      type: 'MGV_TABLE_DATA',
      records: [
        { name: '张三', department: '销售一部', month: '9月', deal: 10 },
        { name: '李四', department: '销售二部', month: '9月', deal: 8 },
      ],
      columns: ['name', 'department', 'month', 'deal'],
      labels: ['姓名', '部门', '月份', '成交'],
    }, '*');
  });

  // 等待数据加载完（"等待数据..."消失）
  await page.waitForFunction(() => !document.body.textContent?.includes('等待数据'), { timeout: 5000 });

  // 找到输入框并发送消息
  const input = page.locator('textarea, input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('各部门成交汇总');
  await input.press('Enter');

  // 等待 AI 回复完成（done 事件 → phase 标记）
  // 最多等 60 秒
  await page.waitForFunction(
    () => {
      const msgs = document.querySelectorAll('[class*="prose"]');
      return msgs.length > 0;
    },
    { timeout: 60000 },
  );

  // 验证有 assistant 消息出现
  const assistantMessages = await page.locator('text=AI').count();
  expect(assistantMessages).toBeGreaterThan(0);

  // 记录 sessionId
  const sessionIdBefore = await page.evaluate(() => {
    return localStorage.getItem('chatbi_embed_session_id');
  });
  console.log('Session before reload:', sessionIdBefore);
  expect(sessionIdBefore).toBeTruthy();

  // 记录当前消息数量
  const messageCountBefore = await page.locator('[class*="prose"]').count();
  console.log('Messages before reload:', messageCountBefore);

  // ---- Phase 2: 刷新页面（模拟 iframe 销毁重建）----
  await page.reload();

  // 再次模拟 MGV 发送数据（iframe 重载后 MGV 会重发）
  await page.evaluate(() => {
    window.postMessage({
      type: 'MGV_TABLE_DATA',
      records: [
        { name: '张三', department: '销售一部', month: '9月', deal: 10 },
        { name: '李四', department: '销售二部', month: '9月', deal: 8 },
      ],
      columns: ['name', 'department', 'month', 'deal'],
      labels: ['姓名', '部门', '月份', '成交'],
    }, '*');
  });

  // 等待自动恢复完成
  await page.waitForTimeout(3000);

  // 验证 sessionId 一致
  const sessionIdAfter = await page.evaluate(() => {
    return localStorage.getItem('chatbi_embed_session_id');
  });
  console.log('Session after reload:', sessionIdAfter);
  expect(sessionIdAfter).toBe(sessionIdBefore);

  // 验证消息已恢复（至少有之前的 assistant 消息）
  const messageCountAfter = await page.locator('[class*="prose"]').count();
  console.log('Messages after reload:', messageCountAfter);
  expect(messageCountAfter).toBeGreaterThan(0);
});
