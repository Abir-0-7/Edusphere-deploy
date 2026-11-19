import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAllowedLearningRoute } from '@/lib/learning-service-proxy';
import { getEnv } from '@/env';
import { errorBody } from '@/lib/errors';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxyLearningRequest(request: Request, context: RouteContext): Promise<Response> {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json(errorBody('unauthorized', 'sign in required'), { status: 401 });

  const { path } = await context.params;
  const upstreamPath = `/${path.map((segment) => encodeURIComponent(segment)).join('/')}`;
  if (!isAllowedLearningRoute(request.method, upstreamPath)) {
    return NextResponse.json(errorBody('not_found', 'learning endpoint not found'), { status: 404 });
  }

  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return NextResponse.json(errorBody('internal', 'learning service is not configured'), { status: 503 });
  }

  const token = await getToken();
  if (!token) return NextResponse.json(errorBody('unauthorized', 'sign in to continue'), { status: 401 });

  const upstreamUrl = new URL(`${env.AI_SERVICE_URL.replace(/\/$/, '')}${upstreamPath}`);
  upstreamUrl.search = new URL(request.url).search;
  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get('content-type');
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (contentType) headers.set('content-type', contentType);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  if (env.AI_SERVICE_INTERNAL_TOKEN) headers.set('x-internal-token', env.AI_SERVICE_INTERNAL_TOKEN);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return NextResponse.json(errorBody('internal', 'learning service is temporarily unavailable'), {
      status: 502,
    });
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of ['content-type', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxyLearningRequest;
export const POST = proxyLearningRequest;
export const PUT = proxyLearningRequest;
export const DELETE = proxyLearningRequest;
