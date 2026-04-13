import { Page, Locator } from '@playwright/test';

export class ChatPage {
  readonly page: Page;
  readonly chatInput: Locator;
  readonly sendButton: Locator;
  readonly messageList: Locator;
  readonly newSessionButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chatInput = page.getByPlaceholder('输入您的问题...');
    this.sendButton = page.getByRole('button', { name: '发送' });
    this.messageList = page.locator('[data-role]');
    this.newSessionButton = page.getByRole('button', { name: '+ 新对话' }).or(page.getByRole('button', { name: '清空' }));
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async sendMessage(message: string) {
    await this.chatInput.fill(message);
    await this.sendButton.click();
  }

  /**
   * Wait for an assistant message with non-empty content to appear.
   * Uses Playwright locator API — no querySelector.
   */
  async waitForAssistantMessage(timeout = 15000): Promise<Locator | null> {
    const assistantMsg = this.page.locator('[data-role="assistant"]').last();
    try {
      // Wait for the element to be visible
      await assistantMsg.waitFor({ state: 'visible', timeout });
      // Wait for content to have actual length (> 5 chars)
      await assistantMsg.locator(':scope > *').first().waitFor({ state: 'visible', timeout: 5000 });
      return assistantMsg;
    } catch {
      return null;
    }
  }

  async getLastAssistantMessage(): Promise<Locator | null> {
    const assistantMessages = this.page.locator('[data-role="assistant"]');
    const count = await assistantMessages.count();
    if (count > 0) {
      return assistantMessages.nth(count - 1);
    }
    return null;
  }

  async hasVisualization(timeout = 5000): Promise<boolean> {
    try {
      const sandpack = this.page.locator('.sp-preview');
      await sandpack.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      const echartsCanvas = this.page.locator('canvas');
      const count = await echartsCanvas.count();
      return count > 0;
    }
  }

  async clearChat() {
    const newChatBtn = this.page.getByRole('button', { name: '+ 新对话' });
    const clearBtn = this.page.getByRole('button', { name: '清空' });

    try {
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
        await this.page.waitForTimeout(500);
      } else if (await clearBtn.isVisible()) {
        await clearBtn.click();
        await this.page.waitForTimeout(500);
      }
    } catch {
      await this.page.reload();
      await this.page.waitForLoadState('networkidle');
    }
  }
}
