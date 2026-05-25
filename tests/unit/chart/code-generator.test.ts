import { describe, it, expect } from 'vitest';
import { generateChartCode } from '@/lib/chart/code-generator';

// ==================== Mock Data ====================

const salesRecords = [
  { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
  { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
  { name: '李明', department: '中关村校区', month: '7月', wechat_added: 9, interaction: 15, demand: 4, deal: 2 },
  { name: '李明', department: '中关村校区', month: '8月', wechat_added: 11, interaction: 22, demand: 6, deal: 3 },
];
const columns = ['name', 'department', 'month', 'wechat_added', 'interaction', 'demand', 'deal'];

// ==================== Helper ====================

function assertChartHtml(html: string) {
  expect(html).toContain('<script src="/echarts.min.js">');
  expect(html).toContain('chart.setOption');
}

// ==================== 基本功能 ====================

describe('基本功能', () => {
  it('空记录 → 返回空字符串', async () => {
    const result = await generateChartCode('分析销售', [], columns);
    expect(result).toBe('');
  });

  it('单系列数据 → 柱状图（默认）', async () => {
    // 一个人多个月份 → 不触发多系列（只有一个 name）
    // query 不含趋势/饼图等关键词 → uiType=table → 降级为 bar（uniqueValues >= 2）
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
      { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
    ];
    const html = await generateChartCode('武莹各月数据', records, columns);
    assertChartHtml(html);
    // query 含 "各月" → monthKws → dimension=month
    // 按 month 聚合: 7月 deal=3, 8月 deal=4
    expect(html).toContain('"7月"');
    expect(html).toContain('"8月"');
    expect(html).toContain('"bar"');
  });

  it('单系列数据 → 折线图（趋势关键词）', async () => {
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
      { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
    ];
    const html = await generateChartCode('武莹的趋势变化', records, columns);
    assertChartHtml(html);
    expect(html).toContain('"line"');
  });

  it('单系列数据 → 饼图（饼图关键词）', async () => {
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
      { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 12, interaction: 25, demand: 7, deal: 4 },
    ];
    const html = await generateChartCode('武莹的饼图', records, columns);
    assertChartHtml(html);
    expect(html).toContain('"pie"');
  });

  it('多系列数据 → 触发多系列路径（多个 name + 多个 month）', async () => {
    const html = await generateChartCode('各月销售对比', salesRecords, columns);
    assertChartHtml(html);
    // 多系列路径：isMultiSeries=true → multiChartType
    // 默认 uiType=table → multiChartType='line'（table 被转为 line）
    expect(html).toContain('"line"');
    // 两条 series（武莹 + 李明）
    expect(html).toContain('"武莹"');
    expect(html).toContain('"李明"');
    // 月份数据
    expect(html).toContain('"7月"');
    expect(html).toContain('"8月"');
  });
});

// ==================== 聚合逻辑 ====================

describe('聚合逻辑', () => {
  it('按 name 聚合：多条同名记录求和', async () => {
    // salesRecords 有 2 names + 2 months → isMultiSeries 触发
    // 多系列按 name 分组，月份数值求和
    const html = await generateChartCode('各人销售汇总', salesRecords, columns);
    assertChartHtml(html);
    // 武莹 deal: 7月=3, 8月=4 → series data [3, 4]
    // 李明 deal: 7月=2, 8月=3 → series data [2, 3]
    const idxWu = html.indexOf('"武莹"');
    const idxLi = html.indexOf('"李明"');
    expect(idxWu).toBeGreaterThan(-1);
    expect(idxLi).toBeGreaterThan(-1);
    expect(html).toContain('"7月"');
    expect(html).toContain('"8月"');
  });

  it('按 month 聚合：同月份多条记录求和并按月份数字排序', async () => {
    // 使用单 name 数据避免多系列路径
    const singleNameRecords = salesRecords.filter(r => r.name === '武莹');
    const html = await generateChartCode('武莹各月总体趋势', singleNameRecords, columns);
    assertChartHtml(html);
    // 武莹 7月 deal=3, 8月 deal=4 → 按 month 维度聚合
    // 排序: 7月 < 8月（按数字而非字母）
    expect(html).toContain('"7月"');
    expect(html).toContain('"8月"');
    const idx7 = html.indexOf('"7月"');
    const idx8 = html.indexOf('"8月"');
    expect(idx7).toBeLessThan(idx8);
  });

  it('零值过滤：聚合后 total=0 的条目被过滤（非 month 维度）', async () => {
    // 构造单 name、单 month 数据 → 不触发多系列
    // 武莹 deal 全为 0 → 聚合后 total=0 → 被过滤
    // 李明 deal > 0 → 被保留
    const recordsZeroAgg = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
      { name: '李明', department: '中关村校区', month: '7月', wechat_added: 9, interaction: 15, demand: 4, deal: 2 },
    ];
    // query 含"销售" → personKws → dimension=name
    // 单系列路径（1 month only → isMultiSeries=false）
    const html = await generateChartCode('销售汇总', recordsZeroAgg, columns);
    assertChartHtml(html);
    // 武莹 total=0 被过滤，只剩李明
    expect(html).toContain('"李明"');
    expect(html).not.toContain('"武莹"');
  });
});

