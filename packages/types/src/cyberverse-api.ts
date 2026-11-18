import { z } from 'zod';

export const CYBERVERSE_GAME_ID = 'cyberverse' as const;
export const CYBERVERSE_BINARY_CITY_COST = 5;
export const CYBERVERSE_BINARY_CITY_XP = 100;
export const CyberverseMissionSchema = z.enum([
  'binary_city',
  'code_district',
  'network_nexus',
  'firewall_fortress',
  'algorithm_arena',
  'malware_core',
]);
export type CyberverseMissionId = z.infer<typeof CyberverseMissionSchema>;
export const CyberverseEvidenceSchema = z
  .object({
    challengeVersion: z.literal('binary-v1'),
    answers: z.array(z.number().int().min(0).max(3)).length(6),
  })
  .strict();
export const CyberverseStateSchema = z
  .object({
    mode: z.literal('production'),
    student: z.object({ id: z.string().min(1).max(128), displayName: z.string().min(1).max(100) }).strict(),
    tokens: z.number().int().nonnegative(),
    xp: z.number().int().nonnegative(),
    unlocked: z.array(CyberverseMissionSchema).max(6),
    completed: z.array(CyberverseMissionSchema).max(6),
    achievements: z.array(z.string().min(1).max(100)).max(20),
  })
  .strict();
export type CyberverseState = z.infer<typeof CyberverseStateSchema>;
export const CyberverseResponseSchema = z
  .object({ ok: z.literal(true), state: CyberverseStateSchema })
  .strict();
export const CyberverseUnlockInputSchema = z
  .object({
    gameId: z.literal(CYBERVERSE_GAME_ID),
    missionId: CyberverseMissionSchema,
    requestId: z.string().min(1).max(128),
  })
  .strict();
export const CyberverseProgressInputSchema = CyberverseUnlockInputSchema.extend({
  evidence: CyberverseEvidenceSchema,
});
