import { notFound } from 'next/navigation';
import { GameVaultPlayer } from '@/components/game-vault-player';
import { getVaultGame } from '@/lib/game-vault/catalog';
import { headers } from 'next/headers';
import { isLocalDemoPage } from '@/lib/local-demo';

export default async function GamePlayerPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = getVaultGame(gameId);
  if (!game) notFound();
  return (
    <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
      <GameVaultPlayer game={game} localDemo={isLocalDemoPage(await headers())} />
    </main>
  );
}
