import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/chat/prompts/system-prompt';
import { DEFAULT_TENANT } from '@/lib/chat/types';

describe('buildSystemPrompt', () => {
  it('includes tool descriptions for default tenant', () => {
    const prompt = buildSystemPrompt(DEFAULT_TENANT);
    expect(prompt).toContain('queryTool');
    expect(prompt).toContain('analysisTool');
    expect(prompt).toContain('chartTool');
  });

  it('includes tenant name', () => {
    const prompt = buildSystemPrompt(DEFAULT_TENANT);
    expect(prompt).toContain('ChatBI');
  });

  it('appends systemPromptExtra when provided', () => {
    const tenant = {
      ...DEFAULT_TENANT,
      systemPromptExtra: '\n注意：只允许查询本部门数据。',
    };
    const prompt = buildSystemPrompt(tenant);
    expect(prompt).toContain('只允许查询本部门数据');
  });

  it('includes workflow instructions', () => {
    const prompt = buildSystemPrompt(DEFAULT_TENANT);
    expect(prompt).toContain('工作流程');
    expect(prompt).toContain('queryTool');
  });
});
