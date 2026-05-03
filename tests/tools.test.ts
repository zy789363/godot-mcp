import { describe, expect, it } from 'vitest';

import { getToolsForMode, normalizeMode } from '../src/tools';

describe('tool mode filtering', () => {
  it('defaults unknown modes to lite', () => {
    expect(normalizeMode(undefined)).toBe('lite');
    expect(normalizeMode('surprise')).toBe('lite');
  });

  it('lite mode exposes the core editor workflow but excludes content-specialist tools', () => {
    const names = getToolsForMode('lite').map((tool) => tool.name);

    expect(names).toContain('get_project_info');
    expect(names).toContain('create_scene');
    expect(names).toContain('add_node');
    expect(names).toContain('create_script');
    expect(names).toContain('simulate_key');
    expect(names).toContain('get_game_scene_tree');
    expect(names).toContain('get_input_actions');
    expect(names).not.toContain('create_particles');
    expect(names).not.toContain('deploy_to_android');
  });

  it('full mode exposes migrated pro plugin tools', () => {
    const names = getToolsForMode('full').map((tool) => tool.name);

    expect(names).toContain('create_particles');
    expect(names).toContain('set_material_3d');
    expect(names).toContain('get_audio_bus_layout');
    expect(names).toContain('run_test_scenario');
    expect(names).toContain('deploy_to_android');
    expect(names.length).toBeGreaterThanOrEqual(170);
  });
});
