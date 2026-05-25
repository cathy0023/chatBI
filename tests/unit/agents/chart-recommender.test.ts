import { describe, it, expect } from 'vitest';
import { recommendChart, buildUISchema } from '@/lib/agents/chart-recommender';

function makeRecords(): Record<string, unknown>[] {
  return [
    { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
    { name: '李明', department: '中关村校区', month: '7月', wechat_added: 9, interaction: 15, demand: 4, deal: 2 },
  ];
}

describe('recommendChart', () => {
  it('should return table for multi-month ranking', () => {
    const result = recommendChart('各月排行榜', makeRecords());
    expect(result.uiType).toBe('table');
  });

  it('should prefer LLM recommendation when available', () => {
    const result = recommendChart('花园桥校区', makeRecords(), 'bar');
    expect(result.uiType).toBe('bar');
  });

  it('should default to table when no LLM recommendation', () => {
    const result = recommendChart('花园桥校区', makeRecords());
    expect(result.uiType).toBe('table');
  });

  it('should detect person dimension', () => {
    const result = recommendChart('每个销售员的成交', makeRecords());
    expect(result.dimension).toBe('name');
  });

  it('should detect department dimension', () => {
    const result = recommendChart('各部门成交', makeRecords());
    expect(result.dimension).toBe('department');
  });

  it('should detect month dimension', () => {
    const result = recommendChart('月度趋势', makeRecords());
    expect(result.dimension).toBe('month');
  });

  it('should detect deal metric', () => {
    const result = recommendChart('谁成交最多', makeRecords());
    expect(result.metric).toBe('deal');
  });

  it('should detect interaction metric', () => {
    const result = recommendChart('互动排行', makeRecords());
    expect(result.metric).toBe('interaction');
  });

  it('should infer dimension from data when no keyword matches', () => {
    const result = recommendChart('随便查查', makeRecords());
    // Data has multiple unique months → falls back to 'month' dimension (checked before name)
    expect(result.dimension).toBe('month');
  });

  it('should default to deal metric', () => {
    const result = recommendChart('随便查查', makeRecords());
    expect(result.metric).toBe('deal');
  });
});

describe('buildUISchema', () => {
  it('should build schema with rows and chartData', () => {
    const schema = buildUISchema(makeRecords(), '花园桥校区');
    expect(schema.type).toBe('table');
    expect(schema.data.rows).toHaveLength(3);
    expect(schema.data.totalCount).toBe(3);
    expect(schema.title).toBe('花园桥校区');
  });

  it('should include analysis output when provided', () => {
    const schema = buildUISchema(makeRecords(), '花园桥校区', {
      summary: 'test summary',
      insights: ['insight1'],
      suggestedChartType: 'bar',
    }, 'bar');
    expect(schema.type).toBe('bar');
    expect(schema.summary).toBe('test summary');
    expect(schema.insights).toEqual(['insight1']);
  });

  it('should aggregate chartData by dimension', () => {
    const schema = buildUISchema(makeRecords(), '每个销售员的成交');
    const chartData = schema.data.chartData as Record<string, number>;
    expect(chartData['武莹']).toBe(7);
    expect(chartData['李明']).toBe(2);
  });

  it('should handle multi-month ranking as table', () => {
    const schema = buildUISchema(makeRecords(), '各月排行榜');
    expect(schema.type).toBe('table');
  });
});
