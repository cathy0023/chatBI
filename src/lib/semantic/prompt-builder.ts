import { SALES_SEMANTIC_MODEL } from './model';
import { getActiveRuleTexts, seedInitialRules } from './correction-rules';

const DDL = `CREATE TABLE sales_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  month TEXT NOT NULL,
  wechat_added INTEGER DEFAULT 0,
  interaction INTEGER DEFAULT 0,
  demand INTEGER DEFAULT 0,
  deal INTEGER DEFAULT 0
);`;

export function buildNL2SQLPrompt(question: string): string {
  // 冷启动：确保纠正规则表有初始数据
  seedInitialRules();

  // 从 correction_rules 表动态读取规则
  const dynamicRules = getActiveRuleTexts();

  const table = SALES_SEMANTIC_MODEL.tables[0];

  const dimDesc = table.dimensions.map(d => {
    let desc = `  - ${d.column} (${d.label}): ${d.description}`;
    if (d.synonyms.length > 0) desc += ` [同义词: ${d.synonyms.join(', ')}]`;
    if (d.enum) desc += ` [有效值: ${d.enum.join(', ')}]`;
    if (d.valueMap) {
      const mappings = Object.entries(d.valueMap).map(([k, v]) => `${k}→${v}`).join(', ');
      desc += ` [值映射: ${mappings}]`;
    }
    return desc;
  }).join('\n');

  const metDesc = table.metrics.map(m =>
    `  - ${m.column} (${m.label}): ${m.description} [同义词: ${m.synonyms.join(', ')}] [默认聚合: ${m.defaultAgg}]`
  ).join('\n');

  return `你是 SQL 生成引擎。根据以下语义模型定义，将用户的中文问题转换为一条 SQLite SELECT 语句。

【语义模型: ${SALES_SEMANTIC_MODEL.description}】
表: ${table.name} — ${table.description}

维度字段:
${dimDesc}

指标字段:
${metDesc}

业务背景: ${SALES_SEMANTIC_MODEL.businessContext}

【表结构 DDL】
${DDL}

【规则】（编号小的优先级高）
${dynamicRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【示例】
问题: "张三的微信添加数"
SQL: SELECT month, wechat_added FROM sales_performance WHERE name = '张三'

问题: "李明7月和8月成交数"
SQL: SELECT month, SUM(deal) AS deal FROM sales_performance WHERE name = '李明' AND month IN ('7月','8月') GROUP BY month

问题: "各部门10月成交数"
SQL: SELECT department, SUM(deal) AS deal FROM sales_performance WHERE month = '10月' GROUP BY department

用户问题: "${question}"`;
}
