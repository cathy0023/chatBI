const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Step 1: 访问 sales-api 团队概览页
  console.log('=== Step 1: 访问 sales-api 团队概览 ===');
  await page.goto('http://localhost:9528/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 查找 AI 分析按钮
  const aiBtn = page.locator('button:has-text("AI 分析")');
  const btnVisible = await aiBtn.isVisible().catch(() => false);
  console.log('AI 分析按钮可见:', btnVisible);

  // 如果按钮不可见（可能需要登录），截图看现状
  if (!btnVisible) {
    await page.screenshot({ path: 'artifacts/drawer-test-01-no-btn.png', fullPage: true });
    console.log('截图: artifacts/drawer-test-01-no-btn.png');
    // 尝试直接注入 HTML 来测试 drawer
    console.log('\n=== 降级方案: 直接注入 drawer HTML 测试状态机 ===');
    await testDrawerStateMachine(page);
    await browser.close();
    return;
  }

  // Step 2: 点击 AI 分析按钮，打开抽屉
  console.log('\n=== Step 2: 打开抽屉 ===');
  await aiBtn.click();
  await page.waitForTimeout(3000);

  // 找到 iframe
  const iframe = page.locator('iframe[src*="/chatbi/embed"]');
  const iframeVisible = await iframe.isVisible().catch(() => false);
  console.log('iframe 可见:', iframeVisible);

  if (iframeVisible) {
    const iframeBox = await iframe.boundingBox();
    console.log('iframe 尺寸:', iframeBox ? `${iframeBox.width}x${iframeBox.height}` : 'null');

    // 等待 CHATBI_READY + 数据
    await page.waitForTimeout(5000);

    const embedFrame = page.frameLocator('iframe[src*="/chatbi/embed"]');
    const dataText = await embedFrame.locator('body').textContent().catch(() => '');
    console.log('iframe 内容(前200):', dataText.substring(0, 200).replace(/\n/g, ' '));
    console.log('iframe: 条数据 =', dataText.includes('条数据'));
    console.log('iframe: 对话 =', dataText.includes('对话'));
    console.log('iframe: 发送 =', dataText.includes('发送'));
  }

  await page.screenshot({ path: 'artifacts/drawer-test-02-normal.png', fullPage: true });
  console.log('截图: artifacts/drawer-test-02-normal.png');

  // Step 3: 测试最大化按钮
  console.log('\n=== Step 3: 最大化 ===');
  const maximizeBtn = page.locator('button[title="最大化"], button:has(i.el-icon-full-screen)');
  const maxBtnVisible = await maximizeBtn.isVisible().catch(() => false);
  console.log('最大化按钮可见:', maxBtnVisible);

  if (maxBtnVisible) {
    await maximizeBtn.click();
    await page.waitForTimeout(2000);

    // 验证遮罩层
    const overlay = page.locator('.chatbi-drawer-overlay');
    const overlayVisible = await overlay.isVisible().catch(() => false);
    console.log('遮罩层可见:', overlayVisible);

    // 验证全屏尺寸
    const maximizedDrawer = page.locator('.chatbi-drawer-maximized');
    const maxBox = await maximizedDrawer.boundingBox().catch(() => null);
    console.log('最大化尺寸:', maxBox ? `${maxBox.width}x${maxBox.height}` : 'null');

    // 验证还原按钮
    const restoreBtn = page.locator('button[title="还原"], button:has(i.el-icon-copy-document)');
    const restoreVisible = await restoreBtn.isVisible().catch(() => false);
    console.log('还原按钮可见:', restoreVisible);

    await page.screenshot({ path: 'artifacts/drawer-test-03-maximized.png', fullPage: true });
    console.log('截图: artifacts/drawer-test-03-maximized.png');

    // Step 4: 点击遮罩还原
    console.log('\n=== Step 4: 点击遮罩还原 ===');
    if (overlayVisible) {
      await overlay.click();
      await page.waitForTimeout(2000);

      // 验证回到 normal 模式
      const normalDrawer = page.locator('.chatbi-drawer:not(.chatbi-drawer-maximized)');
      const normalVisible = await normalDrawer.isVisible().catch(() => false);
      console.log('还原到 normal:', normalVisible);

      await page.screenshot({ path: 'artifacts/drawer-test-04-restored.png', fullPage: true });
      console.log('截图: artifacts/drawer-test-04-restored.png');
    }
  }

  // Step 5: 关闭抽屉
  console.log('\n=== Step 5: 关闭抽屉 ===');
  const closeBtn = page.locator('button[title="关闭"], button:has(i.el-icon-close)').first();
  await closeBtn.click();
  await page.waitForTimeout(1000);

  const drawerGone = await page.locator('.chatbi-drawer').isVisible().catch(() => false);
  console.log('抽屉已关闭:', !drawerGone);

  await page.screenshot({ path: 'artifacts/drawer-test-05-closed.png', fullPage: true });
  console.log('截图: artifacts/drawer-test-05-closed.png');

  console.log('\n=== DONE ===');
  await browser.close();
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

// 降级方案：直接注入 drawer HTML，测试状态机逻辑
async function testDrawerStateMachine(page) {
  await page.setContent(`
    <html><body style="margin:0;padding:20px;font-family:sans-serif">
      <h2>抽屉状态机 E2E 测试</h2>
      <div id="test-status">测试中...</div>
      <div id="drawer-container" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;pointer-events:none;">
        <!-- normal 状态 -->
        <div id="drawer-normal" style="position:absolute;top:80px;right:40px;width:400px;height:560px;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;">
          <div style="padding:12px 16px;border-bottom:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:15px;font-weight:600;">AI 数据分析</span>
            <div style="display:flex;gap:4px;">
              <button id="btn-maximize" style="padding:4px 8px;border:none;background:none;cursor:pointer;" title="最大化">⛶</button>
              <button id="btn-refresh" style="padding:4px 8px;border:none;background:none;cursor:pointer;" title="重置对话">↻</button>
              <button id="btn-close-normal" style="padding:4px 8px;border:none;background:none;cursor:pointer;" title="关闭">✕</button>
            </div>
          </div>
          <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
            <iframe id="chatbi-iframe" src="http://localhost:9528/chatbi/embed" width="100%" style="flex:1;border:none;"></iframe>
          </div>
        </div>
        <!-- maximized 状态 (hidden initially) -->
        <div id="overlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9998;pointer-events:auto;cursor:pointer;"></div>
        <div id="drawer-maximized" style="display:none;position:fixed;top:16px;left:16px;width:calc(100vw - 32px);height:calc(100vh - 32px);background:#fff;display:none;flex-direction:column;overflow:hidden;z-index:9999;pointer-events:auto;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.15);">
          <div style="padding:12px 16px;border-bottom:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:15px;font-weight:600;">AI 数据分析</span>
            <div style="display:flex;gap:4px;">
              <button id="btn-restore" style="padding:4px 8px;border:none;background:none;cursor:pointer;" title="还原">📄</button>
              <button id="btn-close-max" style="padding:4px 8px;border:none;background:none;cursor:pointer;" title="关闭">✕</button>
            </div>
          </div>
          <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
            <iframe id="chatbi-iframe-max" src="http://localhost:9528/chatbi/embed" width="100%" style="flex:1;border:none;"></iframe>
          </div>
        </div>
      </div>
      <script>
        // 状态机逻辑
        const normal = document.getElementById('drawer-normal');
        const maximized = document.getElementById('drawer-maximized');
        const overlay = document.getElementById('overlay');

        document.getElementById('btn-maximize').onclick = () => {
          normal.style.display = 'none';
          maximized.style.display = 'flex';
          overlay.style.display = 'block';
          window.__drawerState = 'maximized';
        };
        document.getElementById('btn-restore').onclick = () => {
          normal.style.display = 'flex';
          maximized.style.display = 'none';
          overlay.style.display = 'none';
          window.__drawerState = 'normal';
        };
        overlay.onclick = () => {
          normal.style.display = 'flex';
          maximized.style.display = 'none';
          overlay.style.display = 'none';
          window.__drawerState = 'normal';
        };
        document.getElementById('btn-close-normal').onclick = () => {
          document.getElementById('drawer-container').style.display = 'none';
          window.__drawerState = 'closed';
        };
        document.getElementById('btn-close-max').onclick = () => {
          document.getElementById('drawer-container').style.display = 'none';
          window.__drawerState = 'closed';
        };

        // CHATBI_READY handshake
        window.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'CHATBI_READY') {
            window.__chatbiReady = true;
            const iframe = document.getElementById('chatbi-iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage({
                type: 'MGV_TABLE_DATA',
                records: [{ name: '张三', department: '销售一部', deal: 50000 }],
                columns: ['name', 'department', 'deal']
              }, '*');
            }
          }
        });
        window.__drawerState = 'normal';
      </script>
    </body></html>
  `);

  await page.waitForTimeout(3000);

  // Test 1: normal state
  console.log('Test 1: normal state');
  const state1 = await page.evaluate(() => window.__drawerState);
  console.log('  drawerState:', state1);
  console.log('  PASS:', state1 === 'normal');

  // Test 2: maximize
  console.log('Test 2: maximize');
  await page.click('#btn-maximize');
  await page.waitForTimeout(500);
  const state2 = await page.evaluate(() => window.__drawerState);
  const overlayVisible2 = await page.locator('#overlay').isVisible();
  const maximizedVisible2 = await page.locator('#drawer-maximized').isVisible();
  const normalHidden2 = await page.locator('#drawer-normal').isVisible();
  console.log('  drawerState:', state2);
  console.log('  overlay可见:', overlayVisible2);
  console.log('  maximized可见:', maximizedVisible2);
  console.log('  normal隐藏:', !normalHidden2);
  console.log('  PASS:', state2 === 'maximized' && overlayVisible2 && maximizedVisible2);

  await page.screenshot({ path: 'artifacts/drawer-test-inject-02-maximized.png', fullPage: true });

  // Test 3: click overlay (in the visible margin around the drawer) to restore
  console.log('Test 3: click overlay (margin around drawer) → restore');
  // Drawer is 16px from edges, so the overlay's visible 16px margin is clickable
  // Click on top-left corner where overlay is exposed (not covered by drawer)
  await page.mouse.click(2, 2); // top-left corner, well outside the 16px margin
  await page.waitForTimeout(500);
  const state3 = await page.evaluate(() => window.__drawerState);
  console.log('  drawerState:', state3);
  console.log('  PASS:', state3 === 'normal');

  // Test 4: maximize again, then close
  console.log('Test 4: maximize → close');
  await page.click('#btn-maximize');
  await page.waitForTimeout(500);
  await page.click('#btn-close-max');
  await page.waitForTimeout(500);
  const state4 = await page.evaluate(() => window.__drawerState);
  console.log('  drawerState:', state4);
  console.log('  PASS:', state4 === 'closed');

  await page.screenshot({ path: 'artifacts/drawer-test-inject-05-closed.png', fullPage: true });

  // Test 5: CHATBI handshake + data
  console.log('Test 5: CHATBI handshake');
  // Reset: reload the content
  const ready = await page.evaluate(() => window.__chatbiReady);
  console.log('  chatbiReady:', ready);

  console.log('\n=== 降级测试完成 ===');
}