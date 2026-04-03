import { searchSopRecords, countSopRecords } from '@/lib/db/queries';
import type { SopRecord, SopCategory } from '@/types/database';

export type SearchResult = {
  records: SopRecord[];
  totalCount: number;
  confidence: number;
};

export function keywordSearch(query: string, category?: SopCategory, limit: number = 20): SearchResult {
  const records = searchSopRecords(query, category, limit);
  const totalCount = countSopRecords(category);
  return {
    records,
    totalCount: records.length,
    confidence: records.length > 0 ? 0.7 : 0,
  };
}

export function hybridSearch(query: string, category?: SopCategory, limit: number = 20): SearchResult {
  // MVP: Simple keyword-based search with tag matching
  // Phase 3 will add vector semantic search

  const records = searchSopRecords(query, category, limit);

  // Also search by individual words for better coverage
  const words = query.split(/[\s,，、]+/).filter(w => w.length > 1);
  const allRecords = new Map<string, SopRecord>();

  // Add direct query results
  for (const r of records) {
    allRecords.set(r.id, r);
  }

  // Add per-word results
  for (const word of words) {
    const wordResults = searchSopRecords(word, category, limit);
    for (const r of wordResults) {
      if (!allRecords.has(r.id)) {
        allRecords.set(r.id, r);
      }
    }
  }

  const finalRecords = Array.from(allRecords.values()).slice(0, limit);

  return {
    records: finalRecords,
    totalCount: finalRecords.length,
    confidence: finalRecords.length > 0 ? Math.min(0.5 + finalRecords.length * 0.05, 0.9) : 0,
  };
}