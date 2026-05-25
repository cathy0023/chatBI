import { describe, it, expect } from 'vitest';
import { detectErrorPatterns, detectUnknownDepartment, detectPatternsFromRecords } from '@/lib/semantic/pattern-detector';
import type { QueryRecord } from '@/lib/semantic/types';

function makeRecord(overrides: Partial<QueryRecord> & Pick<QueryRecord, 'generatedSQL'>): QueryRecord {
  const { generatedSQL, ...rest } = overrides;
  return {
    id: 1,
    question: '测试问题',
    generatedSQL,
    status: 'failed',
    resultRowCount: 0,
    hasAllZeroRows: false,
    executionTimeMs: 100,
    ...rest,
  };
}

describe('detectErrorPatterns', () => {
  it('检测中文别名', () => {
    const record = makeRecord({ generatedSQL: "SELECT SUM(deal) AS \"总成交\" FROM sales_performance" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('alias_chinese_column');
  });

  it('不误报英文别名', () => {
    const record = makeRecord({ generatedSQL: "SELECT SUM(deal) AS deal FROM sales_performance" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).not.toContain('alias_chinese_column');
  });

  it('检测 GROUP BY 缺失', () => {
    const record = makeRecord({ generatedSQL: "SELECT department, SUM(deal) FROM sales_performance" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('missing_group_by');
  });

  it('有 GROUP BY 时不报缺失', () => {
    const record = makeRecord({ generatedSQL: "SELECT department, SUM(deal) FROM sales_performance GROUP BY department" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).not.toContain('missing_group_by');
  });

  it('检测聚合函数错误', () => {
    const record = makeRecord({ generatedSQL: "SELECT SUM(name) FROM sales_performance" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('wrong_aggregate');
  });

  it('SUM 数值列不报错', () => {
    const record = makeRecord({ generatedSQL: "SELECT SUM(deal) FROM sales_performance" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).not.toContain('wrong_aggregate');
  });

  it('检测全零结果', () => {
    const record = makeRecord({ generatedSQL: "SELECT SUM(deal) AS deal FROM sales_performance", hasAllZeroRows: true });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('all_zero_result');
  });

  it('检测月份格式错误', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance WHERE month = '7'" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('invalid_month_format');
  });

  it('中文月份不报错', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance WHERE month = '7月'" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).not.toContain('invalid_month_format');
  });

  it('无错误时返回空数组', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance WHERE name = '张三' AND month = '8月'" });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toEqual([]);
  });

  it('可同时检测多个错误模式', () => {
    const record = makeRecord({
      generatedSQL: "SELECT SUM(name) AS \"总成交\" FROM sales_performance WHERE month = '7'",
      hasAllZeroRows: true,
    });
    const patterns = detectErrorPatterns(record);
    expect(patterns).toContain('wrong_aggregate');
    expect(patterns).toContain('alias_chinese_column');
    expect(patterns).toContain('invalid_month_format');
    expect(patterns).toContain('all_zero_result');
    expect(patterns).toContain('missing_group_by'); // SUM() without GROUP BY
  });
});

describe('detectUnknownDepartment', () => {
  const knownDepts = ['东四', '海淀一', '花园桥', '望京'];

  it('检测未知部门', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance WHERE department = '技术部'" });
    expect(detectUnknownDepartment(record, knownDepts)).toBe(true);
  });

  it('已知部门不报错', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance WHERE department LIKE '%花园桥%'" });
    expect(detectUnknownDepartment(record, knownDepts)).toBe(false);
  });

  it('无部门过滤时不报错', () => {
    const record = makeRecord({ generatedSQL: "SELECT * FROM sales_performance" });
    expect(detectUnknownDepartment(record, knownDepts)).toBe(false);
  });
});

describe('detectPatternsFromRecords', () => {
  it('批量统计错误模式', () => {
    const records = [
      makeRecord({ generatedSQL: "SELECT SUM(deal) AS \"总成交\" FROM sales_performance" }),
      makeRecord({ generatedSQL: "SELECT SUM(deal) AS \"总成交\" FROM sales_performance" }),
      makeRecord({ generatedSQL: "SELECT department, SUM(deal) FROM sales_performance" }),
    ];
    const counts = detectPatternsFromRecords(records);
    expect(counts.get('alias_chinese_column')).toBe(2);
    // All 3 records have SUM() without GROUP BY
    expect(counts.get('missing_group_by')).toBe(3);
  });
});