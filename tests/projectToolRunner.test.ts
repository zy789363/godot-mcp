import { describe, expect, it } from 'vitest';

import { evaluateToolCallOk } from '../scripts/project-test-result.js';

describe('project tool runner result evaluation', () => {
  it('fails expected-error cases when the tool unexpectedly succeeds', () => {
    expect(evaluateToolCallOk({ isError: false, text: '{"ok":true}' }, {
      expectError: true,
    })).toBe(false);
  });

  it('passes expected-error cases only for non-infrastructure errors by default', () => {
    expect(evaluateToolCallOk({ isError: true, text: '缺少必需参数: path' }, {
      expectError: true,
    })).toBe(true);
    expect(evaluateToolCallOk({ isError: true, text: 'Method not found: delete_scene' }, {
      expectError: true,
    })).toBe(false);
    expect(evaluateToolCallOk({ isError: true, text: 'Method not found: delete_scene' }, {
      expectError: true,
      allowInfrastructureError: true,
    })).toBe(true);
  });

  it('fails normal success cases when the tool returns an error', () => {
    expect(evaluateToolCallOk({ isError: true, text: 'boom' }, {})).toBe(false);
  });

  it('can treat infrastructure errors as acceptable during connection probes', () => {
    expect(evaluateToolCallOk({ isError: true, text: 'Godot 插件尚未连接' }, {
      allowInfrastructureError: true,
    })).toBe(true);
    expect(evaluateToolCallOk({ isError: false, text: '{"ok":true}' }, {
      allowInfrastructureError: true,
    })).toBe(true);
  });
});
