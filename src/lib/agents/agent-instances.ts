/**
 * Shared agent instances — singletons used by both route.ts and message-handler.ts.
 * Extracted to a separate module to avoid circular dependencies.
 */

import { QueryAgent } from './query-agent';

export const queryAgent = new QueryAgent();
