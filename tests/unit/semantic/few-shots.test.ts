import { describe, it, expect } from 'vitest';
import { FEW_SHOTS, matchFewShots } from '@/lib/semantic/few-shots';

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
});
