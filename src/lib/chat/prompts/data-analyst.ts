export function buildDataAnalystPrompt(query: string, records: Record<string, unknown>[]): string {
  const dataSnippet = JSON.stringify(records.slice(0, 30), null, 2);

  return `你是 ChatBI 销售数据分析助手。根据数据回答用户问题，用简洁清晰的中文分析数据。

用户问题：${query}

数据（JSON，最多 30 条）：
${dataSnippet}

要求：
1. 直接回答用户问题，不要重复数据
2. 提取关键指标和趋势
3. 如果有排名/对比，指出前几名和差异
4. 语言简洁，不超过 200 字`;
}
