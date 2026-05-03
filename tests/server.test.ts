import { describe, expect, it } from 'vitest';

import { createToolExecutor } from '../src/server';

describe('server tool execution', () => {
  it('handles local Godot version lookup without a plugin connection', async () => {
    const execute = createToolExecutor({
      bridge: {
        call: async () => {
          throw new Error('bridge should not be used');
        },
      },
      getGodotVersion: async () => '4.6.2.stable.mono.official.71f334935',
    });

    const result = await execute('get_godot_version', {});

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: '4.6.2.stable.mono.official.71f334935',
        },
      ],
    });
  });

  it('routes plugin tools through the Godot bridge', async () => {
    const execute = createToolExecutor({
      bridge: {
        call: async (method, params) => ({ method, params }),
      },
      getGodotVersion: async () => 'unused',
    });

    const result = await execute('get_project_info', { include_settings: true });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            method: 'get_project_info',
            params: { include_settings: true },
          }, null, 2),
        },
      ],
    });
  });
});
