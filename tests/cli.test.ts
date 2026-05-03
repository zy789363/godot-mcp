import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli';

describe('CLI options', () => {
  it('uses lite mode and port 6505 by default', () => {
    expect(parseCliArgs([])).toMatchObject({
      mode: 'lite',
      port: 6505,
      safety: 'normal',
    });
  });

  it('parses mode, Godot path, port, safety, and addon installation target', () => {
    expect(parseCliArgs([
      '--mode',
      'full',
      '--godot',
      '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      '--port',
      '6510',
      '--safety',
      'strict',
      '--install-addon',
      '/tmp/game',
    ])).toMatchObject({
      mode: 'full',
      godotPath: '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      port: 6510,
      safety: 'strict',
      installAddon: '/tmp/game',
    });
  });

  it('parses equals-form safety and falls back to normal for unknown values', () => {
    expect(parseCliArgs(['--safety=permissive'])).toMatchObject({
      safety: 'permissive',
    });

    expect(parseCliArgs(['--safety=reckless'])).toMatchObject({
      safety: 'normal',
    });
  });
});
