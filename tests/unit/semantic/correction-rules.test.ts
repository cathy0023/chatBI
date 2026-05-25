import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getActiveRules, getActiveRuleTexts, upsertRule, seedInitialRules } from '@/lib/semantic/correction-rules';
import { getDb } from '@/lib/db/connection';

describe('correction-rules', () => {
  afterEach(() => {
    const db = getDb();
    db.exec('DELETE FROM correction_rules');
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM correction_rules');
  });

  describe('seedInitialRules', () => {
    it('冷启动时插入 6 条初始规则', () => {
      seedInitialRules();
      const rules = getActiveRules();
      expect(rules.length).toBe(6);
    });

    it('重复调用不会重复插入', () => {
      seedInitialRules();
      seedInitialRules();
      const rules = getActiveRules();
      expect(rules.length).toBe(6);
    });
  });

  describe('upsertRule', () => {
    it('新增规则', () => {
      upsertRule('alias_chinese_column', '测试规则', 'critical');
      const rules = getActiveRules();
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules[0].patternKey).toBe('alias_chinese_column');
      expect(rules[0].occurrenceCount).toBe(1);
    });

    it('重复 upsert 累加 occurrenceCount', () => {
      upsertRule('alias_chinese_column', '测试规则', 'critical');
      upsertRule('alias_chinese_column', '测试规则', 'critical');
      const rules = getActiveRules();
      const rule = rules.find(r => r.patternKey === 'alias_chinese_column');
      expect(rule).toBeDefined();
      expect(rule!.occurrenceCount).toBe(2);
    });
  });

  describe('getActiveRuleTexts', () => {
    it('返回规则文本数组', () => {
      seedInitialRules();
      const texts = getActiveRuleTexts();
      expect(texts.length).toBe(6);
      expect(texts[0]).toBeTruthy();
    });
  });

  describe('getActiveRules', () => {
    it('不返回 rejected 规则', () => {
      upsertRule('alias_chinese_column', '禁止中文别名', 'critical');
      const db = getDb();
      db.prepare("UPDATE correction_rules SET status = 'rejected' WHERE id = ?").run('cr_alias_chinese_column');
      const rules = getActiveRules();
      expect(rules.find(r => r.patternKey === 'alias_chinese_column')).toBeUndefined();
    });
  });
});