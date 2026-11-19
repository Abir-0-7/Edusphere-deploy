import { GAME_CATALOG } from '@studyvault/game-engine/catalog';
import type { GameId } from '@studyvault/types';

export function slugForGame(id: GameId): string {
  return id
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function markerForTitle(title: string): string {
  return title
    .split(/\s+/)
    .map((word) => word.slice(0, 1))
    .join('')
    .toUpperCase()
    .slice(0, 4);
}

const CATEGORIES: Record<string, string> = {
  DebuggingDetective: 'Debugging',
  SQLDetective: 'SQL practice',
  GraphPath: 'Graph algorithms',
  ProofBuilder: 'Mathematical reasoning',
  DataDetective: 'Data literacy',
  AdaptiveQuiz: 'Adaptive practice',
  ExamEscape: 'Puzzle adventure',
};

export const vaultGames = GAME_CATALOG.map((game) => ({
  ...game,
  slug: slugForGame(game.id),
  category:
    CATEGORIES[game.id] ??
    (game.objective.toLowerCase().includes('python') ? 'Python practice' : 'Logic puzzle'),
  marker: markerForTitle(game.title),
}));
export type VaultGame = (typeof vaultGames)[number];

export function gameForSlug(slug: string): VaultGame | undefined {
  return vaultGames.find((game) => game.slug === slug);
}

export const gameMenuEntries = [
  ...vaultGames.map((game) => ({ ...game, href: `/games/${game.slug}`, access: 'Free practice' })),
  {
    id: 'Cyberverse',
    title: 'Cyberverse',
    category: 'Game world',
    marker: 'CV',
    objective: 'Enter the Cyberverse game world.',
    duration: 'Play at your own pace',
    href: '/games/cyberverse',
    access: '5 tokens once; free replays',
  },
];
