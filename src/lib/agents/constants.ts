/**
 * Shared constants for the agent pipeline.
 * Single source of truth — eliminates scattered magic numbers.
 */

// ==================== Router ====================
/** Minimum confidence for keyword-based routing to skip LLM */
export const KEYWORD_CONFIDENCE_THRESHOLD = 0.7;

/** Confidence increment per matched keyword */
export const KEYWORD_CONFIDENCE_STEP = 0.12;

/** Maximum confidence from keyword matching */
export const KEYWORD_CONFIDENCE_MAX = 0.95;

/** Base confidence when at least one keyword matches */
export const KEYWORD_CONFIDENCE_BASE = 0.5;

// ==================== NL2SQL ====================
/** Confidence for successfully generated SQL */
export const SQL_GENERATED_CONFIDENCE = 0.9;

/** Confidence for self-repaired SQL */
export const SQL_REPAIRED_CONFIDENCE = 0.7;

/** Confidence for fallback (empty results) */
export const SQL_FALLBACK_CONFIDENCE = 0;

// ==================== Agent Base ====================
/** Max consecutive failures before circuit breaker opens */
export const CIRCUIT_BREAKER_MAX_FAILURES = 3;

/** Time in ms before circuit breaker resets */
export const CIRCUIT_BREAKER_RESET_TIMEOUT = 60_000;

// ==================== Stats ====================
/** Number of top performers to include in stats */
export const TOP_N_PERFORMERS = 5;

// ==================== Greeting ====================
/** Pattern for greeting messages — shared between route.ts and message-handler.ts */
export const GREETING_PATTERNS = /^(你好|您好|嗨|hi|hello|hey|哈喽|早上好|下午好|晚上好)[\s!！。.]*$/i;

/** Greeting response text */
export const GREETING_RESPONSE = '您好！我是 ChatBI 销售业绩分析助手，可以帮您查询和分析团队销售数据。\n\n您可以试试：\n- 「花园桥校区的业绩」\n- 「分析各部门10月成交情况」\n- 「成交排行榜」\n- 「武莹的销售数据」';
