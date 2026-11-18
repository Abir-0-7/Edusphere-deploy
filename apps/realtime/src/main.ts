import { closeDuelCardSource, createRealtimeServer, loadUserDuelCards } from './server.js';

const server = createRealtimeServer({ loadDuelCards: loadUserDuelCards });
server.httpServer.listen(server.port, () => console.warn(`realtime listening on ${server.port}`));

const stop = () => {
  void Promise.all([server.close(), closeDuelCardSource()]).catch((error: unknown) => {
    console.error('Realtime shutdown failed', {
      reason: error instanceof Error ? error.name : 'UnknownError',
    });
    process.exitCode = 1;
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
