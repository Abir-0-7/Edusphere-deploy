import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { z } from 'zod';
import {
  GameCommandInputSchema,
  GameCreateInputSchema,
  GameSessionListSchema,
  GameSessionSchema,
} from '../src/game-api.ts';

const json = (schema) => z.toJSONSchema(schema, { target: 'openapi-3.0' });
const body = (schema) => ({ required: true, content: { 'application/json': { schema: json(schema) } } });
const response = (schema) => ({
  description: 'Committed owner-scoped game state',
  content: { 'application/json': { schema: json(schema) } },
});
const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
};
const errors = Object.fromEntries(
  [400, 401, 404, 409, 429, 503].map((status) => [
    status,
    {
      description: 'Invalid input, auth, ownership, revision, capacity, or durable-store failure',
      content: { 'application/json': { schema: errorSchema } },
    },
  ]),
);
const security = [{ clerkSession: [] }];
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'StudyVault Game Vault web API',
    version: '1.0.0',
    description:
      'Generated from shared Zod contracts. Run node packages/types/scripts/export-game-openapi.mjs.',
  },
  components: { securitySchemes: { clerkSession: { type: 'apiKey', in: 'cookie', name: '__session' } } },
  paths: {
    '/api/games/sessions': {
      get: { security, responses: { 200: response(GameSessionListSchema), ...errors } },
      post: {
        security,
        description: 'Create a game session only when the owner has no running focus session; otherwise return HTTP 409.',
        requestBody: body(GameCreateInputSchema),
        responses: { 201: response(GameSessionSchema), ...errors },
      },
    },
    '/api/games/sessions/{id}': {
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { security, responses: { 200: response(GameSessionSchema), ...errors } },
      post: {
        security,
        description: 'Apply a saved-game command only when the owner has no running focus session; otherwise return HTTP 409.',
        requestBody: body(GameCommandInputSchema),
        responses: { 200: response(GameSessionSchema), ...errors },
      },
      delete: {
        security,
        description: 'Delete only the owned save; earned token ledger entries and daily cap remain intact.',
        responses: { 204: { description: 'Saved game deleted' }, ...errors },
      },
    },
  },
};
writeFileSync(
  fileURLToPath(new URL('../../../contracts/games.openapi.json', import.meta.url)),
  `${JSON.stringify(spec, null, 2)}\n`,
);
