import { auth } from '@clerk/nextjs/server';
import { and, count, eq } from 'drizzle-orm';
import { studyGuildMembers, studyGuilds } from '@studyvault/db';
import { NextResponse } from 'next/server';
import { GuildCreateSchema as GuildCreateInput, GuildGoalSchema as GuildGoalInput, GuildJoinSchema as GuildJoinInput, GuildSchema } from '@studyvault/types';
import { errorBody } from '@/lib/errors';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';

async function currentUser() {
  const { userId } = await auth();
  return userId ? getUserByClerkId(userId) : null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  const rows = await getDb().select({ guild: studyGuilds, memberCount: count(studyGuildMembers.id) })
    .from(studyGuildMembers).innerJoin(studyGuilds, eq(studyGuildMembers.guildId, studyGuilds.id))
    .where(eq(studyGuildMembers.userId, user.id)).groupBy(studyGuilds.id);
  return NextResponse.json(rows.map(({ guild, memberCount }) => GuildSchema.parse({
    id: guild.id, name: guild.name, inviteCode: guild.inviteCode, weeklyGoalMinutes: guild.weeklyGoalMinutes,
    memberCount, weeklyMultiplier: Math.min(1.25, 1 + Math.max(0, memberCount - 1) * 0.05),
  })));
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const join = GuildJoinInput.safeParse(body);
  const create = GuildCreateInput.safeParse(body);
  const db = getDb();
  if (join.success) {
    const [guild] = await db.select().from(studyGuilds).where(eq(studyGuilds.inviteCode, join.data.inviteCode)).limit(1);
    if (!guild) return NextResponse.json(errorBody('guild not found', 'not_found'), { status: 404 });
    await db.insert(studyGuildMembers).values({ guildId: guild.id, userId: user.id }).onConflictDoNothing();
    return NextResponse.json({ joined: true, guildId: guild.id });
  }
  if (!create.success) return NextResponse.json(errorBody('invalid guild request', 'invalid_input'), { status: 400 });
  const inviteCode = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const [guild] = await db.insert(studyGuilds).values({ ownerUserId: user.id, ...create.data, inviteCode }).returning();
  if (!guild) return NextResponse.json(errorBody('guild creation failed', 'internal'), { status: 500 });
  await db.insert(studyGuildMembers).values({ guildId: guild.id, userId: user.id });
  return NextResponse.json({ id: guild.id, name: guild.name, inviteCode, weeklyGoalMinutes: guild.weeklyGoalMinutes, memberCount: 1, weeklyMultiplier: 1 }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('guildId' in body) || typeof body.guildId !== 'string' || !('weeklyGoalMinutes' in body))
    return NextResponse.json(errorBody('invalid guild goal', 'invalid_input'), { status: 400 });
  const parsed = GuildGoalInput.safeParse({ weeklyGoalMinutes: body.weeklyGoalMinutes });
  if (!parsed.success) return NextResponse.json(errorBody('invalid weekly goal', 'invalid_input'), { status: 400 });
  const [membership] = await getDb().select({ id: studyGuildMembers.id }).from(studyGuildMembers)
    .where(and(eq(studyGuildMembers.guildId, body.guildId), eq(studyGuildMembers.userId, user.id))).limit(1);
  if (!membership) return NextResponse.json(errorBody('guild not found', 'not_found'), { status: 404 });
  const [guild] = await getDb().update(studyGuilds).set({ weeklyGoalMinutes: parsed.data.weeklyGoalMinutes, updatedAt: new Date() })
    .where(eq(studyGuilds.id, body.guildId)).returning();
  return NextResponse.json({ id: guild?.id, weeklyGoalMinutes: guild?.weeklyGoalMinutes });
}
