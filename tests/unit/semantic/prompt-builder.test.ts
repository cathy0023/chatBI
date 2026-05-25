import { describe, it, expect, beforeEach } from 'vitest';
import { buildNL2SQLPrompt } from '@/lib/semantic/prompt-builder';
import { SALES_SEMANTIC_MODEL } from '@/lib/semantic/model';
import { getDb } from '@/lib/db/connection';

describe('buildNL2SQLPrompt', () => {
  beforeEach(() => {
    // Clear correction_rules so seedInitialRules in buildNL2SQLPrompt works correctly
    const db = getDb();
    db.exec('DELETE FROM correction_rules');
  });
  it('should include semantic model schema', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
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
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toContain(SALES_SEMANTIC_MODEL.businessContext);
  });

  it('should include the user question', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toContain('查询武莹的成交数据');
  });

  it('should include dimension synonyms', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toContain('姓名');
    expect(prompt).toContain('销售员');
    expect(prompt).toContain('部门');
    expect(prompt).toContain('校区');
  });

  it('should include metric synonyms', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toContain('加微');
    expect(prompt).toContain('互动');
    expect(prompt).toContain('需求');
    expect(prompt).toContain('成交');
  });

  it('should include value mappings for month', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toContain('七月');
    expect(prompt).toContain('7月');
    expect(prompt).toContain('八月');
    expect(prompt).toContain('8月');
  });

  it('should include correction rules from DB', () => {
    const prompt = buildNL2SQLPrompt('郑威的走势图');
    // 规则从 correction_rules 表动态读取，seed rules 包含以下内容
    expect(prompt).toContain('禁止使用中文别名');
    expect(prompt).toContain('GROUP BY');
  });

  it('should include few-shot examples with GROUP BY', () => {
    const prompt = buildNL2SQLPrompt('每月成交趋势');
    expect(prompt).toContain('GROUP BY month');
  });

  it('should include metric content in prompt', () => {
    const prompt = buildNL2SQLPrompt('成交排行榜');
    // 语义模型指标和 seed 规则中包含 '成交' 相关内容
    expect(prompt).toContain('成交');
  });

  it('should not contain few-shot examples section', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).not.toContain('参考示例');
  });

  it('should produce a non-trivial prompt', () => {
    const prompt = buildNL2SQLPrompt('查询武莹的成交数据');
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });
});
