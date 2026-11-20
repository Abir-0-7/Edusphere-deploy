import { createRoot } from 'react-dom/client';
import { GameVault } from '../../../src/components/game-vault';
import { GamesMenu } from '../../../src/components/games-menu';
import { GamesNavigation } from '../../../src/components/games-navigation';
import { GameVaultLink } from '../../../src/components/game-vault-link';
import { gameForSlug } from '../../../src/lib/game-catalog';
import { CyberversePlayer } from '../../../src/components/cyberverse-player';
import { FocusSessionProvider } from '../../../src/components/focus-session-provider';
import { ActiveFocusTimer, FocusTimer } from '../../../src/components/focus-timer';
import GamesLayout from '../../../src/app/(protected)/games/layout';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing Game Vault fixture root');
const match = /^\/games\/([^/]+)$/.exec(window.location.pathname);
const game = match?.[1] ? gameForSlug(match[1]) : undefined;
const isCyberverse = match?.[1] === 'cyberverse';
createRoot(host).render(
  <FocusSessionProvider>
    <header className="flex items-center justify-between border-b p-4">
      <GameVaultLink className="text-sm" lockedLabel>
        Game vault
      </GameVaultLink>
      <GamesNavigation />
    </header>
    <ActiveFocusTimer />
    <section aria-label="Fixture focus controls" className="mx-auto max-w-4xl p-4">
      <FocusTimer compact />
    </section>
    <GamesLayout>
      {isCyberverse ? <CyberversePlayer /> : game ? <GameVault game={game} /> : <GamesMenu />}
    </GamesLayout>
  </FocusSessionProvider>,
);
