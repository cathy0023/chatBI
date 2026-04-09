import { getDb } from './connection';
import { initSchema } from './schema';
import fs from 'fs';
import path from 'path';

type SalesJsonRow = {
  name: string;
  department: string;
  month: string;
  wechat_added: number;
  interaction: number;
  demand: number;
  deal: number;
};

/**
 * Parse a cell value like "28个" or "0个" into a number.
 * Returns 0 for non-numeric or empty values.
 */
function parseCell(raw: unknown): number {
  if (raw == null) return 0;
  const str = String(raw).replace(/个/g, '').trim();
  const num = Number(str);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Import sales data from an Excel (.xlsx) file exported from the team overview report.
 *
 * Expected header layout (15 columns):
 *   姓名 | 主部门信息 | 7月加微总数 | 7月企微互动 | 7月有需求 | 7月成交
 *                     | 8月企微互动 | 8月有需求 | 8月成交
 *                     | 9月企微互动 | 9月有需求 | 9月成交
 *                     | 10月企微互动 | 10月有需求 | 10月成交
 *
 * Note: only July has "加微总数"; Aug-Oct default wechat_added to 0.
 */
export function seedSalesFromExcel(xlsxPath: string): number {
  // xlsx is a devDependency — lazy require to avoid bundling in client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');

  initSchema();
  const db = getDb();

  if (!fs.existsSync(xlsxPath)) {
    console.warn('[DB] Excel file not found:', xlsxPath);
    return 0;
  }

  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Skip header row (0), 总计 row (1), 平均 row (2)
  const dataRows = rows.slice(3);
  const records: SalesJsonRow[] = [];

  for (const row of dataRows) {
    const name = String(row[0] ?? '').trim();
    const department = String(row[1] ?? '').trim();

    // Skip empty rows or summary rows
    if (!name || !department || name === '总计' || name === '平均' || department === '-') {
      continue;
    }

    // July: index 2=加微, 3=互动, 4=需求, 5=成交
    records.push({
      name,
      department,
      month: '7月',
      wechat_added: parseCell(row[2]),
      interaction: parseCell(row[3]),
      demand: parseCell(row[4]),
      deal: parseCell(row[5]),
    });

    // Aug: index 6=互动, 7=需求, 8=成交 (no 加微)
    records.push({
      name,
      department,
      month: '8月',
      wechat_added: 0,
      interaction: parseCell(row[6]),
      demand: parseCell(row[7]),
      deal: parseCell(row[8]),
    });

    // Sep: index 9=互动, 10=需求, 11=成交
    records.push({
      name,
      department,
      month: '9月',
      wechat_added: 0,
      interaction: parseCell(row[9]),
      demand: parseCell(row[10]),
      deal: parseCell(row[11]),
    });

    // Oct: index 12=互动, 13=需求, 14=成交
    records.push({
      name,
      department,
      month: '10月',
      wechat_added: 0,
      interaction: parseCell(row[12]),
      demand: parseCell(row[13]),
      deal: parseCell(row[14]),
    });
  }

  const insert = db.prepare(`
    INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM sales_performance').run();
    for (const record of records) {
      insert.run(
        record.name,
        record.department,
        record.month,
        record.wechat_added,
        record.interaction,
        record.demand,
        record.deal,
      );
      count++;
    }
  });

  transaction();
  console.log(`[DB] Imported ${count} sales records from Excel (${records.length / 4} people)`);
  return count;
}

/**
 * Legacy: seed from JSON file (fallback when no Excel is available).
 */
export function seedSalesData(filePath?: string): number {
  initSchema();

  const db = getDb();
  const dataPath = filePath || path.join(process.cwd(), 'data', 'sales-performance.json');

  if (!fs.existsSync(dataPath)) {
    console.warn('[DB] Sales data file not found:', dataPath);
    return 0;
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  const records: SalesJsonRow[] = JSON.parse(raw);

  const insert = db.prepare(`
    INSERT INTO sales_performance (name, department, month, wechat_added, interaction, demand, deal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM sales_performance').run();
    for (const record of records) {
      insert.run(
        record.name,
        record.department,
        record.month,
        record.wechat_added,
        record.interaction,
        record.demand,
        record.deal,
      );
      count++;
    }
  });

  transaction();
  return count;
}
