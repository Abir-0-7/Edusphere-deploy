import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FlashcardResponse } from '@studyvault/types';
import { FlashcardViewer } from '../../../src/components/flashcard-viewer';
import { loadFlashcardDeck, type FlashcardDeckLoad } from '../../../src/lib/offline-deck-client';
import { cacheFlashcardDeck } from '../../../src/lib/offline-reviews';

const ownerId = 'offline-fixture-owner';
const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deckId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cards: FlashcardResponse[] = [{
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  document_id: documentId,
  front: 'What survives an offline network failure?',
  back: 'The previously cached deck remains available for casual study.',
  ease_factor: 2.5,
  interval_days: 0,
  repetitions: 0,
  due_date: '2026-11-19',
}];

function OfflineDeckFixture() {
  const [loaded, setLoaded] = useState<FlashcardDeckLoad | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void cacheFlashcardDeck(ownerId, documentId, deckId, cards)
      .then(() => loadFlashcardDeck(async () => 'fixture-token', ownerId, documentId, deckId))
      .then((result) => { if (active) setLoaded(result); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Could not load deck.'); });
    return () => { active = false; };
  }, []);
  return (
    <main>
      <h1>Offline flashcard acceptance</h1>
      {error && <p role="alert">{error}</p>}
      {loaded?.source === 'offline' && (
        <p role="status">Offline copy · cached {new Date(loaded.cachedAt ?? 0).toLocaleString()}</p>
      )}
      {(loaded?.cards.length ?? 0) > 0 && !viewerOpen && (
        <button type="button" onClick={() => setViewerOpen(true)}>Study {loaded?.cards.length} cards</button>
      )}
      {viewerOpen && loaded && (
        <FlashcardViewer
          cards={loaded.cards}
          documentId={documentId}
          deckId={loaded.deckId}
          userId={ownerId}
          getToken={async () => 'fixture-token'}
        />
      )}
    </main>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing offline deck fixture root');
createRoot(host).render(<OfflineDeckFixture />);
