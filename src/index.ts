#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { helpText, parseCliArgs } from './cli.js';
import { getGodotCandidates, installAddon, resolveGodotPath } from './godot.js';
import { GodotPluginBridge } from './pluginClient.js';
import { createMcpServer, LocalGodotRuntime } from './server.js';

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    console.error(helpText());
    return;
  }

  if (options.installAddon) {
    const target = await installAddon(options.installAddon);
    console.error(`[SERVER] Godot 插件已安装到: ${target}`);
    return;
  }

  const resolvedGodot = await resolveGodotPath({
    candidates: getGodotCandidates({
      explicitPath: options.godotPath,
    }),
  });

  if (resolvedGodot) {
    console.error(`[SERVER] 使用 Godot: ${resolvedGodot.path}`);
    console.error(`[SERVER] Godot 版本: ${resolvedGodot.version}`);
  } else {
    console.error('[SERVER] 未自动找到 Godot，本地启动类工具会提示设置 GODOT_PATH 或 --godot。');
  }

  const bridge = new GodotPluginBridge({ port: options.port });
  await bridge.start();
  console.error(`[SERVER] WebSocket bridge listening on ws://127.0.0.1:${bridge.port}`);

  const runtime = new LocalGodotRuntime(resolvedGodot?.path);
  const server = createMcpServer({
    mode: options.mode,
    bridge,
    runtime,
    safety: options.safety,
  });

  const cleanup = async () => {
    await bridge.stop();
    await server.close();
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[SERVER] godot-mcp-mypro running in ${options.mode} mode, safety=${options.safety}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Failed to start:', message);
  process.exit(1);
});
