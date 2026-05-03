# Godot MCP MyPro

一个自研 TypeScript MCP server，用 WebSocket 连接 Godot 编辑器插件，让 AI 助手可以操作 Godot 4 编辑器、场景、节点、脚本、运行时和调试信息。

本工程迁移了 `godot-mcp-pro` 公开 MIT 仓库里的 Godot 插件代码，但没有使用或还原其未公开的付费 Node.js server。本项目的 server 位于 `src/`，由本仓库自行实现。

快速接入请看：[Godot MCP MyPro 快速上手](docs/QUICKSTART.zh-CN.md)。

## 架构

```text
AI Assistant ← stdio/MCP → TypeScript Server ← WebSocket:6505 → Godot Editor Plugin
```

- `src/index.ts`：MCP server 入口和 CLI 参数处理。
- `src/pluginClient.ts`：本机 WebSocket bridge，等待 Godot 插件连接。
- `src/server.ts`：MCP 工具注册、本地 Godot 工具、插件工具分发。
- `addons/godot_mcp/`：Godot 编辑器插件，公开 MIT 代码迁移而来。

## 本机基线

当前工业化测试基线：

```text
/Applications/Godot_mono.app/Contents/MacOS/Godot
4.6.2.stable.mono.official.71f334935
```

自动检测优先级：

1. `--godot /path/to/Godot`
2. `GODOT_PATH`
3. `/Applications/Godot_mono.app/Contents/MacOS/Godot`
4. 常见 Godot 安装路径

## 安装与运行

```bash
npm ci
npm run build
node build/index.js --mode lite --port 6505
```

安装 Godot 插件到项目：

```bash
node build/index.js --install-addon /path/to/godot-project
```

然后在 Godot 中启用：

```text
Project -> Project Settings -> Plugins -> Godot MCP MyPro -> Enable
```

## CLI 参数

```bash
godot-mcp --mode full|3d|lite|minimal
godot-mcp --godot /Applications/Godot_mono.app/Contents/MacOS/Godot
godot-mcp --port 6505
godot-mcp --install-addon /path/to/godot-project
```

默认 `--mode lite`。`full` 会暴露公开插件中的全量迁移工具；`lite` 先覆盖项目、场景、节点、脚本、编辑器、输入、运行时和 InputMap 核心工作流。

## 测试

```bash
npm test
npm run test:godot
npm run test:e2e
npm run check
```

- `npm test`：工具模式、CLI、Godot 路径检测、server 分发、WebSocket bridge 单元/E2E 测试。
- `npm run test:godot`：构建后用本机 Godot 4.6.2 Mono 加载临时插件 fixture。
- `npm run check`：构建、单元测试和 Godot 插件加载检查。

## 许可

本项目使用 MIT License。迁入的 Godot 插件代码来源见 `addons/godot_mcp/NOTICE.md`。
