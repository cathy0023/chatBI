import { describe, it, expect } from 'vitest';
import {
  SALES_SEMANTIC_MODEL,
  getColumnBySynonym,
  mapValue,
  getAllowedTables,
  getAllowedColumns,
} from '@/lib/semantic/model';

describe('SALES_SEMANTIC_MODEL', () => {
  it('should have exactly one table', () => {
    expect(SALES_SEMANTIC_MODEL.tables).toHaveLength(1);
    expect(SALES_SEMANTIC_MODEL.tables[0].name).toBe('sales_performance');
  });

  it('should define 3 dimensions', () => {
    const dims = SALES_SEMANTIC_MODEL.tables[0].dimensions;
    expect(dims).toHaveLength(3);
    const dimNames = dims.map(d => d.column);
    expect(dimNames).toEqual(['name', 'department', 'month']);
  });

  it('should define 4 metrics', () => {
    const metrics = SALES_SEMANTIC_MODEL.tables[0].metrics;
    expect(metrics).toHaveLength(4);
    const metricNames = metrics.map(m => m.column);
    expect(metricNames).toEqual(['wechat_added', 'interaction', 'demand', 'deal']);
  });

  it('should have month enum and value_map', () => {
    const monthDim = SALES_SEMANTIC_MODEL.tables[0].dimensions.find(d => d.column === 'month')!;
    expect(monthDim.enum).toBeDefined();
    expect(monthDim.enum).toContain('7月');
    expect(monthDim.valueMap).toBeDefined();
    expect(monthDim.valueMap!['七月']).toBe('7月');
    expect(monthDim.valueMap!['八月份']).toBe('8月');
  });

  it('should have business_context', () => {
    expect(SALES_SEMANTIC_MODEL.businessContext).toBeTruthy();
    expect(SALES_SEMANTIC_MODEL.businessContext.length).toBeGreaterThan(20);
  });
});

describe('getColumnBySynonym', () => {
  it('should find column by exact label', () => {
    expect(getColumnBySynonym('成交数')).toBe('deal');
  });

  it('should find column by synonym', () => {
    expect(getColumnBySynonym('加微')).toBe('wechat_added');
    expect(getColumnBySynonym('企微互动')).toBe('interaction');
  });

  it('should return null for unknown synonym', () => {
    expect(getColumnBySynonym('不存在的指标')).toBeNull();
  });
});

describe('mapValue', () => {
  it('should map Chinese month variants', () => {
    expect(mapValue('month', '七月')).toBe('7月');
    expect(mapValue('month', '8月份')).toBe('8月');
    expect(mapValue('month', '10月')).toBe('10月');
  });

  it('should return original value if no mapping exists', () => {
    expect(mapValue('name', '武莹')).toBe('武莹');
  });

  it('should return original value for unknown column', () => {
    expect(mapValue('unknown', 'anything')).toBe('anything');
  });
});

describe('getAllowedTables', () => {
  it('should return table names from model', () => {
    const tables = getAllowedTables();
    expect(tables).toContain('sales_performance');
    expect(tables).toHaveLength(1);
  });
});

describe('getAllowedColumns', () => {
  it('should return all dimension + metric column names', () => {
    const cols = getAllowedColumns();
    expect(cols).toContain('name');
    expect(cols).toContain('department');
    expect(cols).toContain('month');
    expect(cols).toContain('wechat_added');
    expect(cols).toContain('interaction');
    expect(cols).toContain('demand');
    expect(cols).toContain('deal');
    expect(cols).toHaveLength(7);
  });
});
