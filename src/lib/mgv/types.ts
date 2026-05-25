export interface MGVTableData {
  records: Record<string, unknown>[];
  columns: string[];
  context?: MGVContext;
}

export interface MGVContext {
  page?: string;
  kanbanId?: number;
  configId?: number;
  dimension?: string;
}
