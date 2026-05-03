import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import { GodotPluginBridge, JsonRpcBridgeError } from '../src/pluginClient';
import { createToolExecutor } from '../src/server';

describe('server tool execution', () => {
  let bridge: GodotPluginBridge | undefined;

  afterEach(async () => {
    await bridge?.stop();
    bridge = undefined;
  });

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

  it('stores and returns the active project without requiring a plugin tool registration', async () => {
    const execute = createToolExecutor({
      bridge: {
        call: async () => {
          throw new Error('bridge should not be used');
        },
      },
      getGodotVersion: async () => 'unused',
    });

    const setResult = await execute('set_active_project', { project_path: '/tmp/project-a' });
    const getResult = await execute('get_active_project', {});

    expect(JSON.parse(setResult.content[0].text)).toEqual({
      active_project: '/tmp/project-a',
    });
    expect(JSON.parse(getResult.content[0].text)).toEqual({
      active_project: '/tmp/project-a',
    });
  });

  it('handles local tool discovery helpers without a plugin connection', async () => {
    const execute = createToolExecutor({
      bridge: {
        call: async () => {
          throw new Error('bridge should not be used');
        },
      },
      getGodotVersion: async () => 'unused',
      mode: 'lite',
      safety: 'normal',
    });

    const groups = JSON.parse((await execute('list_tool_groups', {
      mode: 'minimal',
      include_tools: false,
    })).content[0].text);
    const description = JSON.parse((await execute('describe_tool', {
      tool_name: 'create_scene',
    })).content[0].text);
    const workflow = JSON.parse((await execute('suggest_workflow', {
      goal: '创建一个 3D 场景并设置相机',
      mode: '3d',
    })).content[0].text);
    const capabilities = JSON.parse((await execute('get_project_capabilities', {
      mode: 'full',
    })).content[0].text);

    expect(groups).toMatchObject({
      mode: 'minimal',
      total: 39,
      groups: {
        local: {
          count: 13,
        },
      },
    });
    expect(description).toMatchObject({
      name: 'create_scene',
      category: 'scene',
      local: false,
      modes: ['minimal', 'lite', '3d', 'full'],
    });
    expect(workflow.steps.map((step: { tool: string }) => step.tool)).toEqual(
      expect.arrayContaining(['doctor_connection', 'create_scene', 'add_mesh_instance']),
    );
    expect(capabilities).toMatchObject({
      mode: 'full',
      safety: 'normal',
      tool_count: 186,
      plugin_tools: 173,
    });
  });

  it('blocks write tools when the active project differs from the connected plugin project', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method, params) => {
          calls.push({ method, params });
          if (method === 'get_project_info') {
            return { project_path: '/tmp/project-b' };
          }
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
    });

    await execute('set_active_project', { projectPath: '/tmp/project-a' });
    const result = await execute('delete_scene', { path: 'res://old.tscn' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Active project mismatch');
    expect(calls).toEqual([
      { method: 'get_project_info', params: {} },
    ]);
  });

  it('protects mutating tools that do not use write-like prefixes', async () => {
    const calls: string[] = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method) => {
          calls.push(method);
          if (method === 'get_project_info') {
            return { project_path: '/tmp/project-b' };
          }
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
    });

    await execute('set_active_project', { projectPath: '/tmp/project-a' });
    const renameResult = await execute('rename_node', {
      node_path: 'OldName',
      new_name: 'NewName',
    });
    const particleResult = await execute('apply_particle_preset', {
      node_path: 'Particles',
      preset: 'sparks',
    });

    expect(renameResult.isError).toBe(true);
    expect(particleResult.isError).toBe(true);
    expect(renameResult.content[0].text).toContain('Active project mismatch');
    expect(particleResult.content[0].text).toContain('Active project mismatch');
    expect(calls).toEqual(['get_project_info', 'get_project_info']);
  });

  it('does not run the active-project guard for read-only plugin tools', async () => {
    const calls: string[] = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method) => {
          calls.push(method);
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
    });

    await execute('set_active_project', { projectPath: '/tmp/project-a' });
    const result = await execute('get_node_properties', { node_path: 'Label' });

    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
    expect(calls).toEqual(['get_node_properties']);
  });

  it('allows write tools when the active project matches the connected plugin project', async () => {
    const calls: string[] = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method) => {
          calls.push(method);
          if (method === 'get_project_info') {
            return { project_path: '/tmp/project-a' };
          }
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
    });

    await execute('set_active_project', { projectPath: '/tmp/project-a' });
    const result = await execute('delete_scene', { path: 'res://old.tscn' });

    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
    expect(calls).toEqual(['get_project_info', 'delete_scene']);
  });

  it('requires confirm true for destructive tools in strict safety mode', async () => {
    const calls: string[] = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method) => {
          calls.push(method);
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
      safety: 'strict',
    });

    const blocked = await execute('delete_scene', { path: 'res://old.tscn' });
    const allowed = await execute('delete_scene', { path: 'res://old.tscn', confirm: true });

    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain('confirm:true');
    expect(JSON.parse(allowed.content[0].text)).toEqual({ ok: true });
    expect(calls).toEqual(['delete_scene']);
  });

  it('requires explicit script execution approval in normal safety mode', async () => {
    const calls: string[] = [];
    const execute = createToolExecutor({
      bridge: {
        call: async (method) => {
          calls.push(method);
          return { ok: true };
        },
      },
      getGodotVersion: async () => 'unused',
      safety: 'normal',
    });

    const blocked = await execute('execute_editor_script', { code: 'print("hi")' });
    const confirmed = await execute('execute_editor_script', { code: 'print("hi")', confirm: true });
    const allowed = await execute('execute_game_script', { code: 'print("hi")', allowScriptExec: true });

    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain('confirm:true');
    expect(blocked.content[0].text).toContain('allowScriptExec:true');
    expect(JSON.parse(confirmed.content[0].text)).toEqual({ ok: true });
    expect(JSON.parse(allowed.content[0].text)).toEqual({ ok: true });
    expect(calls).toEqual(['execute_editor_script', 'execute_game_script']);
  });

  it('allows script execution without confirmation in permissive safety mode', async () => {
    const execute = createToolExecutor({
      bridge: {
        call: async (method, params) => ({ method, params }),
      },
      getGodotVersion: async () => 'unused',
      safety: 'permissive',
    });

    const result = await execute('execute_game_script', { code: 'print("hi")' });

    expect(JSON.parse(result.content[0].text)).toEqual({
      method: 'execute_game_script',
      params: { code: 'print("hi")' },
    });
  });

  it('reports bridge, Godot, active project, mode, and safety from doctor_connection', async () => {
    const execute = createToolExecutor({
      bridge: {
        port: 6505,
        connectedClientCount: 2,
        call: async () => {
          throw new Error('bridge should not be used');
        },
      },
      getGodotVersion: async () => '4.6.2.stable',
      mode: 'full',
      safety: 'strict',
    });

    await execute('set_active_project', { projectPath: '/tmp/project-a' });
    const result = await execute('doctor_connection', {});

    expect(JSON.parse(result.content[0].text)).toEqual({
      bridge: {
        port: 6505,
        connected_clients: 2,
      },
      godot: {
        available: true,
        version: '4.6.2.stable',
      },
      active_project: '/tmp/project-a',
      mode: 'full',
      safety: 'strict',
      tool_count: 186,
    });
  });

  it('can include plugin status in doctor_connection diagnostics', async () => {
    const execute = createToolExecutor({
      bridge: {
        port: 6505,
        connectedClientCount: 1,
        call: async (method) => {
          if (method !== 'get_mcp_plugin_status') {
            throw new Error('unexpected bridge call');
          }
          return { project_path: '/tmp/project-a', ports: [6505] };
        },
      },
      getGodotVersion: async () => '4.6.2.stable',
      mode: 'lite',
      safety: 'normal',
    });

    const result = await execute('doctor_connection', { include_plugin_status: true });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      bridge: {
        port: 6505,
        connected_clients: 1,
      },
      plugin: {
        available: true,
        status: {
          project_path: '/tmp/project-a',
        },
      },
      tool_count: 95,
    });
  });

  it('preserves JSON-RPC error code and data from the Godot plugin bridge', async () => {
    bridge = new GodotPluginBridge({ port: 0, requestTimeoutMs: 1000 });
    await bridge.start();

    const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    const connected = new Promise<void>((resolve) => client.once('open', resolve));

    client.on('message', (data) => {
      const request = JSON.parse(data.toString());
      client.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32040,
          message: 'Wrong project',
          data: {
            project_path: '/tmp/project-b',
          },
        },
      }));
    });

    await connected;

    await expect(bridge.call('delete_scene', { path: 'res://old.tscn' })).rejects.toMatchObject({
      code: -32040,
      data: {
        project_path: '/tmp/project-b',
      },
      message: 'Wrong project',
    });
    await expect(bridge.call('delete_scene', { path: 'res://old.tscn' })).rejects.toBeInstanceOf(
      JsonRpcBridgeError,
    );

    client.close();
  });
});
