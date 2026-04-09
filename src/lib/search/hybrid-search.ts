import { searchSopRecords, countSopRecords } from '@/lib/db/queries';
import type { SopRecord, SopCategory } from '@/types/database';

export type SearchResult = {
  records: SopRecord[];
  totalCount: number;
  confidence: number;
};

/**
 * Split Chinese text into overlapping 2-character segments for search.
 * Chinese doesn't use spaces to separate words, so we use a sliding window.
 * E.g. "查找价格异议" → ["查找", "价格", "异议"]
 */
function extractChineseSegments(text: string): string[] {
  // Check if text contains Chinese characters
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  if (!hasChinese) return [];

  const segments: string[] = [];
  // Extract 2-character overlapping segments from Chinese portions
  const chineseChars = [...text].filter(c => /[\u4e00-\u9fff]/.test(c));
  for (let i = 0; i < chineseChars.length - 1; i++) {
    const pair = chineseChars[i] + chineseChars[i + 1];
    if (!segments.includes(pair)) {
      segments.push(pair);
    }
  }
  return segments;
}

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
  // MVP: Simple keyword-based search with Chinese-aware segmentation
  // Phase 3 will add vector semantic search

  const allRecords = new Map<string, SopRecord>();

  // Step 1: Search with full query
  const fullResults = searchSopRecords(query, category, limit);
  for (const r of fullResults) {
    allRecords.set(r.id, r);
  }

  // Step 2: Split by whitespace/punctuation (works for mixed-language queries)
  const words = query.split(/[\s,，、；;！!？?]+/).filter(w => w.length > 1);
  for (const word of words) {
    const wordResults = searchSopRecords(word, category, limit);
    for (const r of wordResults) {
      if (!allRecords.has(r.id)) {
        allRecords.set(r.id, r);
      }
    }
  }

  // Step 3: Chinese 2-character segment search (sliding window)
  const segments = extractChineseSegments(query);
  for (const segment of segments) {
    const segResults = searchSopRecords(segment, category, limit);
    for (const r of segResults) {
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
