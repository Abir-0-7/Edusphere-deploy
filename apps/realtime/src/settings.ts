import { z } from 'zod';

const SettingsSchema = z.object({
  REALTIME_EVENT_LIMIT_PER_MINUTE: z.coerce.number().int().min(5).max(600).default(120),
  REALTIME_EVENT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(2048).max(65536).default(16384),
  REALTIME_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).max(10).default(3),
  REALTIME_MAX_IN_FLIGHT_PER_USER: z.coerce.number().int().min(1).max(8).default(2),
  REALTIME_QUESTION_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  REALTIME_MAX_QUEUE: z.coerce.number().int().min(2).max(1000).default(100),
  REALTIME_MAX_DUELS_PER_USER: z.coerce.number().int().min(1).max(100).default(20),
});

export function realtimeSettings(env: NodeJS.ProcessEnv = process.env) {
  return SettingsSchema.parse(env);
}

export type RealtimeSettings = ReturnType<typeof realtimeSettings>;
