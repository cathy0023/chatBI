import { describe, it, expect } from 'vitest';
import { generateChartCode } from '@/lib/chart/code-generator';

describe('SUM(deal) column name bug', () => {
  it('should correctly resolve SUM(deal) column as metric=deal', async () => {
    // Exact reproduction of the bug: SQL returns 'SUM(deal)' as column name
    // recommendChart detects metric='deal', but r['deal'] is undefined
    // resolveMetricValue should find 'SUM(deal)' via fuzzy match
    const records = [
      { name: '夏雅静', 'SUM(deal)': 5 },
      { name: '冯景丽', 'SUM(deal)': 4 },
      { name: '马玉鹏2', 'SUM(deal)': 2 },
    ];
    const html = await generateChartCode('9月成交top5', records, ['name', 'SUM(deal)']);
    expect(html).toContain('夏雅静');
    expect(html).toContain('冯景丽');
    // CRITICAL: chart must NOT show all zeros
    // Parse the chart option to verify data values
    const optMatch = html.match(/chart\.setOption\(([\s\S]+?)\);\s*\n/);
    expect(optMatch).not.toBeNull();
    const option = JSON.parse(optMatch![1]);
    // series data should contain actual values, not all zeros
    const seriesData = option.series?.[0]?.data;
    expect(seriesData).toBeDefined();
    // Must have at least one non-zero value
    expect(seriesData.some((v: number) => v > 0)).toBe(true);
  });

  it('should correctly resolve AVG(interaction) column', async () => {
    const records = [
      { name: 'Alice', 'AVG(interaction)': 15 },
      { name: 'Bob', 'AVG(interaction)': 22 },
    ];
    const html = await generateChartCode('互动数据', records, ['name', 'AVG(interaction)']);
    expect(html).toContain('Alice');
    const optMatch = html.match(/chart\.setOption\(([\s\S]+?)\);\s*\n/);
    const option = JSON.parse(optMatch![1]);
    const seriesData = option.series?.[0]?.data;
    expect(seriesData.some((v: number) => v > 0)).toBe(true);
  });

  it('should handle SUM(deal) AS deal alias correctly', async () => {
    // When SQL uses SUM(deal) AS deal, the column name is 'deal' (exact match works)
    const records = [
      { name: 'Alice', deal: 10 },
      { name: 'Bob', deal: 20 },
    ];
    const html = await generateChartCode('成交排行', records, ['name', 'deal']);
    expect(html).toContain('Alice');
    const optMatch = html.match(/chart\.setOption\(([\s\S]+?)\);\s*\n/);
    const option = JSON.parse(optMatch![1]);
    const seriesData = option.series?.[0]?.data;
    expect(seriesData.some((v: number) => v > 0)).toBe(true);
  });
});