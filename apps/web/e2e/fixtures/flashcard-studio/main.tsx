import { createRoot } from 'react-dom/client';
import { FlashcardStudio } from '../../../src/components/flashcard-studio';
import { FlashcardEditor } from '../../../src/components/flashcard-editor';
import { FlashcardViewer } from '../../../src/components/flashcard-viewer';

const host = document.getElementById('root');
if (!host) throw new Error('Missing Flashcard Studio fixture root');
const selectedDeck = document.createElement('p');
selectedDeck.dataset.testid = 'selected-deck';
document.body.append(selectedDeck);
const savedDeck = document.createElement('p');
savedDeck.dataset.testid = 'saved-deck';
document.body.append(savedDeck);
const viewerCards = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    front: 'What did the first source say?',
    back: 'The first source fact.',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    due_date: '2026-11-19',
    document_id: '99999999-9999-4999-8999-999999999999',
    chapter_id: '11111111-1111-4111-8111-111111111111',
    source_chunk_id: '55555555-5555-4555-8555-555555555555',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    front: 'What did the second source say?',
    back: 'The second source fact.',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    due_date: '2026-11-19',
    document_id: '99999999-9999-4999-8999-999999999999',
    chapter_id: '22222222-2222-4222-8222-222222222222',
    source_chunk_id: '77777777-7777-4777-8777-777777777777',
  },
];

createRoot(host).render(
  <main className="mx-auto max-w-2xl p-4">
    <h1 className="text-2xl font-bold">Flashcard Studio test fixture</h1>
    <FlashcardStudio
      documentId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      chapters={[
        { id: '11111111-1111-4111-8111-111111111111', title: 'Chapter one', ordinal: 0, start_page: 1, end_page: 2 },
        { id: '22222222-2222-4222-8222-222222222222', title: 'Chapter two', ordinal: 1, start_page: 3, end_page: 4 },
      ]}
      getToken={async () => 'fixture-token'}
      selectedDeckId={null}
      existingCards={viewerCards}
      onDeckSelected={(deckId) => { selectedDeck.textContent = deckId ?? 'all'; }}
      onSaved={async (deckId) => {
        savedDeck.textContent = deckId;
        selectedDeck.textContent = deckId;
      }}
    />
    <section aria-label="Saved card actions">
      <h2>Saved card editor fixture</h2>
      <FlashcardEditor
        card={viewerCards[0]!}
        getToken={async () => 'fixture-token'}
        onChanged={() => undefined}
      />
    </section>
    <FlashcardViewer
      cards={viewerCards}
      documentId="99999999-9999-4999-8999-999999999999"
      deckId="88888888-8888-4888-8888-888888888888"
      userId="viewer-owner"
      getToken={async () => 'fixture-token'}
    />
  </main>,
);
