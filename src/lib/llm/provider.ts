import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';

const apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey) {
  console.warn('[ChatBI] OPENAI_API_KEY is not set. LLM features will not work.');
}

export const deepseek = createDeepSeek({ apiKey });

// Default model (can be overridden via env)
export const DEFAULT_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

// Convenience function
export function getDefaultModel() {
  return deepseek(DEFAULT_MODEL);
}

// Non-streaming generateText for SQL generation and other text tasks
// Includes retry with exponential backoff (max 3 attempts) to handle transient LLM failures
// Each attempt has a 30s timeout to prevent hanging when the LLM API is unresponsive
export async function generateTextCompat(options: {
  prompt?: string;
  system?: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<{ text: string }> {
  const { maxTokens, prompt, system, messages, abortSignal } = options;
  const baseOpts = { model: getDefaultModel(), maxTokens: maxTokens || 4096 };

  const MAX_RETRIES = 3;
  const PER_ATTEMPT_TIMEOUT_MS = 30000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Check if already aborted before starting a new attempt
    if (abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

    // Link external abort signal to our controller
    const onExternalAbort = () => controller.abort();
    abortSignal?.addEventListener('abort', onExternalAbort);

    try {
      const result = messages
        ? await generateText({ ...baseOpts, messages, system, abortSignal: controller.signal })
        : await generateText({ ...baseOpts, prompt: prompt!, system, abortSignal: controller.signal });
      clearTimeout(timeout);
      if (attempt > 1) {
        console.log(`[LLM] Retry succeeded on attempt ${attempt}`);
      }
      return { text: result.text };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const isLastAttempt = attempt === MAX_RETRIES;
      const isAbort = error instanceof Error && (error.name === 'AbortError' || (error as DOMException).code === 20);
      if (isAbort || isLastAttempt) break;
      const delayMs = attempt * 1000;
      console.error(`[LLM] Attempt ${attempt}/${MAX_RETRIES} failed:`, error instanceof Error ? error.message : String(error));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } finally {
      abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError;
}
