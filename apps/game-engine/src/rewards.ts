import type { GameAction } from './completion';
import { GameCompletionRequestSchema, GameRewardResponseSchema } from '@studyvault/types';

export interface GameRewardClient {
  award(gameId: string, actions: readonly GameAction[]): Promise<{ tokensAwarded: number }>;
}

/** Rewards are deliberately delegated to the authenticated server. */
export function createServerRewardClient(fetcher: typeof fetch = fetch): GameRewardClient {
  return {
    async award(gameId, actions) {
      const body = GameCompletionRequestSchema.parse({ game_id: gameId, actions });
      const response = await fetcher('/api/games/rewards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Reward request failed (${response.status})`);
      const data = GameRewardResponseSchema.parse(await response.json());
      return { tokensAwarded: data.tokens_awarded };
    },
  };
}
