import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameVaultService } from '../src/lib/game-vault/server';

const url = process.env.STUDYVAULT_TEST_DATABASE_URL;
const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };

/** Applies only the game progress table statements from the committed mission
 * migration inside a random schema. Never falls back to application DATABASE_URL. */
describe.skipIf(!url)('Cyberverse atomic unlock and completion on Postgres', () => {
  let admin: ReturnType<typeof postgres> | undefined;
  let first: ReturnType<typeof postgres> | undefined;
  let second: ReturnType<typeof postgres> | undefined;
  let schema = '';
  let alice = '';
  let bob = '';
  let service: ReturnType<typeof createGameVaultService>;
  let restarted: ReturnType<typeof createGameVaultService>;

  beforeEach(async () => {
    schema = `cyberverse_test_${randomUUID().replaceAll('-', '')}`;
    admin = postgres(url!, { prepare: false, max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const options = { prepare: false, max: 4, connection: { search_path: schema } };
    first = postgres(url!, options);
    second = postgres(url!, options);
    await first.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, clerk_id text NOT NULL UNIQUE);
      CREATE TABLE focus_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status text NOT NULL, expected_end_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE token_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount integer NOT NULL, reason text NOT NULL, ref_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(reason, ref_id)
      );
    `);
    const migration = await readFile(
      new URL('../../../packages/db/drizzle/0007_game_vault_missions.sql', import.meta.url),
      'utf8',
    );
    const statements = migration
      .split('--> statement-breakpoint')
      .filter((statement) => statement.includes('game_mission_progress'));
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      await first.unsafe(statement.replaceAll('"public"."users"', `"${schema}"."users"`));
    }
    alice = randomUUID();
    bob = randomUUID();
    await first`INSERT INTO users (id, clerk_id) VALUES (${alice}, 'cyber-alice'), (${bob}, 'cyber-bob')`;
    await first`INSERT INTO token_ledger (user_id, amount, reason, ref_id) VALUES
      (${alice}, 5, 'earned:alice', ${alice}), (${bob}, 4, 'earned:bob', ${bob})`;
    service = createGameVaultService(drizzle(first));
    restarted = createGameVaultService(drizzle(second));
  });

  afterEach(async () => {
    if (first) await first.end({ timeout: 5 });
    if (second) await second.end({ timeout: 5 });
    if (admin) {
      if (/^cyberverse_test_[a-f0-9]{32}$/.test(schema)) await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end({ timeout: 5 });
    }
  });

  it('locks spending and completion during focus and restores access when focus ends', async () => {
    await first!`INSERT INTO focus_sessions(user_id,status) VALUES (${bob},'running')`;
    expect((await service.unlockMission('cyber-alice', 'binary_city')).state?.tokens).toBe(0);
    await first!`INSERT INTO focus_sessions(user_id,status,expected_end_at) VALUES (${alice},'running',now()-interval '1 minute')`;
    expect(await service.unlockMission('cyber-alice', 'binary_city')).toEqual({ error: 'focus_active' });
    expect(await restarted.completeMission('cyber-alice', 'binary_city', evidence)).toEqual({
      error: 'focus_active',
    });
    expect((await service.contextFor('cyber-alice'))?.xp).toBe(0);
    await first!`UPDATE focus_sessions SET status='completed' WHERE user_id=${alice}`;
    expect((await restarted.completeMission('cyber-alice', 'binary_city', evidence)).state?.xp).toBe(100);
  });

  it('charges once under concurrent requests, preserves unlock on restart and awards XP only once', async () => {
    const unlocks = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? service : restarted).unlockMission('cyber-alice', 'binary_city'),
      ),
    );
    expect(
      unlocks.every((result) => result.state?.tokens === 0 && result.state.unlocked.includes('binary_city')),
    ).toBe(true);
    const debits = await first!<
      { amount: number }[]
    >`SELECT amount FROM token_ledger WHERE user_id = ${alice} AND amount < 0`;
    expect(debits.map((row) => row.amount)).toEqual([-5]);
    const completions = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? service : restarted).completeMission('cyber-alice', 'binary_city', evidence),
      ),
    );
    expect(
      completions.every(
        (result) =>
          result.state?.xp === 100 &&
          result.state.tokens === 0 &&
          result.state.completed.includes('binary_city'),
      ),
    ).toBe(true);
    expect((await restarted.unlockMission('cyber-alice', 'binary_city')).state?.xp).toBe(100);
    const [stored] = await first!<{ count: number; xp: number }[]>`
      SELECT count(*)::int AS count, sum(xp_awarded)::int AS xp FROM game_mission_progress WHERE user_id = ${alice}`;
    expect(stored).toEqual({ count: 1, xp: 100 });
    const ledger = await first!<
      { amount: number }[]
    >`SELECT amount FROM token_ledger WHERE user_id = ${alice} ORDER BY amount`;
    expect(ledger.map((row) => row.amount)).toEqual([-5, 5]);
  });

  it('preserves deployment-era Binary City progress and replays after the new migration', async () => {
    const [existing] = await first!<{ id: string }[]>`
      INSERT INTO game_mission_progress
        (user_id, game_id, mission_id, completed_at, xp_awarded, achievements)
      VALUES (${alice}, 'cyberverse', 'binary_city', now(), 100, '["first_transmission"]')
      RETURNING id
    `;
    if (!existing) throw new Error('Could not create existing mission progress fixture');
    await first!`
      INSERT INTO token_ledger (user_id, amount, reason, ref_id)
      VALUES (${alice}, -5, 'game_unlock:cyberverse:binary_city', ${existing.id})
    `;
    await first!.unsafe(
      'CREATE TABLE flashcards (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE)',
    );
    const migration = await readFile(
      new URL('../../../packages/db/drizzle/0008_game_vault_sessions.sql', import.meta.url),
      'utf8',
    );
    await first!.unsafe(migration.replaceAll('"public"."users"', `"${schema}"."users"`));

    const replay = await restarted.unlockMission('cyber-alice', 'binary_city');
    expect(replay.state).toMatchObject({
      tokens: 0,
      xp: 100,
      unlocked: ['binary_city'],
      completed: ['binary_city'],
    });
    const debits = await second!<{ ref_id: string }[]>`
      SELECT ref_id FROM token_ledger WHERE user_id = ${alice} AND amount < 0
    `;
    expect(debits).toEqual([{ ref_id: existing.id }]);
  });

  it('does not charge previews/poor owners; invalid, locked, and foreign completions never award XP', async () => {
    expect(await service.unlockMission('cyber-bob', 'binary_city')).toEqual({ error: 'insufficient_tokens' });
    for (const id of [
      'code_district',
      'network_nexus',
      'firewall_fortress',
      'algorithm_arena',
      'malware_core',
    ]) {
      expect(await service.unlockMission('cyber-alice', id)).toEqual({ error: 'mission_not_playable' });
      expect(await service.completeMission('cyber-alice', id, evidence)).toEqual({
        error: 'mission_not_playable',
      });
    }
    expect(await service.completeMission('cyber-alice', 'binary_city', evidence)).toEqual({
      error: 'mission_locked',
    });
    await service.unlockMission('cyber-alice', 'binary_city');
    expect(await service.completeMission('cyber-bob', 'binary_city', evidence)).toEqual({
      error: 'mission_locked',
    });
    expect(
      await service.completeMission('cyber-alice', 'binary_city', {
        ...evidence,
        answers: [1, 2, 0, 3, 2, 1],
      }),
    ).toEqual({ error: 'completion_rejected' });
    expect((await service.contextFor('cyber-alice'))?.xp).toBe(0);
    expect((await service.contextFor('cyber-bob'))?.tokens).toBe(4);
    const [bobDebits] = await first!<{ count: number }[]>`
      SELECT count(*)::int AS count FROM token_ledger WHERE user_id = ${bob} AND amount < 0`;
    expect(bobDebits?.count).toBe(0);
  });

  it('rolls entitlement back with a failed debit and account deletion removes progress and ledger', async () => {
    await first!.unsafe(`
      CREATE FUNCTION reject_cyber_debit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.amount < 0 THEN RAISE EXCEPTION 'injected ledger failure'; END IF; RETURN NEW; END;
      $$;
      CREATE TRIGGER reject_cyber_debit BEFORE INSERT ON token_ledger FOR EACH ROW EXECUTE FUNCTION reject_cyber_debit();
    `);
    // postgres-js wraps a trigger error with the full failed statement. Assert
    // rejection; API handlers intentionally replace it with a generic 503.
    await expect(service.unlockMission('cyber-alice', 'binary_city')).rejects.toThrow();
    expect((await service.contextFor('cyber-alice'))?.unlocked).toEqual([]);
    expect((await service.contextFor('cyber-alice'))?.tokens).toBe(5);
    await first!.unsafe('DROP TRIGGER reject_cyber_debit ON token_ledger');
    await service.unlockMission('cyber-alice', 'binary_city');
    await first!`DELETE FROM users WHERE id = ${alice}`;
    expect(await restarted.contextFor('cyber-alice')).toBeNull();
    expect(await restarted.unlockMission('cyber-alice', 'binary_city')).toEqual({ error: 'not_found' });
    const [progress] = await first!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM game_mission_progress`;
    const [ledger] = await first!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM token_ledger WHERE user_id = ${alice}`;
    expect(progress?.count).toBe(0);
    expect(ledger?.count).toBe(0);
  });
});
