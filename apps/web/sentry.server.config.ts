import * as Sentry from '@sentry/nextjs';
import { getEnv } from './src/env';

const dsn = getEnv().SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.2 });
}
