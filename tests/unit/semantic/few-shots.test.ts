import { describe, it, expect } from 'vitest';
import { FEW_SHOTS, matchFewShots } from '@/lib/semantic/few-shots';
import { validateSQL } from '@/lib/semantic/validator';

describe('FEW_SHOTS', () => {
  it('should have at least 5 examples', () => {
    expect(FEW_SHOTS.length).toBeGreaterThanOrEqual(5);
  });

  it('each example should have patterns, question, and sql', () => {
    for (const shot of FEW_SHOTS) {
      expect(shot.patterns.length).toBeGreaterThan(0);
      expect(shot.question).toBeTruthy();
      expect(shot.sql).toMatch(/^SELECT/i);
    }
  });

  it('all few-shot SQL should pass validation', () => {
    for (const shot of FEW_SHOTS) {
      const result = validateSQL(shot.sql);
      expect(result.valid, result.valid ? '' : String((result as { reason?: string }).reason ?? 'unknown error')).toBe(true);
    }
  });
});

describe('matchFewShots', () => {
  it('should match comparison queries', () => {
    const matches = matchFewShots('对比7月和8月成交');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].sql).toContain('IN');
  });

  it('should match ranking queries', () => {
    const matches = matchFewShots('成交排行榜');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].sql).toContain('GROUP BY');
  });

  it('should match trend queries', () => {
    const matches = matchFewShots('每月成交趋势');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should match department queries', () => {
    const matches = matchFewShots('各部门10月成交汇总');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should return empty for completely unrelated queries', () => {
    const matches = matchFewShots('今天天气怎么样');
    expect(matches).toHaveLength(0);
  });

  it('should return at most 3 matches', () => {
    const matches = matchFewShots('对比排名趋势');
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it('should match "9月份成交单top5的销售" to month-top5 example', () => {
    const matches = matchFewShots('9月份成交单top5的销售');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].sql).toContain("month = '9月'");
    expect(matches[0].sql).toContain('GROUP BY name');
    expect(matches[0].sql).toContain('LIMIT 5');
  });

  it('should match "8月份成交单top3的销售" to month-top5 example', () => {
    const matches = matchFewShots('8月份成交单top3的销售');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].sql).toContain('GROUP BY name');
  });

  it('should NOT match "销售业绩一览" to ranking pattern', () => {
    const matches = matchFewShots('销售业绩一览');
    expect(matches[0].question).toBe('销售业绩一览');
  });

  it('should NOT match "9月份成交单top5的销售" to sales-performance pattern', () => {
    const matches = matchFewShots('9月份成交单top5的销售');
    expect(matches[0].question).not.toBe('销售业绩一览');
  });

  it('should respect maxResults parameter', () => {
    const matches = matchFewShots('9月份成交单top5的销售', 1);
    expect(matches.length).toBe(1);
  });
});
