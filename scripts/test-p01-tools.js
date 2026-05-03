#!/usr/bin/env node

const DEFAULT_P01_PROJECT = '/Users/chenhuan/Desktop/AIGame/p01';

process.env.MCP_TEST_PROJECT ??= process.env.P01_PROJECT ?? DEFAULT_P01_PROJECT;

await import('./test-project-tools.js');
