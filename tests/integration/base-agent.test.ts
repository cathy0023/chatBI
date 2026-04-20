import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { BaseAgent, AgentValidationError, AgentExecutionError } from '@/lib/agents/base-agent';

// Concrete test agent
class EchoAgent extends BaseAgent<string, { echoed: string }> {
  readonly name = 'Echo Agent';
  readonly inputSchema = z.string().min(1);
  readonly outputSchema = z.object({ echoed: z.string() });

  private shouldFail = false;
  private failCount = 0;
  private maxFails = 0;

  protected async run(input: string): Promise<{ echoed: string }> {
    if (this.shouldFail && this.failCount < this.maxFails) {
      this.failCount++;
      throw new Error(`Simulated failure #${this.failCount}`);
    }
    return { echoed: input };
  }

  /** Force the agent to fail N times before succeeding */
  forceFail(count: number) {
    this.shouldFail = true;
    this.maxFails = count;
    this.failCount = 0;
  }
}

describe('BaseAgent', () => {
  let agent: EchoAgent;

  beforeEach(() => {
    agent = new EchoAgent();
  });

  describe('Input Validation', () => {
    it('should accept valid input', async () => {
      const result = await agent.execute('hello');
      expect(result).toEqual({ echoed: 'hello' });
    });

    it('should reject invalid input (empty string)', async () => {
      await expect(agent.execute('')).rejects.toThrow(AgentValidationError);
    });

    it('should reject non-string input', async () => {
      await expect(agent.execute(123)).rejects.toThrow(AgentValidationError);
    });

    it('should include agent name and phase in error', async () => {
      try {
        await agent.execute('');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentValidationError);
        const e = err as AgentValidationError;
        expect(e.agent).toBe('Echo Agent');
        expect(e.phase).toBe('input');
      }
    });
  });

  describe('Output Validation', () => {
    it('should validate output against schema', async () => {
      // EchoAgent always returns valid output
      const result = await agent.execute('test');
      expect(result.echoed).toBe('test');
    });
  });

  describe('Retry Logic', () => {
    it('should retry once on failure and succeed on second attempt', async () => {
      agent.forceFail(1);
      // BaseAgent retries once (2 attempts total). 1 failure → second attempt succeeds.
      const result = await agent.execute('retry-test');
      expect(result).toEqual({ echoed: 'retry-test' });
    });

    it('should exhaust retries and throw when both attempts fail', async () => {
      agent.forceFail(3); // More than the 2 attempts allowed
      await expect(agent.execute('will-fail')).rejects.toThrow();
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after MAX_FAILURES (3) consecutive failures', async () => {
      // Create a fresh agent to track its own failures
      const cbAgent = new (class extends BaseAgent<string, string> {
        readonly name = 'CB Agent';
        readonly inputSchema = z.string();
        readonly outputSchema = z.string();
        callCount = 0;

        protected async run(_input: string): Promise<string> {
          this.callCount++;
          throw new Error(`Failure ${this.callCount}`);
        }
      })();

      // 3 rounds of (2 attempts each) = 6 calls, but failures accumulate per execute() call
      for (let i = 0; i < 3; i++) {
        await expect(cbAgent.execute('trigger')).rejects.toThrow();
      }

      // 4th call should hit open circuit breaker
      await expect(cbAgent.execute('blocked')).rejects.toThrow('Circuit breaker is open');
    });
  });

  describe('Error Types', () => {
    it('AgentValidationError should have correct properties', () => {
      const issues: z.ZodIssue[] = [
        { message: 'Required', path: ['field'], code: 'invalid_type' as const, expected: 'string' as const },
      ];
      const err = new AgentValidationError('TestAgent', 'input', issues);
      expect(err.name).toBe('AgentValidationError');
      expect(err.agent).toBe('TestAgent');
      expect(err.phase).toBe('input');
      expect(err.issues).toHaveLength(1);
    });

    it('AgentExecutionError should wrap cause', () => {
      const cause = new Error('DB connection lost');
      const err = new AgentExecutionError('TestAgent', cause);
      expect(err.name).toBe('AgentExecutionError');
      expect(err.agent).toBe('TestAgent');
      expect(err.cause).toBe(cause);
      expect(err.message).toContain('DB connection lost');
    });
  });
});
