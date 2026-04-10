import type { SemanticModel } from './types';

export const SALES_SEMANTIC_MODEL: SemanticModel = {
  domain: 'sales_performance',
  description: '在线教育销售团队月度业绩数据',
  tables: [
    {
      name: 'sales_performance',
      description: '销售人员月度业绩表，每人每月一条记录',
      dimensions: [
        {
          column: 'name',
          label: '姓名',
          synonyms: ['销售员', '销售人员', '个人', '谁', '人员'],
          description: '销售人员姓名',
        },
        {
          column: 'department',
          label: '部门',
          synonyms: ['校区', '团队', '中心', '分中心'],
          description: '销售人员所属部门或校区',
        },
        {
          column: 'month',
          label: '月份',
          synonyms: ['月', '月度'],
          description: '数据所属月份',
          enum: ['7月', '8月', '9月', '10月'],
          valueMap: {
            '七月': '7月',
            '七月份': '7月',
            '7月份': '7月',
            '八月': '8月',
            '八月份': '8月',
            '8月份': '8月',
            '九月': '9月',
            '九月份': '9月',
            '9月份': '9月',
            '十月': '10月',
            '十月份': '10月',
            '10月份': '10月',
          },
        },
      ],
      metrics: [
        {
          column: 'wechat_added',
          label: '加微数',
          synonyms: ['加微信', '加微', '加到微信'],
          description: '当月新增微信好友数量',
          defaultAgg: 'SUM',
        },
        {
          column: 'interaction',
          label: '互动数',
          synonyms: ['企微互动', '互动', '企微'],
          description: '企业微信互动次数',
          defaultAgg: 'SUM',
        },
        {
          column: 'demand',
          label: '需求数',
          synonyms: ['有需求', '需求', '有意向'],
          description: '产生需求的客户数量',
          defaultAgg: 'SUM',
        },
        {
          column: 'deal',
          label: '成交数',
          synonyms: ['成交', '销量', '成单', '卖出'],
          description: '成交订单数量',
          defaultAgg: 'SUM',
        },
      ],
    },
  ],
  businessContext: `在线教育公司销售团队管理场景。数据按月统计，每位销售人员每月一条记录。转化漏斗：加微 → 互动 → 产生需求 → 成交。用户通常关心：谁卖得最好、各部门对比、月度趋势、个人成长、转化率。`,
};

// ---- Helper functions ----

export function getColumnBySynonym(term: string): string | null {
  for (const table of SALES_SEMANTIC_MODEL.tables) {
    for (const dim of table.dimensions) {
      if (dim.label === term || dim.synonyms.includes(term) || dim.column === term) {
        return dim.column;
      }
    }
    for (const met of table.metrics) {
      if (met.label === term || met.synonyms.includes(term) || met.column === term) {
        return met.column;
      }
    }
  }
  return null;
}

export function mapValue(column: string, value: string): string {
  for (const table of SALES_SEMANTIC_MODEL.tables) {
    const dim = table.dimensions.find(d => d.column === column);
    if (dim?.valueMap && dim.valueMap[value]) {
      return dim.valueMap[value];
    }
  }
  return value;
}

export function getAllowedTables(): string[] {
  return SALES_SEMANTIC_MODEL.tables.map(t => t.name);
}

export function getAllowedColumns(): string[] {
  const cols: string[] = [];
  for (const table of SALES_SEMANTIC_MODEL.tables) {
    cols.push(...table.dimensions.map(d => d.column));
    cols.push(...table.metrics.map(m => m.column));
  }
  return cols;
}

export function getSampleRows(): string {
  const table = SALES_SEMANTIC_MODEL.tables[0];
  const dims = table.dimensions.map(d => `${d.column}: "${d.label}"`).join(', ');
  const metrics = table.metrics.map(m => `${m.column}: number`).join(', ');
  return `Fields: ${dims}, ${metrics}\nExample rows: 武莹 | 花园桥校区 | 7月 | 加微:15 | 互动:8 | 需求:3 | 成交:2`;
}
