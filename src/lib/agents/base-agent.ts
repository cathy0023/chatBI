import { z } from 'zod';

// Custom error types
export class AgentValidationError extends Error {
  constructor(
    public readonly agent: string,
    public readonly phase: 'input' | 'output',
    public readonly issues: z.ZodIssue[],
    message?: string,
  ) {
    super(message || `Agent ${agent} ${phase} validation failed: ${issues.map(i => i.message).join(', ')}`);
    this.name = 'AgentValidationError';
  }
}

export class AgentExecutionError extends Error {
  constructor(
    public readonly agent: string,
    public readonly cause: Error,
    message?: string,
  ) {
    super(message || `Agent ${agent} execution failed: ${cause.message}`);
    this.name = 'AgentExecutionError';
  }
}

// Circuit breaker state
type CircuitState = 'closed' | 'open' | 'half-open';

export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly inputSchema: z.ZodSchema<TInput>;
  abstract readonly outputSchema: z.ZodSchema<TOutput>;

  private failures = 0;
  private lastFailureTime = 0;
  private circuitState: CircuitState = 'closed';

  private static readonly MAX_FAILURES = 3;
  private static readonly RESET_TIMEOUT = 60_000; // 1 minute

  async execute(input: unknown): Promise<TOutput> {
    // Circuit breaker check
    if (this.circuitState === 'open') {
      if (Date.now() - this.lastFailureTime > BaseAgent.RESET_TIMEOUT) {
        this.circuitState = 'half-open';
      } else {
        throw new AgentExecutionError(
          this.name,
          new Error(`Circuit breaker is open (consecutive failures: ${this.failures})`)
        );
      }
    }

    // Validate input
    const inputResult = this.inputSchema.safeParse(input);
    if (!inputResult.success) {
      throw new AgentValidationError(this.name, 'input', inputResult.error.issues);
    }

    // Execute with retry (1 retry on failure)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.run(inputResult.data);

        // Validate output
        const outputResult = this.outputSchema.safeParse(result);
        if (!outputResult.success) {
          if (attempt === 0) {
            // On first attempt with invalid output, retry with error info
            lastError = new AgentValidationError(this.name, 'output', outputResult.error.issues);
            continue;
          }
          throw new AgentValidationError(this.name, 'output', outputResult.error.issues);
        }

        // Success - reset circuit breaker
        this.failures = 0;
        this.circuitState = 'closed';
        return outputResult.data;
      } catch (error) {
        if (error instanceof AgentValidationError) {
          lastError = error;
          continue;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === 0) continue;
      }
    }

    // All attempts failed - update circuit breaker
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= BaseAgent.MAX_FAILURES) {
      this.circuitState = 'open';
    }

    throw lastError || new AgentExecutionError(this.name, new Error('Unknown error'));
  }

  protected abstract run(input: TInput): Promise<TOutput>;
}
