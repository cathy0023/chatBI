import { describe, it, expect } from 'vitest';
import { recommendChart } from '@/lib/agents/chart-recommender';

describe('recommendChart - dimension detection', () => {
  it('should detect name as dimension for ranking query', () => {
    const records = [
      { name: '夏雅静', deal: 5 },
      { name: '冯景丽', deal: 4 },
      { name: '张雪106', deal: 2 },
      { name: '张艳敏5', deal: 2 },
      { name: '郅莉3', deal: 2 },
    ];
    const result = recommendChart('9月成交top5', records);
    // Log the full result as an assertion so it shows in test output
    expect(result).toMatchObject({ dimension: 'name', metric: 'deal' });
  });

  it('should detect name as dimension for SUM(deal) records', () => {
    const records = [
      { name: '夏雅静', 'SUM(deal)': 5 },
      { name: '冯景丽', 'SUM(deal)': 4 },
    ];
    const result = recommendChart('9月成交top5', records);
    expect(result.dimension).toBe('name');
  });

  it('should detect month as dimension for trend query', () => {
    const records = [
      { month: '7月', deal: 10 },
      { month: '8月', deal: 20 },
      { month: '9月', deal: 15 },
    ];
    const result = recommendChart('成交趋势', records);
    expect(result.dimension).toBe('month');
  });

  it('BUG REPRO: 9月成交top5 with real data should NOT produce "其他"', async () => {
    const records = [
      { name: '夏雅静', deal: 5 },
      { name: '冯景丽', deal: 4 },
      { name: '张雪106', deal: 2 },
      { name: '张艳敏5', deal: 2 },
      { name: '郅莉3', deal: 2 },
    ];
    const { generateChartCode } = await import('@/lib/chart/code-generator');
    const html = await generateChartCode('9月成交top5', records, ['name', 'deal']);
    // The chart must NOT have "其他" as the only category
    expect(html).not.toMatch(/"其他"/);
    // Must contain actual names
    expect(html).toContain('夏雅静');
    expect(html).toContain('冯景丽');
  });
});