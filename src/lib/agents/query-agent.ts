import { z } from 'zod';
import { BaseAgent } from './base-agent';
import { hybridSearch, keywordSearch, type SearchResult } from '@/lib/search/hybrid-search';
import { getSopRecordsByCategory, getSopRecordById } from '@/lib/db/queries';
import { NL2SQLEngine } from '@/lib/semantic/nl2sql';
import { getDb } from '@/lib/db/connection';
import type { SopCategory } from '@/types/database';

// Singleton engine — initialized lazily
let engineInstance: NL2SQLEngine | null = null;
function getEngine(): NL2SQLEngine {
  if (!engineInstance) {
    engineInstance = new NL2SQLEngine(getDb());
  }
  return engineInstance;
}

// ==================== Agent Schemas ====================

// Input
const queryInputSchema = z.object({
  query: z.string().min(1),
  category: z.enum(['script', 'kpi', 'case', 'training']).optional(),
  recordId: z.string().optional(),
  searchType: z.enum(['hybrid', 'keyword', 'category', 'id', 'sales']).default('sales'),
});

// Output
const queryOutputSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  totalCount: z.number(),
  query: z.string(),
  searchType: z.string(),
  confidence: z.number().min(0).max(1),
});

type QueryInput = z.infer<typeof queryInputSchema>;
type QueryOutput = z.infer<typeof queryOutputSchema>;

export class QueryAgent extends BaseAgent<QueryInput, QueryOutput> {
  readonly name = 'Query Agent';
  readonly inputSchema = queryInputSchema;
  readonly outputSchema = queryOutputSchema;

  protected async run(input: QueryInput): Promise<QueryOutput> {
    // Sales search — NL2SQL engine
    if (input.searchType === 'sales') {
      const engine = getEngine();
      const result = await engine.query(input.query);
      return {
        records: result.records,
        totalCount: result.records.length,
        query: input.query,
        searchType: 'sales',
        confidence: result.confidence,
      };
    }

    // Legacy SOP search
    let result: SearchResult;

    switch (input.searchType) {
      case 'id': {
        const record = getSopRecordById(input.recordId || '');
        result = {
          records: record ? [record] : [],
          totalCount: record ? 1 : 0,
          confidence: record ? 1 : 0,
        };
        break;
      }
      case 'category': {
        const records = getSopRecordsByCategory(input.category as SopCategory);
        result = {
          records,
          totalCount: records.length,
          confidence: 0.8,
        };
        break;
      }
      case 'keyword': {
        result = keywordSearch(input.query, input.category);
        break;
      }
      case 'hybrid':
      default: {
        result = hybridSearch(input.query, input.category);
        break;
      }
    }

    return {
      records: result.records.map(r => ({
        ...r,
        tags: JSON.stringify(r.tags),
        metadata: JSON.stringify(r.metadata),
      })),
      totalCount: result.totalCount,
      query: input.query,
      searchType: input.searchType,
      confidence: result.confidence,
    };
  }
}
