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
    sql: `SELECT name, SUM(deal) AS deal FROM sales_performance GROUP BY name ORDER BY deal DESC LIMIT 10`,
  },
  {
    patterns: ['成交单top', '成交单前', 'top5', 'top3', 'top前'],
    question: '9月份成交单top5的销售',
    sql: `SELECT name, SUM(deal) AS deal FROM sales_performance WHERE month = '9月' GROUP BY name ORDER BY deal DESC LIMIT 5`,
  },
  {
    patterns: ['趋势', '变化', '每月', '走势'],
    question: '每月成交趋势',
    sql: `SELECT month, SUM(deal) AS deal, SUM(wechat_added) AS wechat_added, SUM(interaction) AS interaction FROM sales_performance GROUP BY month ORDER BY month`,
  },
  {
    patterns: ['部门', '各部门', '团队', '校区'],
    question: '各部门10月成交汇总',
    sql: `SELECT department, SUM(deal) AS deal, COUNT(*) AS cnt FROM sales_performance WHERE month = '10月' GROUP BY department ORDER BY deal DESC`,
  },
  {
    patterns: ['转化率', '比率', '率'],
    question: '哪个校区转化率最高',
    sql: `SELECT department, ROUND(SUM(deal)*100.0/NULLIF(SUM(demand),0),1) AS conversion_rate FROM sales_performance GROUP BY department ORDER BY conversion_rate DESC LIMIT 10`,
  },
  {
    patterns: ['有没有', '是否'],
    question: '谁有成交记录',
    sql: `SELECT DISTINCT name, SUM(deal) AS deal FROM sales_performance WHERE deal > 0 GROUP BY name ORDER BY deal DESC`,
  },
  {
    patterns: ['汇总', '总共', '总计', '一共', '合计'],
    question: '成交汇总',
    sql: `SELECT SUM(deal) AS deal, SUM(wechat_added) AS wechat_added, SUM(interaction) AS interaction, SUM(demand) AS demand FROM sales_performance`,
  },
  {
    patterns: ['销售业绩', '业绩一览', '业绩总览'],
    question: '销售业绩一览',
    sql: `SELECT name, department, month, wechat_added, interaction, demand, deal FROM sales_performance ORDER BY deal DESC, month LIMIT 50`,
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
    .sort((a, b) => b.score - a.score || b.shot.patterns.length - a.shot.patterns.length)
    .slice(0, maxResults)
    .map(s => s.shot);
}
