import { SALES_SEMANTIC_MODEL } from './model';
import type { FewShotExample } from './types';

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

export function buildNL2SQLPrompt(question: string, fewShots: FewShotExample[]): string {
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

  const fewShotSection = fewShots.length > 0
    ? `\n【参考示例】\n${fewShots.map(s => `问题: ${s.question}\nSQL: ${s.sql}`).join('\n\n')}\n`
    : '';

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
${fewShotSection}
【规则】
1. 只生成一条 SELECT 语句，禁止 INSERT/UPDATE/DELETE/DROP/ALTER
2. 所有字段名使用上面的 column 英文名，不要用中文列名
3. 月份字段值必须是: 7月, 8月, 9月, 10月（参考值映射做转换）
4. 多个月份用 IN，如 WHERE month IN ('7月','8月')
5. 聚合时必须保留原始列名作为别名，如 SUM(deal) AS deal, SUM(wechat_added) AS wechat_added，禁止使用中文别名
6. 除非用户明确要求“汇总/总计/合计/总共”，否则不要只返回单行聚合结果；应返回按 name 或 department 的明细/分组数据，支持后续分析 Top、低绩效、零成交
7. 当问题包含“情况/表现/分析/排名”等语义时，优先返回 name, department, month, deal 等可分析字段
8. 只输出 SQL，不要输出任何其他内容，不要用 markdown 代码块包裹

用户问题: "${question}"`;
}
