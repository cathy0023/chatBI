import { describe, it, expect } from 'vitest';
import { buildNL2SQLPrompt } from '@/lib/semantic/prompt-builder';
import { SALES_SEMANTIC_MODEL } from '@/lib/semantic/model';

describe('buildNL2SQLPrompt', () => {
  it('should include semantic model schema', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('sales_performance');
    expect(prompt).toContain('name');
    expect(prompt).toContain('department');
    expect(prompt).toContain('month');
    expect(prompt).toContain('wechat_added');
    expect(prompt).toContain('interaction');
    expect(prompt).toContain('demand');
    expect(prompt).toContain('deal');
  });

  it('should include business context', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain(SALES_SEMANTIC_MODEL.businessContext);
  });

  it('should include few-shot examples when provided', () => {
    const fewShots = [
      {
        patterns: ['对比'],
        question: '对比7月和8月成交',
        sql: "SELECT name, month, deal FROM sales_performance WHERE month IN ('7月','8月')",
      },
    ];
    const prompt = buildNL2SQLPrompt('对比7月和8月成交', fewShots);
    expect(prompt).toContain('对比7月和8月成交');
    expect(prompt).toContain("SELECT name, month, deal FROM sales_performance WHERE month IN ('7月','8月')");
  });

  it('should include the user question', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('查询武莹的成交数据');
  });

  it('should include dimension synonyms', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('姓名');
    expect(prompt).toContain('销售员');
    expect(prompt).toContain('部门');
    expect(prompt).toContain('校区');
  });

  it('should include metric synonyms', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('加微');
    expect(prompt).toContain('互动');
    expect(prompt).toContain('需求');
    expect(prompt).toContain('成交');
  });

  it('should include value mappings for month', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('七月');
    expect(prompt).toContain('7月');
    expect(prompt).toContain('八月');
    expect(prompt).toContain('8月');
  });

  it('should work with empty few-shot list', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('should include SQL generation instructions', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据', []);
    expect(prompt).toContain('SELECT');
    expect(prompt).toContain('SQL');
  });
});
