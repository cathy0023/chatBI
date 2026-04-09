import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initSchema } from './schema';
import { seedData } from './seed';
import { seedSalesData, seedSalesFromExcel } from './seed-sales';

const DB_PATH = path.join(process.cwd(), 'data', 'chatbi.db');

let dbInstance: Database.Database | null = null;
let initialized = false;

export function getDb(): Database.Database {
  if (!dbInstance) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    // Auto-initialize schema and seed data on first connection
    if (!initialized) {
      initialized = true;
      initSchema();

      // Seed SOP data (fallback)
      const sopCount = (dbInstance.prepare('SELECT COUNT(*) as count FROM sop_records').get() as { count: number }).count;
      if (sopCount === 0) {
        try {
          seedData();
        } catch (err) {
          console.error('[DB] SOP seed data load failed:', err);
        }
      }

      // Seed sales performance data: prefer Excel, fallback to JSON
      const salesCount = (dbInstance.prepare('SELECT COUNT(*) as count FROM sales_performance').get() as { count: number }).count;
      if (salesCount === 0) {
        try {
          // Look for Excel data files in common locations
          const excelPaths = [
            path.join(process.cwd(), 'data', 'sales-performance.xlsx'),
            path.join(process.cwd(), 'data', '团队概览（成员）.xlsx'),
            path.join(process.cwd(), 'data', '团队概览（成员） 2026-03-09至2026-04-07.csv'),
          ];
          let imported = false;
          for (const p of excelPaths) {
            if (fs.existsSync(p)) {
              seedSalesFromExcel(p);
              imported = true;
              break;
            }
          }
          if (!imported) {
            seedSalesData();
          }
        } catch (err) {
          console.error('[DB] Sales seed data load failed:', err);
          // Fallback to JSON
          try { seedSalesData(); } catch { /* no-op */ }
        }
      }
    }
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    initialized = false;
  }
}