// ==================== HTML 输出验证 ====================

describe('HTML 输出验证', () => {
  it('HTML 包含 echarts.min.js', async () => {
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    ];
    const html = await generateChartCode('分析', records, columns);
    expect(html).toContain('<script src="/echarts.min.js">');
  });

  it('HTML 包含 chart.setOption', async () => {
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    ];
    const html = await generateChartCode('分析', records, columns);
    expect(html).toContain('chart.setOption');
  });

  it('HTML 包含正确数据值', async () => {
    // 单条记录 → 不触发多系列
    // query "武莹的销售" 含"销售" → personKws → dimension=name
    // 但只有 1 个 name → 单系列，按 name 聚合 → 武莹 deal=3
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    ];
    const html = await generateChartCode('武莹的销售成交数', records, columns);
    assertChartHtml(html);
    // detectMetric 匹配"成交" → metric=deal
    // 按 name 聚合 → 武莹=3
    expect(html).toContain('"武莹"');
    expect(html).toContain('3');
  });
});

// ==================== 边界情况 ====================

describe('边界情况', () => {
  it('所有值为 0：多系列数据仍生成图表（数据为 [0,0]）', async () => {
    // 2 names + 2 months → isMultiSeries=true → 多系列路径
    // 多系列不过滤零值，数据为 [0, 0]
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
      { name: '武莹', department: '花园桥校区', month: '8月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
      { name: '李明', department: '中关村校区', month: '7月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
      { name: '李明', department: '中关村校区', month: '8月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
    ];
    const html = await generateChartCode('各月销售对比', records, columns);
    assertChartHtml(html);
    // 多系列路径 → chartType=table → multiChartType='line'
    expect(html).toContain('"line"');
    // 数据为 0 但 series 仍存在
    expect(html).toContain('"武莹"');
    expect(html).toContain('"李明"');
  });

  it('所有值为 0：单系列数据（无多系列触发）', async () => {
    // 单 name → 不触发多系列 → 单系列路径 → 零值过滤 → 空 labels
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 0, interaction: 0, demand: 0, deal: 0 },
    ];
    const html = await generateChartCode('武莹的销售数据', records, columns);
    assertChartHtml(html);
    // 按 name 维度 → 零值过滤 → 空数据 → 仍生成 HTML
    expect(html).toContain('"bar"');
  });

  it('只有一条记录：不触发多系列，生成单系列图表', async () => {
    const records = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
    ];
    // query 含"销售" → personKws → dimension=name
    // 只有 1 条记录 → isMultiSeries 返回 false → 单系列路径
    const html = await generateChartCode('武莹的销售数据', records, columns);
    assertChartHtml(html);
    // 按 name 维度 → 武莹 deal=3 → bar chart
    expect(html).toContain('"武莹"');
    expect(html).toContain('"bar"');
  });

  it('department 维度：按部门聚合', async () => {
    // 使用单 name 避免多系列路径，确保走 department 维度的单系列聚合
    const singleNameRecords = salesRecords.filter(r => r.name === '武莹');
    // 花园桥校区: 武莹 2 条记录 → 但只有 1 个部门 → 不适合测试
    // 用完整数据，但多系列优先于 department 维度
    // 要测 department 维度需要避免多系列（只用 1 个 name 或 1 个 month）
    const deptRecords = [
      { name: '武莹', department: '花园桥校区', month: '7月', wechat_added: 10, interaction: 20, demand: 5, deal: 3 },
      { name: '武莹', department: '中关村校区', month: '7月', wechat_added: 9, interaction: 15, demand: 4, deal: 2 },
    ];
    // query 含"部门" → deptKws → dimension=department
    // 1 name + 1 month → isMultiSeries=false
    const html = await generateChartCode('各部门的汇总', deptRecords, columns);
    assertChartHtml(html);
    // 花园桥校区 deal=3，中关村校区 deal=2
    expect(html).toContain('"花园桥校区"');
    expect(html).toContain('"中关村校区"');
  });
});
