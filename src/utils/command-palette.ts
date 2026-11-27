export type CommandCategory = 'Active PR' | 'Presets' | 'Bulk Actions' | 'App' | 'Pull Requests';

export interface PaletteCommand {
  id: string;
  category: CommandCategory;
  title: string;
  subtitle?: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const CATEGORY_ORDER: Record<CommandCategory, number> = {
  'Active PR': 0,
  Presets: 1,
  'Bulk Actions': 2,
  App: 3,
  'Pull Requests': 4,
};

export function filterAndRankCommands(
  commands: PaletteCommand[],
  rawQuery: string,
  maxPrResults = 15,
): PaletteCommand[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    let prCount = 0;
    return commands.filter((cmd) => {
      if (cmd.category === 'Pull Requests') {
        prCount++;
        return prCount <= maxPrResults;
      }
      return true;
    });
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  const scored: Array<{ cmd: PaletteCommand; score: number; index: number }> = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    const titleLower = cmd.title.toLowerCase();
    const haystack = `${titleLower} ${(cmd.subtitle ?? '').toLowerCase()} ${(cmd.keywords ?? '').toLowerCase()} ${cmd.category.toLowerCase()}`;

    if (!tokens.every((token) => haystack.includes(token))) {
      continue;
    }

    let score = 0;
    if (titleLower === query) {
      score += 100;
    } else if (titleLower.startsWith(query)) {
      score += 60;
    } else if (titleLower.includes(query)) {
      score += 35;
    }
    for (const token of tokens) {
      if (titleLower.includes(token)) {
        score += 12;
      }
    }
    score -= CATEGORY_ORDER[cmd.category] * 2;
    scored.push({ cmd, score, index: i });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const catDiff = CATEGORY_ORDER[a.cmd.category] - CATEGORY_ORDER[b.cmd.category];
    if (catDiff !== 0) {
      return catDiff;
    }
    return a.index - b.index;
  });

  let prCount = 0;
  const out: PaletteCommand[] = [];
  for (const entry of scored) {
    if (entry.cmd.category === 'Pull Requests') {
      prCount++;
      if (prCount > maxPrResults) {
        continue;
      }
    }
    out.push(entry.cmd);
  }
  return out;
}
