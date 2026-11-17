import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { contextFor } from '@/lib/game-vault/server';
import { isLocalDemoRequest } from '@/lib/local-demo';

export async function GET(request: Request) {
  if (isLocalDemoRequest(request)) {
    return NextResponse.json(
      { ok: false, error: 'local_demo_mode', mode: 'demo' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (new URL(request.url).searchParams.get('gameId') !== 'cyberverse') {
    return NextResponse.json({ ok: false, error: 'game_not_found' }, { status: 404 });
  }
  try {
    const state = await contextFor(userId);
    return state
      ? NextResponse.json({ ok: true, state }, { headers: { 'Cache-Control': 'no-store' } })
      : NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  } catch {
    return NextResponse.json({ ok: false, error: 'service_unavailable' }, { status: 503 });
  }
}
