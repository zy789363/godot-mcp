import { describe, expect, it } from 'vitest';

import { getGodotCandidates, resolveGodotPath } from '../src/godot';

describe('Godot path detection', () => {
  it('prefers GODOT_PATH, then the local Mono app, then common macOS paths', () => {
    const candidates = getGodotCandidates({
      platform: 'darwin',
      env: {
        GODOT_PATH: '/custom/Godot',
        HOME: '/Users/example',
      },
    });

    expect(candidates.slice(0, 3)).toEqual([
      '/custom/Godot',
      '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      '/Applications/Godot.app/Contents/MacOS/Godot',
    ]);
  });

  it('returns the first executable candidate', async () => {
    const resolved = await resolveGodotPath({
      candidates: ['/missing/Godot', '/Applications/Godot_mono.app/Contents/MacOS/Godot'],
      exists: async (candidate) => candidate.includes('Godot_mono.app'),
      execVersion: async () => '4.6.2.stable.mono.official.71f334935',
    });

    expect(resolved).toEqual({
      path: '/Applications/Godot_mono.app/Contents/MacOS/Godot',
      version: '4.6.2.stable.mono.official.71f334935',
    });
  });
});
