import { describe, it, expect } from 'vitest';
import { matchByKeywords } from '@/lib/agents/router-rules';

describe('Router Rules - Keyword Matching', () => {
  describe('Query intent', () => {
    it('should match simple query keywords', () => {
      const result = matchByKeywords('查找价格异议话术');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('query');
      expect(result!.agents).toContain('query');
      expect(result!.confidence).toBeGreaterThan(0.5);
    });

    it('should match name-based query', () => {
      const result = matchByKeywords('武莹的业绩');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('query');
    });

    it('should match department query', () => {
      const result = matchByKeywords('花园桥校区的销售数据');
      expect(result).not.toBeNull();
    });

    it('should match "展示" keyword', () => {
      const result = matchByKeywords('展示本月成交数据');
      expect(result).not.toBeNull();
      expect(result!.agents).toContain('query');
    });
  });

  describe('Analysis intent', () => {
    it('should match analysis keywords and assign analysis agents', () => {
      const result = matchByKeywords('分析各部门10月成交情况');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('analysis');
      expect(result!.agents).toEqual(['query', 'analysis']);
    });

    it('should match ranking keywords as analysis', () => {
      const result = matchByKeywords('成交排行榜');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('analysis');
    });

    it('should match comparison keywords', () => {
      const result = matchByKeywords('对比新老销售的跟进效率');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('analysis');
    });

    it('should match trend keywords', () => {
      const result = matchByKeywords('各部门成交情况趋势');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('analysis');
    });

    it('should give analysis higher priority than query when both match', () => {
      // "分析对比各部门10月成交排行榜" — analysis keywords: 分析,对比,各部门,排行榜 = 4 matches
      // query keywords: 成交 = 1 match → analysis wins by confidence
      const result = matchByKeywords('分析对比各部门10月成交排行榜');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('analysis');
      expect(result!.agents).toContain('analysis');
    });

    it('should let query win when it has more keyword matches', () => {
      // "各部门销售业绩数据" — query: 业绩,销售,数据,部门 = 4 matches
      // analysis: 各部门 = 1 match → query wins by confidence
      const result = matchByKeywords('各部门销售业绩数据');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('query');
    });
  });

  describe('Generation intent', () => {
    it('should match generation keywords', () => {
      const result = matchByKeywords('帮我生成一个新的话术');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('generation');
      expect(result!.agents).toEqual(['query', 'generator']);
    });

    it('should match "创建" keyword', () => {
      const result = matchByKeywords('创建针对高净值客户的SOP流程');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('generation');
    });
  });

  describe('No match', () => {
    it('should return null for unrecognized queries', () => {
      const result = matchByKeywords('今天天气怎么样');
      expect(result).toBeNull();
    });

    it('should return null for pure greetings', () => {
      const result = matchByKeywords('你好');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = matchByKeywords('');
      expect(result).toBeNull();
    });
  });

  describe('Confidence scoring', () => {
    it('should have higher confidence with more keyword matches', () => {
      const singleMatch = matchByKeywords('业绩');
      const multiMatch = matchByKeywords('分析各部门10月成交排行榜');

      expect(singleMatch).not.toBeNull();
      expect(multiMatch).not.toBeNull();
      expect(multiMatch!.confidence).toBeGreaterThan(singleMatch!.confidence);
    });

    it('should cap confidence at 0.95', () => {
      const result = matchByKeywords('分析对比各部门销售业绩数据排行榜汇总统计');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeLessThanOrEqual(0.95);
    });
  });
});
