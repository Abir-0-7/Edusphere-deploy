import type { GameAction } from './completion';

export interface GameRewardClient { award(gameId: string, actions: readonly GameAction[]): Promise<{ tokensAwarded: number }>; }

/** Rewards are deliberately delegated to the authenticated server. */
export function createServerRewardClient(fetcher: typeof fetch = fetch): GameRewardClient {
  return { async award(gameId, actions) {
    const response = await fetcher('/api/games/rewards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game_id: gameId, actions }) });
    if (!response.ok) throw new Error(`Reward request failed (${response.status})`);
    const data = (await response.json()) as { tokens_awarded?: unknown };
    if (typeof data.tokens_awarded !== 'number') throw new Error('Invalid reward response');
    return { tokensAwarded: data.tokens_awarded };
  } };
}
