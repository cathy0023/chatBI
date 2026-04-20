export function buildDataAnalystPrompt(query: string, records: Record<string, unknown>[]): string {
  const dataSnippet = JSON.stringify(records.slice(0, 30), null, 2);

  // Compute statistics for deeper analysis
  const totalRecords = records.length;
  const totalDeal = records.reduce((sum, r) => sum + Number(r.deal || 0), 0);
  const avgDeal = totalRecords > 0 ? (totalDeal / totalRecords).toFixed(1) : 0;

  // Top performers
  const byPerson = new Map<string, number>();
  records.forEach(r => {
    const name = String(r.name || '');
    const deal = Number(r.deal || 0);
    byPerson.set(name, (byPerson.get(name) || 0) + deal);
  });
  const topPerformers = Array.from(byPerson.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, deal]) => `${name}: ${deal}笔`)
    .join(', ');

  // Zero deal performers
  const zeroDealCount = Array.from(byPerson.entries()).filter(([, deal]) => deal === 0).length;

  return `你是 ChatBI 销售数据分析助手。根据数据进行深度分析，用简洁清晰的中文回答用户问题。

用户问题：${query}

数据统计：
- 总记录数：${totalRecords} 条
- 总成交数：${totalDeal} 笔
- 平均成交：${avgDeal} 笔/人
- Top 5 销售：${topPerformers}
- 零成交人数：${zeroDealCount} 人

数据样本（前 30 条）：
${dataSnippet}

分析要求：
1. **直接回答用户问题**，不要说"查询到 N 条数据"
2. **提供关键洞察**：
   - 总成交数和平均水平
   - Top 销售人员及其成交数
   - 零成交或低绩效人员
   - 部门/月度趋势（如果相关）
3. **数据对比**：如果有排名/对比需求，指出前几名和差异
4. **简洁专业**：用 2-3 段话，每段 50-80 字，总计不超过 300 字
5. **温度感**：用"表现优异"、"需要关注"等词汇，而不是冷冰冰的数字堆砌`;
}
