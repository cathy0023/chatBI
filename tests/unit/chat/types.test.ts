import { describe, it, expect } from 'vitest';
import { DEFAULT_TENANT, type TenantContext, type ToolContext, type ReActResult } from '@/lib/chat/types';

describe('chat/types', () => {
  it('DEFAULT_TENANT has required fields', () => {
    expect(DEFAULT_TENANT.tenantId).toBe('default');
    expect(DEFAULT_TENANT.name).toBe('ChatBI');
    expect(DEFAULT_TENANT.permissions.queryOwnDeptOnly).toBe(false);
    expect(DEFAULT_TENANT.permissions.allowedChartTypes).toContain('bar');
  });

  it('TenantContext shape is satisfied by DEFAULT_TENANT', () => {
    const tenant: TenantContext = DEFAULT_TENANT;
    expect(tenant.tenantId).toBeDefined();
    expect(tenant.permissions).toBeDefined();
  });

  it('ToolContext requires send function', () => {
    const ctx: ToolContext = {
      tenant: DEFAULT_TENANT,
      sessionId: 'test',
      send: () => {},
      data: [],
      columns: [],
      originalQuery: 'test',
    };
    expect(typeof ctx.send).toBe('function');
  });

  it('ReActResult has text and steps', () => {
    const result: ReActResult = {
      text: 'hello',
      steps: [{ type: 'text', content: 'hello' }],
      toolResults: [],
    };
    expect(result.text).toBe('hello');
    expect(result.steps).toHaveLength(1);
  });
});
