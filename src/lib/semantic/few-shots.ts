import type { FewShotExample } from './types';

export const FEW_SHOTS: FewShotExample[] = [
  {
    patterns: ['对比', '比较', '相比'],
    question: '对比7月和8月各销售的成交情况',
    sql: `SELECT name, month, deal FROM sales_performance WHERE month IN ('7月','8月') ORDER BY name, month`,
  },
  {
    patterns: ['排行', '排名', 'top', '前'],
    question: '成交排行榜',
    sql: `SELECT name, SUM(deal) AS "总成交" FROM sales_performance GROUP BY name ORDER BY "总成交" DESC LIMIT 10`,
  },
  {
    patterns: ['趋势', '变化', '每月', '走势'],
    question: '每月成交趋势',
    sql: `SELECT month, SUM(deal) AS "总成交", SUM(wechat_added) AS "总加微", SUM(interaction) AS "总互动" FROM sales_performance GROUP BY month ORDER BY month`,
  },
  {
    patterns: ['部门', '各部门', '团队', '校区'],
    question: '各部门10月成交汇总',
    sql: `SELECT department, SUM(deal) AS "总成交", COUNT(*) AS "人数" FROM sales_performance WHERE month = '10月' GROUP BY department ORDER BY "总成交" DESC`,
  },
  {
    patterns: ['转化率', '比率', '率'],
    question: '哪个校区转化率最高',
    sql: `SELECT department, ROUND(SUM(deal)*100.0/NULLIF(SUM(demand),0),1) AS "转化率%" FROM sales_performance GROUP BY department ORDER BY "转化率%" DESC LIMIT 10`,
  },
  {
    patterns: ['有没有', '是否'],
    question: '谁有成交记录',
    sql: `SELECT DISTINCT name, SUM(deal) AS "总成交" FROM sales_performance WHERE deal > 0 GROUP BY name ORDER BY "总成交" DESC`,
  },
];

export function matchFewShots(query: string, maxResults: number = 3): FewShotExample[] {
  const scored: Array<{ shot: FewShotExample; score: number }> = [];

  for (const shot of FEW_SHOTS) {
    let score = 0;
    for (const pattern of shot.patterns) {
      if (query.includes(pattern)) {
        score += 1;
      }
    }
    if (score > 0) {
      scored.push({ shot, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.shot);
}
