import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  MAX_STUDIO_CARDS,
  MAX_STUDIO_CHAPTERS,
  MAX_STUDIO_DECK_NAME_LENGTH,
  MAX_STUDIO_TOPIC_LENGTH,
  StudioDifficultySchema,
  StudioGenerationSettingsSchema,
  StudioLanguageSchema,
  type ChapterResponse,
  type FlashcardResponse,
  type StudioDeck,
  type StudioDraft,
  type StudioGenerationSettings,
} from '@studyvault/types';
import { pollJob, type GetToken } from '@/lib/ai-client';
import {
  getStudioDraft,
  listStudioDecks,
  mergeStudioDraft,
  startStudioDraft,
} from '@/lib/flashcard-studio-client';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { FlashcardQuiz } from '@/components/flashcard-quiz';

type Props = {
  documentId: string;
  chapters: ChapterResponse[];
  preferredChapterId?: string;
  getToken: GetToken;
  selectedDeckId: string | null;
  existingCards: FlashcardResponse[];
  onDeckSelected: (deckId: string | null) => void;
  onSaved: (deckId: string) => Promise<void>;
};

const languages = { en: 'English', bn: 'বাংলা (Bangla)' };
const difficulties = { basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced' };
const field = 'block w-full rounded border border-neutral-400 px-2.5 py-1.5 text-sm';
const button =
  'rounded border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-800 disabled:opacity-50';
const primary =
  'rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50';
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function FlashcardStudio({
  documentId,
  chapters,
  preferredChapterId,
  getToken,
  selectedDeckId,
  onDeckSelected,
  onSaved,
  existingCards,
}: Props) {
  const id = useId();
  const [chapterIds, setChapterIds] = useState<string[] | null>(null);
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState<StudioGenerationSettings['language']>('en');
  const [difficulty, setDifficulty] = useState<StudioGenerationSettings['difficulty']>('basic');
  const [count, setCount] = useState('5');
  const [settings, setSettings] = useState<StudioGenerationSettings | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [regenerationTargetIds, setRegenerationTargetIds] = useState<string[]>([]);
  const [targetDeck, setTargetDeck] = useState('');
  const [replacementTargets, setReplacementTargets] = useState<Record<string, string>>({});
  const [deckName, setDeckName] = useState('');
  const [decks, setDecks] = useState<StudioDeck[]>([]);
  const [decksError, setDecksError] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const active = useRef<AbortController | null>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  const jobIds = useRef<{ job_id: string; draft_id: string } | null>(null);
  const deckFilterInitialized = useRef(false);
  const selectedDeckRef = useRef(selectedDeckId);
  const canUseSource = chapters.length > 0;
  const defaultChapter = chapters.find((chapter) => chapter.id === preferredChapterId) ?? chapters[0];
  const selectedChapters = (chapterIds ?? (defaultChapter ? [defaultChapter.id] : [])).filter((chapterId) =>
    chapters.some((chapter) => chapter.id === chapterId),
  );
  const regenerableCards = (targetDeck && targetDeck !== '__new__' ? existingCards : []).filter(
    (card) =>
      card.status !== 'retired' &&
      card.chapter_id != null &&
      chapters.some((chapter) => chapter.id === card.chapter_id),
  );
  const regenerationTargets = regenerableCards.filter((card) => regenerationTargetIds.includes(card.id));
  const regenerationChapterIds = [
    ...new Set(regenerationTargets.flatMap((card) => (card.chapter_id ? [card.chapter_id] : []))),
  ];
  const usingSelectedRegeneration = regenerationTargets.length > 0;

  const loadDecks = useCallback(
    async (signal: AbortSignal) => {
      try {
        const response = await listStudioDecks(getToken, documentId, signal);
        if (!signal.aborted) {
          setDecks(response);
          setDecksError('');
          if (!deckFilterInitialized.current) {
            const defaultDeck = response.find((deck) => deck.is_default);
            if (defaultDeck && selectedDeckRef.current === null) {
              deckFilterInitialized.current = true;
              setTargetDeck(defaultDeck.id);
              selectedDeckRef.current = defaultDeck.id;
              onDeckSelected(defaultDeck.id);
            }
          }
        }
      } catch (err) {
        if (!signal.aborted) setDecksError(errorMessage(err, 'Saved decks could not be loaded.'));
      }
    },
    [documentId, getToken, onDeckSelected],
  );

  useEffect(() => {
    if (!canUseSource) return;
    const controller = new AbortController();
    void loadDecks(controller.signal);
    return () => controller.abort();
  }, [canUseSource, loadDecks]);

  useEffect(
    () => () => {
      active.current?.abort();
      stopPoll.current?.();
    },
    [],
  );

  useEffect(() => {
    selectedDeckRef.current = selectedDeckId;
    if (selectedDeckId !== null && selectedDeckId !== '__new__') {
      setTargetDeck(selectedDeckId);
    }
  }, [selectedDeckId]);

  function reviewSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatus('');
    const result = StudioGenerationSettingsSchema.safeParse({
      chapter_ids: usingSelectedRegeneration ? regenerationChapterIds : selectedChapters,
      ...(topic.trim() ? { topic } : {}),
      language,
      difficulty,
      count: usingSelectedRegeneration ? regenerationTargets.length : Number(count),
    });
    if (!result.success) {
      setError(`Select 1–${MAX_STUDIO_CHAPTERS} chapters and request 1–${MAX_STUDIO_CARDS} cards.`);
      return;
    }
    setSettings(result.data);
  }

  function watchGeneration(ids: NonNullable<typeof jobIds.current>, controller: AbortController) {
    const { signal } = controller;
    const finish = (message: string, allowRetry = false) => {
      if (signal.aborted) return;
      active.current = null;
      setStatus('');
      setError(message);
      setPaused(allowRetry);
      setBusy(false);
    };
    const loadDraft = async () => {
      try {
        const generated = await getStudioDraft(getToken, documentId, ids.draft_id, signal);
        if (signal.aborted) return;
        active.current = null;
        setDraft(generated);
        setSelectedCards(generated.cards.map((card) => card.id));
        setStatus('Draft ready. Choose the cards you want to save.');
        setBusy(false);
      } catch (err) {
        finish(errorMessage(err, 'The draft could not be loaded.'), true);
      }
    };
    stopPoll.current = pollJob(
      getToken,
      ids.job_id,
      (job) => {
        if (signal.aborted) return;
        switch (job.status) {
          case 'pending':
            setStatus(
              job.error_reason
                ? `Draft waiting to retry: ${job.error_reason}. Your saved cards are still available.`
                : job.attempts > 0
                  ? `Draft waiting to retry after attempt ${job.attempts}. Your saved cards are still available.`
                  : 'Draft queued, waiting for a worker. Your saved cards are still available.',
            );
            break;
          case 'running':
            setStatus('Generating a draft from the selected chapters…');
            break;
          case 'done':
            void loadDraft();
            break;
          case 'failed':
            finish(job.error_reason ?? 'Generation failed.');
            break;
          case 'cancelled':
            finish('Generation was cancelled.');
            break;
        }
      },
      1500,
      180_000,
      (error) =>
        finish(`${error.message}. Generation may still be running. Check again to reopen the draft.`, true),
    );
  }

  async function startGeneration() {
    if (!settings || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPaused(false);
    setError('');
    setStatus('Starting draft…');
    try {
      const ids = await startStudioDraft(getToken, documentId, settings, controller.signal);
      if (controller.signal.aborted) return;
      jobIds.current = ids;
      watchGeneration(ids, controller);
    } catch (err) {
      if (controller.signal.aborted) return;
      active.current = null;
      setBusy(false);
      setStatus('');
      setError(errorMessage(err, 'Generation could not start.'));
    }
  }

  function checkGeneration() {
    if (active.current || !jobIds.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPaused(false);
    setError('');
    setStatus('Checking the current draft…');
    watchGeneration(jobIds.current, controller);
  }

  function resetPreview() {
    jobIds.current = null;
    setDraft(null);
    setSettings(null);
    setError('');
    setStatus('');
    setPaused(false);
  }

  async function saveSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || selectedCards.length === 0 || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setStatus('Saving the selected flashcards…');
    try {
      const chosenDeck = decks.find((deck) => deck.id === targetDeck);
      const replacements = selectedCards.flatMap((draftCardId) => {
        const cardId = replacementTargets[draftCardId];
        return cardId ? [{ draft_card_id: draftCardId, card_id: cardId }] : [];
      });
      const result = await mergeStudioDraft(
        getToken,
        documentId,
        draft.id,
        {
          card_ids: selectedCards,
          replacements,
          ...(replacements.length === 0
            ? targetDeck === '__new__' && deckName.trim()
              ? { deck_name: deckName }
              : chosenDeck && !chosenDeck.is_default
                ? { deck_name: chosenDeck.name }
                : {}
            : {}),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setDraft({ ...draft, merge_result: result });
      setTargetDeck(result.deck_id);
      deckFilterInitialized.current = true;
      setStatus(
        result.added_count === 0
          ? result.updated_count > 0
            ? `Updated ${result.updated_count} selected card(s). Card IDs, decks, and review history were preserved; schedules are flagged for deliberate review.`
            : 'The deck already contains these cards.'
          : `Added ${result.added_count} and updated ${result.updated_count} card(s). Replaced cards keep their IDs, decks, and review history, and are flagged for deliberate review.`,
      );
      try {
        await Promise.all([loadDecks(controller.signal), onSaved(result.deck_id)]);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            `Cards were saved, but the list could not refresh. ${errorMessage(err, 'Reload to see the updated list.')}`,
          );
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus('');
      setError(errorMessage(err, 'The selected cards could not be saved.'));
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  if (!canUseSource)
    return (
      <p className="mt-2 text-sm text-neutral-700">Chapters must be ready before you can draft cards.</p>
    );

  return (
    <div className="mt-3 space-y-3 rounded border border-neutral-300 p-4">
      {!settings && (
        <form onSubmit={reviewSettings} className="space-y-3">
          <fieldset>
            <legend className="text-sm font-semibold">Regenerate selected saved cards (optional)</legend>
            <p className="mt-1 text-xs text-neutral-700" id={`${id}-regenerate-help`}>
              Select a saved deck first, then choose active cards with source chapters. The draft will use
              those chapters and match the number selected; replacement is explicit when you map a candidate
              below.
            </p>
            {regenerableCards.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-600">
                No active saved cards with an available source chapter.
              </p>
            ) : (
              <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {regenerableCards.map((card) => {
                  const checked = regenerationTargetIds.includes(card.id);
                  const nextChapterCount = new Set([...regenerationChapterIds, card.chapter_id]).size;
                  return (
                    <label key={card.id} className="flex items-start gap-2 px-1 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0"
                        checked={checked}
                        disabled={
                          !checked &&
                          (regenerationTargets.length >= MAX_STUDIO_CARDS ||
                            nextChapterCount > MAX_STUDIO_CHAPTERS)
                        }
                        aria-describedby={`${id}-regenerate-help`}
                        onChange={(event) =>
                          setRegenerationTargetIds((previous) =>
                            event.target.checked
                              ? [...previous, card.id]
                              : previous.filter((cardId) => cardId !== card.id),
                          )
                        }
                      />
                      <span className="min-w-0 truncate">{card.front}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {usingSelectedRegeneration && (
              <p className="mt-1 text-xs font-medium text-blue-800">
                {regenerationTargets.length} target(s) selected across {regenerationChapterIds.length} source
                chapter(s).
              </p>
            )}
          </fieldset>
          {!usingSelectedRegeneration && (
            <fieldset>
              <legend className="text-sm font-semibold">Chapters from this source</legend>
              <p className="mt-1 text-xs text-neutral-700" id={`${id}-chapter-help`}>
                {selectedChapters.length} selected · up to {MAX_STUDIO_CHAPTERS} chapters
              </p>
              <div className="mt-1 max-h-44 space-y-0.5 overflow-y-auto">
                {chapters.map((chapter) => {
                  const checked = selectedChapters.includes(chapter.id);
                  return (
                    <label key={chapter.id} className="flex items-start gap-2 px-1 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0"
                        checked={checked}
                        disabled={!checked && selectedChapters.length >= MAX_STUDIO_CHAPTERS}
                        aria-describedby={`${id}-chapter-help`}
                        onChange={(event) =>
                          setChapterIds(
                            event.target.checked
                              ? [...selectedChapters, chapter.id]
                              : selectedChapters.filter((chapterId) => chapterId !== chapter.id),
                          )
                        }
                      />
                      <span>{chapter.title}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <label className="block text-sm font-medium">
            Topic (optional)
            <input
              className={field}
              value={topic}
              maxLength={MAX_STUDIO_TOPIC_LENGTH}
              onChange={(event) => setTopic(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Language
              <select
                className={field}
                value={language}
                onChange={(event) => setLanguage(StudioLanguageSchema.parse(event.target.value))}
              >
                {StudioLanguageSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {languages[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Difficulty
              <select
                className={field}
                value={difficulty}
                onChange={(event) => setDifficulty(StudioDifficultySchema.parse(event.target.value))}
              >
                {StudioDifficultySchema.options.map((value) => (
                  <option key={value} value={value}>
                    {difficulties[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              {usingSelectedRegeneration ? 'Cards to regenerate' : 'Maximum cards'}
              <input
                type="number"
                className={field}
                min={1}
                max={MAX_STUDIO_CARDS}
                required
                disabled={usingSelectedRegeneration}
                value={usingSelectedRegeneration ? regenerationTargets.length : count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className={button}
            disabled={
              usingSelectedRegeneration ? regenerationTargets.length === 0 : selectedChapters.length === 0
            }
          >
            Review settings
          </button>
        </form>
      )}

      <label className="block text-sm font-medium">
        Saved deck filter and save destination
        <select
          className={field}
          value={targetDeck}
          disabled={
            busy ||
            usingSelectedRegeneration ||
            (draft !== null && selectedCards.some((cardId) => replacementTargets[cardId] !== undefined))
          }
          onChange={(event) => {
            const next = event.target.value;
            setTargetDeck(next);
            setDeckName('');
            setRegenerationTargetIds([]);
            setReplacementTargets({});
            deckFilterInitialized.current = true;
            selectedDeckRef.current = next && next !== '__new__' ? next : null;
            onDeckSelected(next && next !== '__new__' ? next : null);
          }}
        >
          <option value="">All saved cards (save new cards to default deck)</option>
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name}
              {deck.is_default ? ' (default)' : ''}
            </option>
          ))}
          <option value="__new__">Create a new deck</option>
        </select>
      </label>

      {settings && !draft && (
        <section aria-label="Draft settings" className="space-y-2 text-sm">
          <h3 className="font-semibold">Draft settings</h3>
          <p>
            {chapters
              .filter((chapter) => settings.chapter_ids.includes(chapter.id))
              .map((chapter) => chapter.title)
              .join(', ')}
          </p>
          <p>
            Up to {settings.count} cards · {languages[settings.language]} ·{' '}
            {difficulties[settings.difficulty]}
          </p>
          {settings.topic && <p>Topic: {settings.topic}</p>}
          <p>Generation uses your AI quota. Your deck changes only when you save selected cards.</p>
          <div className="flex flex-wrap gap-2">
            {!paused && (
              <button
                type="button"
                className={primary}
                disabled={busy}
                onClick={() => void startGeneration()}
              >
                Generate draft
              </button>
            )}
            {paused && (
              <button type="button" className={primary} disabled={busy} onClick={checkGeneration}>
                Check draft
              </button>
            )}
            <button type="button" className={button} disabled={busy} onClick={resetPreview}>
              Change settings
            </button>
          </div>
        </section>
      )}

      {draft && !draft.merge_result && (
        <form onSubmit={(event) => void saveSelection(event)} className="space-y-3">
          {usingSelectedRegeneration && (
            <p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              Map a candidate to a selected saved card to replace it. Unmapped candidates are added as new
              cards; unselected targets remain unchanged.
            </p>
          )}
          <fieldset disabled={busy} className="space-y-2">
            <legend className="text-sm font-semibold">Preview draft cards</legend>
            {draft.cards.map((card) => (
              <div key={card.id} className="rounded border border-neutral-300 p-3 text-sm">
                <label className="flex items-start gap-2 font-semibold">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={selectedCards.includes(card.id)}
                    onChange={(event) =>
                      setSelectedCards((previous) =>
                        event.target.checked
                          ? [...previous, card.id]
                          : previous.filter((cardId) => cardId !== card.id),
                      )
                    }
                  />
                  <MarkdownRenderer markdown={card.front} className="min-w-0" />
                </label>
                <MarkdownRenderer markdown={card.back} className="mt-1 break-words" />
                <label className="mt-2 block text-xs font-medium">
                  {usingSelectedRegeneration
                    ? 'Replace a selected saved card (optional)'
                    : 'Replace an existing card (optional)'}
                  <select
                    className={field}
                    value={replacementTargets[card.id] ?? ''}
                    onChange={(event) =>
                      setReplacementTargets((previous) => {
                        const next = { ...previous };
                        if (event.target.value) next[card.id] = event.target.value;
                        else delete next[card.id];
                        return next;
                      })
                    }
                  >
                    <option value="">Add as a new card</option>
                    {regenerableCards
                      .filter(
                        (saved) => !usingSelectedRegeneration || regenerationTargetIds.includes(saved.id),
                      )
                      .filter(
                        (saved) =>
                          !Object.entries(replacementTargets).some(
                            ([candidate, target]) => candidate !== card.id && target === saved.id,
                          ),
                      )
                      .map((saved) => (
                        <option key={saved.id} value={saved.id}>
                          {saved.front.slice(0, 90)}
                        </option>
                      ))}
                  </select>
                </label>
                <details className="mt-2 text-sm text-neutral-700">
                  <summary className="cursor-pointer">
                    Source evidence{card.page === null ? '' : ` · page ${card.page}`}
                  </summary>
                  <p className="mt-1 font-medium">
                    {chapters.find((chapter) => chapter.id === card.chapter_id)?.title}
                  </p>
                  <blockquote className="mt-1 whitespace-pre-wrap break-words border-s-2 border-neutral-400 ps-2">
                    {card.source_quote}
                  </blockquote>
                </details>
              </div>
            ))}
            {targetDeck === '__new__' && !selectedCards.some((cardId) => replacementTargets[cardId]) && (
              <label className="block text-sm font-medium">
                New deck name
                <input
                  className={field}
                  value={deckName}
                  maxLength={MAX_STUDIO_DECK_NAME_LENGTH}
                  onChange={(event) => setDeckName(event.target.value)}
                  required
                />
              </label>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={busy || selectedCards.length === 0}>
              Save {selectedCards.length} selected {selectedCards.length === 1 ? 'card' : 'cards'}
            </button>
            <button type="button" className={button} disabled={busy} onClick={resetPreview}>
              Discard preview
            </button>
          </div>
        </form>
      )}

      {status && (
        <p role="status" className="text-sm text-neutral-700">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {draft?.merge_result && (
        <button type="button" className={button} disabled={busy} onClick={resetPreview}>
          Draft more cards
        </button>
      )}

      <div className="border-t pt-2 text-sm">
        <h3 className="font-semibold">Saved decks</h3>
        {decksError ? (
          <p className="mt-1 text-red-700">{decksError}</p>
        ) : decks.length === 0 ? (
          <p className="mt-1 text-neutral-700">No saved decks yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {decks.map((deck) => (
              <li key={deck.id} className="border-b border-neutral-200 pb-2 last:border-0">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <span className="break-words">
                    {deck.name}
                    {deck.is_default ? ' (default)' : ''}
                  </span>
                  <span className="text-neutral-700">
                    {deck.card_count} {deck.card_count === 1 ? 'card' : 'cards'}
                  </span>
                </div>
                {deck.card_count > 0 && (
                  <FlashcardQuiz documentId={documentId} deck={deck} getToken={getToken} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
