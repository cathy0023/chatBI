import type { QueryRecord, ErrorPatternKey } from './types';

/** 检测一条查询记录中的错误模式 */
export function detectErrorPatterns(record: QueryRecord): ErrorPatternKey[] {
  const patterns: ErrorPatternKey[] = [];
  const sql = record.generatedSQL;

  // 1. 中文别名：AS "中文"
  if (/AS\s+"[\u4e00-\u9fff]/i.test(sql)) {
    patterns.push('alias_chinese_column');
  }

  // 2. GROUP BY 缺失：有聚合函数但无 GROUP BY
  if (/\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(sql) && !/\bGROUP\s+BY\b/i.test(sql)) {
    patterns.push('missing_group_by');
  }

  // 3. 聚合函数错误：对非数值列用 SUM
  if (/SUM\(\s*(name|department|month)\s*\)/i.test(sql)) {
    patterns.push('wrong_aggregate');
  }

  // 4. 全零结果
  if (record.hasAllZeroRows) {
    patterns.push('all_zero_result');
  }

  // 5. 月份格式错：month = '7' 而不是 '7月'
  const monthValueMatch = sql.match(/month\s*=\s*['"](\d+)['"]/);
  if (monthValueMatch && !monthValueMatch[1].includes('月')) {
    patterns.push('invalid_month_format');
  }

  // 6. 部门名不匹配（需要外部传入已知部门列表）
  // 由调用方在检测后补充

  return patterns;
}

/** 检测部门名不匹配（需要已知部门列表） */
export function detectUnknownDepartment(
  record: QueryRecord,
  knownDepartments: string[]
): boolean {
  const sql = record.generatedSQL;
  const deptMatch = sql.match(/department\s*=\s*['"]([^'"]+)['"]/);
  if (!deptMatch) return false;

  const deptValue = deptMatch[1];
  return !knownDepartments.some(d => deptValue.includes(d));
}

/** 批量检测最近失败记录中的错误模式，返回模式统计 */
export function detectPatternsFromRecords(
  records: QueryRecord[],
  knownDepartments: string[] = []
): Map<ErrorPatternKey, number> {
  const counts = new Map<ErrorPatternKey, number>();

  for (const record of records) {
    const patterns = detectErrorPatterns(record);
    if (detectUnknownDepartment(record, knownDepartments)) {
      patterns.push('unknown_department');
    }
    for (const p of patterns) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }

  return counts;
}