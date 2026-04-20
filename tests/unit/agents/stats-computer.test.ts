import { describe, it, expect } from 'vitest';
import { computeStats, formatStatsPrompt } from '@/lib/agents/stats-computer';

function makeRecords(): Record<string, unknown>[] {
  return [
    { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
    { name: '李明', department: '中关村校区', month: '7月', wechat_added: 9, interaction: 15, demand: 4, deal: 2 },
    { name: '李明', department: '中关村校区', month: '8月', wechat_added: 11, interaction: 22, demand: 6, deal: 3 },
    { name: '张三', department: '望京校区', month: '7月', wechat_added: 7, interaction: 12, demand: 3, deal: 1 },
  ];
}

describe('computeStats', () => {
  it('should compute totals correctly', () => {
    const stats = computeStats(makeRecords());
    expect(stats.totalCount).toBe(5);
    expect(stats.totalDeal).toBe(13);
    expect(stats.totalWechat).toBe(49);
    expect(stats.totalInteraction).toBe(94);
    expect(stats.totalDemand).toBe(25);
  });

  it('should aggregate by month', () => {
    const stats = computeStats(makeRecords());
    expect(stats.monthCount).toBe(2);
    expect(stats.months['7月'].deal).toBe(6);
    expect(stats.months['8月'].deal).toBe(7);
  });

  it('should aggregate by department', () => {
    const stats = computeStats(makeRecords());
    expect(stats.deptCount).toBe(3);
    expect(stats.departments['花园桥校区'].deal).toBe(7);
    expect(stats.departments['中关村校区'].deal).toBe(5);
  });

  it('should compute top performers', () => {
    const stats = computeStats(makeRecords());
    expect(stats.topPerformers).toHaveLength(3);
    expect(stats.topPerformers[0].name).toBe('武莹');
    expect(stats.topPerformers[0].deal).toBe(7);
  });

  it('should compute monthly top performers', () => {
    const stats = computeStats(makeRecords());
    expect(stats.monthlyTopPerformers['7月']).toHaveLength(3);
    expect(stats.monthlyTopPerformers['8月']).toHaveLength(2);
    expect(stats.monthlyTopPerformers['8月'][0].name).toBe('武莹');
  });

  it('should handle empty records', () => {
    const stats = computeStats([]);
    expect(stats.totalCount).toBe(0);
    expect(stats.totalDeal).toBe(0);
    expect(stats.topPerformers).toHaveLength(0);
    expect(stats.monthCount).toBe(0);
  });

  it('should handle records with missing fields', () => {
    const stats = computeStats([{ name: 'Unknown' }]);
    expect(stats.totalCount).toBe(1);
    expect(stats.totalDeal).toBe(0);
    expect(stats.departments['unknown']).toBeDefined();
  });
});

describe('formatStatsPrompt', () => {
  it('should include key statistics in the prompt', () => {
    const stats = computeStats(makeRecords());
    const prompt = formatStatsPrompt(stats);
    expect(prompt).toContain('数据总条数: 5');
    expect(prompt).toContain('覆盖月份: 2个');
    expect(prompt).toContain('覆盖部门: 3个');
    expect(prompt).toContain('武莹');
  });

  it('should handle empty stats', () => {
    const stats = computeStats([]);
    const prompt = formatStatsPrompt(stats);
    expect(prompt).toContain('数据总条数: 0');
  });
});
