import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli';

describe('CLI options', () => {
  it('uses lite mode and port 6505 by default', () => {
    expect(parseCliArgs([])).toMatchObject({
      mode: 'lite',
      port: 6505,
    });
  });

  it('parses mode, Godot path, port, and addon installation target', () => {
    expect(parseCliArgs([
      '--mode',
      'full',
      '--godot',
      '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      '--port',
      '6510',
      '--install-addon',
      '/tmp/game',
    ])).toMatchObject({
      mode: 'full',
      godotPath: '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      port: 6510,
      installAddon: '/tmp/game',
    });
  });
});
