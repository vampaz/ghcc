// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterAndRankCommands, type PaletteCommand } from '@/utils/command-palette';

function cmd(
  partial: Partial<PaletteCommand> & Pick<PaletteCommand, 'id' | 'category' | 'title'>,
): PaletteCommand {
  return {
    run: () => {},
    ...partial,
  };
}

describe('filterAndRankCommands', () => {
  it('ranks prefix matches higher, supports multi-token search, and caps PR results', () => {
    const commands: PaletteCommand[] = [
      cmd({ id: 'a1', category: 'Active PR', title: 'Sync acme/core-api#101 with main' }),
      cmd({ id: 'p1', category: 'Presets', title: 'Failing CI', subtitle: 'Open PRs failing' }),
      cmd({ id: 'b1', category: 'Bulk Actions', title: 'Sync all behind PRs in view (3)' }),
      ...Array.from({ length: 20 }, (_, i) =>
        cmd({
          id: `pr-${i}`,
          category: 'Pull Requests',
          title: `acme/core-api#${200 + i} · fix retry ${i}`,
          subtitle: '@vampaz',
          keywords: 'backend',
        }),
      ),
    ];

    const empty = filterAndRankCommands(commands, '', 5);
    expect(empty.filter((c) => c.category === 'Pull Requests')).toHaveLength(5);

    const syncMatches = filterAndRankCommands(commands, 'sync');
    expect(syncMatches[0]?.id).toBe('a1');
    expect(syncMatches.map((c) => c.id)).toContain('b1');

    const multiToken = filterAndRankCommands(commands, 'backend 212');
    expect(multiToken.map((c) => c.id)).toEqual(['pr-12']);
  });
});
