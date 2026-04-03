import { getDb } from './connection';
import { initSchema } from './schema';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

type SeedRecord = {
  id?: string;
  category: 'script' | 'kpi' | 'case' | 'training';
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

export function seedData(filePath?: string): number {
  initSchema();

  const db = getDb();
  const dataPath = filePath || path.join(process.cwd(), 'data', 'sample-sop-data.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const records: SeedRecord[] = JSON.parse(raw);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO sop_records (id, category, title, content, tags, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  let count = 0;
  const transaction = db.transaction(() => {
    for (const record of records) {
      insert.run(
        record.id || uuidv4(),
        record.category,
        record.title,
        record.content,
        JSON.stringify(record.tags),
        JSON.stringify(record.metadata)
      );
      count++;
    }
  });

  transaction();
  return count;
}
