import { notFound, redirect } from 'next/navigation';
import { GameVault } from '@/components/game-vault';
import { gameForSlug } from '@/lib/game-catalog';

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId: slug } = await params;
  if (slug === 'logic-arcade') redirect('/games');
  const game = gameForSlug(slug);
  if (!game) notFound();

  return <GameVault game={game} />;
}
