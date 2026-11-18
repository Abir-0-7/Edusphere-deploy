import { createRoot } from 'react-dom/client';
import { GameVault } from '../../../src/components/game-vault';
import { GamesMenu } from '../../../src/components/games-menu';
import { GamesNavigation } from '../../../src/components/games-navigation';
import { gameForSlug } from '../../../src/lib/game-catalog';
import { CyberversePlayer } from '../../../src/components/cyberverse-player';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing Game Vault fixture root');
const match = /^\/games\/([^/]+)$/.exec(window.location.pathname);
const game = match?.[1] ? gameForSlug(match[1]) : undefined;
const isCyberverse = match?.[1] === 'cyberverse';
createRoot(host).render(
  <>
    <header className="flex justify-end border-b p-4">
      <GamesNavigation />
    </header>
    {isCyberverse ? <CyberversePlayer /> : game ? <GameVault game={game} /> : <GamesMenu />}
  </>,
);
