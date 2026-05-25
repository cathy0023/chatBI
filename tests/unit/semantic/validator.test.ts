import { describe, it, expect } from 'vitest';
import { validateSQL } from '@/lib/semantic/validator';

describe('validateSQL', () => {
  describe('valid queries', () => {
    it('should pass a simple SELECT', () => {
      const result = validateSQL('SELECT * FROM sales_performance LIMIT 10');
      expect(result.valid).toBe(true);
    });

    it('should pass SELECT with WHERE IN', () => {
      const result = validateSQL("SELECT name, month FROM sales_performance WHERE month IN ('7月','8月')");
      expect(result.valid).toBe(true);
    });

    it('should pass SELECT with GROUP BY and aggregates', () => {
      const result = validateSQL('SELECT department, SUM(deal) AS "总成交" FROM sales_performance GROUP BY department');
      expect(result.valid).toBe(true);
    });

    it('should pass SELECT with ORDER BY and LIMIT', () => {
      const result = validateSQL('SELECT name, SUM(deal) AS total FROM sales_performance GROUP BY name ORDER BY total DESC LIMIT 10');
      expect(result.valid).toBe(true);
    });

    it('should pass SELECT with subquery', () => {
      const result = validateSQL('SELECT * FROM sales_performance WHERE deal > (SELECT AVG(deal) FROM sales_performance)');
      expect(result.valid).toBe(true);
    });

    it('should auto-append LIMIT if missing', () => {
      const result = validateSQL('SELECT * FROM sales_performance');
      expect(result.valid).toBe(true);
      expect(result.sql).toContain('LIMIT 1000');
    });
  });

  describe('blocked queries', () => {
    it('should reject INSERT', () => {
      const result = validateSQL("INSERT INTO sales_performance VALUES (1, 'test')");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('SELECT');
      }
    });

    it('should reject UPDATE', () => {
      const result = validateSQL("UPDATE sales_performance SET deal = 999");
      expect(result.valid).toBe(false);
    });

    it('should reject DELETE', () => {
      const result = validateSQL('DELETE FROM sales_performance');
      expect(result.valid).toBe(false);
    });

    it('should reject DROP', () => {
      const result = validateSQL('DROP TABLE sales_performance');
      expect(result.valid).toBe(false);
    });

    it('should reject ALTER', () => {
      const result = validateSQL('ALTER TABLE sales_performance ADD COLUMN test TEXT');
      expect(result.valid).toBe(false);
    });

    it('should reject PRAGMA', () => {
      const result = validateSQL('PRAGMA table_info(sales_performance)');
      expect(result.valid).toBe(false);
    });

    it('should reject ATTACH', () => {
      const result = validateSQL("ATTACH DATABASE 'evil.db' AS evil");
      expect(result.valid).toBe(false);
    });

    it('should reject multi-statement injection', () => {
      const result = validateSQL("SELECT * FROM sales_performance; DROP TABLE sales_performance;");
      expect(result.valid).toBe(false);
    });

    it('should reject unknown table names', () => {
      const result = validateSQL('SELECT * FROM users');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('table');
      }
    });

    it('should reject BETWEEN on month field', () => {
      const result = validateSQL("SELECT month, SUM(deal) AS deal FROM sales_performance WHERE month BETWEEN '7月' AND '10月' GROUP BY month");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('BETWEEN');
      }
    });

    it('should reject queries referencing unknown columns', () => {
      const result = validateSQL('SELECT password FROM sales_performance');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('column');
      }
    });
  });
});
