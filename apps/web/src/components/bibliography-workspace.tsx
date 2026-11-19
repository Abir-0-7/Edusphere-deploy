'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BibliographyItemInputSchema,
  BibliographyItemKindSchema,
  BibliographyItemUpdateSchema,
  BibliographyFieldSchema,
  BibliographyMetadataSuggestionSchema,
  type BibliographyAuthor,
  type BibliographyField,
  type BibliographyItem,
  type BibliographyItemInput,
  type BibliographyItemKind,
  type BibliographyMetadataSuggestion,
  type BibliographyProvenance,
} from '@studyvault/types';
import {
  createBibliographyItem,
  deleteBibliographyItem,
  listBibliographyItems,
  listLibraryDocuments,
  updateBibliographyItem,
} from '@/lib/bibliography-client';
import {
  acceptedImportProvenance,
  exportCitationData,
  formatCitation,
  normalizeIdentifier,
  parseCitationImport,
  type CitationExportFormat,
  type CitationImportFormat,
  type CitationStyle,
  type ImportedCitation,
} from '@/lib/citation-toolkit';
import { normalizeIsbn } from '@studyvault/types';

type EditorState = {
  kind: BibliographyItemKind;
  title: string;
  authors: BibliographyAuthor[];
  issuedYear: string;
  issuedMonth: string;
  issuedDay: string;
  issuedLiteral: string;
  containerTitle: string;
  edition: string;
  volume: string;
  issue: string;
  itemPages: string;
  publisher: string;
  doi: string;
  isbn: string;
  url: string;
  accessedYear: string;
  accessedMonth: string;
  accessedDay: string;
  accessedLiteral: string;
  repositoryCommit: string;
  sourceDocumentId: string;
};
type EditorTextField =
  | 'title'
  | 'containerTitle'
  | 'edition'
  | 'volume'
  | 'issue'
  | 'itemPages'
  | 'publisher'
  | 'doi'
  | 'isbn'
  | 'url'
  | 'repositoryCommit';

const emptyEditor = (): EditorState => ({
  kind: 'book',
  title: '',
  authors: [],
  issuedYear: '',
  issuedMonth: '',
  issuedDay: '',
  issuedLiteral: '',
  containerTitle: '',
  edition: '',
  volume: '',
  issue: '',
  itemPages: '',
  publisher: '',
  doi: '',
  isbn: '',
  url: '',
  accessedYear: '',
  accessedMonth: '',
  accessedDay: '',
  accessedLiteral: '',
  repositoryCommit: '',
  sourceDocumentId: '',
});

const kindLabels: Record<BibliographyItemKind, string> = {
  book: 'Book',
  book_chapter: 'Book chapter',
  journal_article: 'Journal article',
  website: 'Website',
  repository: 'Repository',
};

const manualFields: ReadonlyArray<readonly [keyof BibliographyItemInput, BibliographyField]> = [
  ['title', 'title'],
  ['authors', 'authors'],
  ['issued', 'issued'],
  ['container_title', 'container_title'],
  ['edition', 'edition'],
  ['volume', 'volume'],
  ['issue', 'issue'],
  ['item_pages', 'item_pages'],
  ['publisher', 'publisher'],
  ['doi', 'doi'],
  ['isbn', 'isbn'],
  ['url', 'url'],
  ['accessed', 'accessed'],
  ['repository_commit', 'repository_commit'],
];

function dateFromInputs(year: string, month: string, day: string, literal: string) {
  const text = literal.trim();
  if (text) return { literal: text };
  if (!year.trim()) return null;
  return {
    year: Number(year),
    ...(month.trim() ? { month: Number(month) } : {}),
    ...(day.trim() ? { day: Number(day) } : {}),
  };
}

function editorFromItem(item: BibliographyItem): EditorState {
  const dateParts = (value: BibliographyItem['issued']) => ({
    year: value?.year?.toString() ?? '',
    month: value?.month?.toString() ?? '',
    day: value?.day?.toString() ?? '',
    literal: value?.literal ?? '',
  });
  const issued = dateParts(item.issued);
  const accessed = dateParts(item.accessed);
  return {
    kind: item.kind,
    title: item.title,
    authors: item.authors,
    issuedYear: issued.year,
    issuedMonth: issued.month,
    issuedDay: issued.day,
    issuedLiteral: issued.literal,
    containerTitle: item.container_title,
    edition: item.edition,
    volume: item.volume,
    issue: item.issue,
    itemPages: item.item_pages,
    publisher: item.publisher,
    doi: item.doi,
    isbn: item.isbn,
    url: item.url,
    accessedYear: accessed.year,
    accessedMonth: accessed.month,
    accessedDay: accessed.day,
    accessedLiteral: accessed.literal,
    repositoryCommit: item.repository_commit,
    sourceDocumentId: item.source_document_id ?? '',
  };
}

function editorFromInput(input: BibliographyItemInput): EditorState {
  const dateParts = (value: BibliographyItemInput['issued']) => ({
    year: value?.year?.toString() ?? '',
    month: value?.month?.toString() ?? '',
    day: value?.day?.toString() ?? '',
    literal: value?.literal ?? '',
  });
  const issued = dateParts(input.issued);
  const accessed = dateParts(input.accessed);
  return {
    kind: input.kind,
    title: input.title,
    authors: input.authors,
    issuedYear: issued.year,
    issuedMonth: issued.month,
    issuedDay: issued.day,
    issuedLiteral: issued.literal,
    containerTitle: input.container_title,
    edition: input.edition,
    volume: input.volume,
    issue: input.issue,
    itemPages: input.item_pages,
    publisher: input.publisher,
    doi: input.doi,
    isbn: input.isbn,
    url: input.url,
    accessedYear: accessed.year,
    accessedMonth: accessed.month,
    accessedDay: accessed.day,
    accessedLiteral: accessed.literal,
    repositoryCommit: input.repository_commit,
    sourceDocumentId: '',
  };
}

function inputFromEditor(
  editor: EditorState,
  suggestions: BibliographyMetadataSuggestion[] = [],
  original?: BibliographyItem | null,
  accepted: Partial<Record<BibliographyField, BibliographyProvenance>> = {},
): BibliographyItemInput {
  const authors = editor.authors.filter((author) =>
    Boolean(author.literal?.trim() || author.family?.trim() || author.given?.trim()),
  );
  const issued = dateFromInputs(
    editor.issuedYear,
    editor.issuedMonth,
    editor.issuedDay,
    editor.issuedLiteral,
  );
  const accessed = dateFromInputs(
    editor.accessedYear,
    editor.accessedMonth,
    editor.accessedDay,
    editor.accessedLiteral,
  );
  const content = {
    kind: editor.kind,
    title: editor.title,
    authors,
    issued,
    container_title: editor.containerTitle,
    edition: editor.edition,
    volume: editor.volume,
    issue: editor.issue,
    item_pages: editor.itemPages,
    publisher: editor.publisher,
    doi: editor.doi ? normalizeIdentifier('doi', editor.doi, editor.kind).doi : '',
    isbn: editor.isbn ? (normalizeIsbn(editor.isbn) ?? editor.isbn) : '',
    url: editor.url ? normalizeIdentifier('url', editor.url, editor.kind).url : '',
    accessed,
    repository_commit: editor.repositoryCommit,
    source_document_id: editor.sourceDocumentId || null,
    metadata_provenance: [],
    metadata_suggestions: suggestions,
  };
  const fields = BibliographyItemInputSchema.parse(content);
  const originalValues: Partial<Record<BibliographyField, unknown>> = original
    ? {
        title: original.title,
        authors: original.authors,
        issued: original.issued,
        container_title: original.container_title,
        edition: original.edition,
        volume: original.volume,
        issue: original.issue,
        item_pages: original.item_pages,
        publisher: original.publisher,
        doi: original.doi,
        isbn: original.isbn,
        url: original.url,
        accessed: original.accessed,
        repository_commit: original.repository_commit,
      }
    : {};
  const provenance = manualFields.flatMap(([key, field]) => {
    const value = content[key as keyof typeof content];
    const present =
      typeof value === 'string'
        ? value.trim().length > 0
        : Array.isArray(value)
          ? value.length > 0
          : value !== null;
    if (!present) return [];
    const chosen = accepted[field];
    if (chosen) return [chosen];
    if (original && JSON.stringify(value) === JSON.stringify(originalValues[field])) {
      const prior = original.metadata_provenance.find((entry) => entry.field === field);
      if (prior) return [prior];
    }
    return [{ field, source: 'manual' as const, confirmed: true }];
  });
  return BibliographyItemInputSchema.parse({ ...fields, metadata_provenance: provenance });
}

function authorsLabel(authors: BibliographyAuthor[]) {
  return authors
    .map((author) => author.literal ?? [author.given, author.family].filter(Boolean).join(' ') ?? '')
    .filter(Boolean)
    .join('; ');
}

function missingFields(item: BibliographyItem): string[] {
  const missing: string[] = [];
  if (!item.title) missing.push('title');
  if (!item.authors.length) missing.push('author');
  if (!item.issued) missing.push('publication date');
  if (!item.url && !item.doi && !item.isbn) missing.push('URL, DOI or ISBN');
  return missing;
}

export function BibliographyWorkspace() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [items, setItems] = useState<BibliographyItem[]>([]);
  const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<BibliographyItem | null>(null);
  const [suggestions, setSuggestions] = useState<BibliographyMetadataSuggestion[]>([]);
  const [acceptedProvenance, setAcceptedProvenance] = useState<
    Partial<Record<BibliographyField, BibliographyProvenance>>
  >({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestionField, setSuggestionField] = useState<BibliographyField>('title');
  const [suggestionSource, setSuggestionSource] = useState<BibliographyMetadataSuggestion['source']>('url');
  const [suggestionValue, setSuggestionValue] = useState('');
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa');
  const [citationLocator, setCitationLocator] = useState('');
  const [formattedCitation, setFormattedCitation] = useState<{
    citation: string;
    bibliography: string;
  } | null>(null);
  const [citationBusy, setCitationBusy] = useState(false);
  const [importFormat, setImportFormat] = useState<CitationImportFormat>('bibtex');
  const [importText, setImportText] = useState('');
  const [imported, setImported] = useState<ImportedCitation[]>([]);
  const [identifierKind, setIdentifierKind] = useState<'doi' | 'url' | 'isbn'>('doi');
  const [identifierValue, setIdentifierValue] = useState('');

  const setTextField = (key: EditorTextField, field: BibliographyField, value: string) => {
    setEditor((current) => ({ ...current, [key]: value }));
    setAcceptedProvenance((current) => ({
      ...current,
      [field]: { field, source: 'manual', confirmed: true },
    }));
  };

  const setDatePart = (
    key:
      | 'issuedYear'
      | 'issuedMonth'
      | 'issuedDay'
      | 'issuedLiteral'
      | 'accessedYear'
      | 'accessedMonth'
      | 'accessedDay'
      | 'accessedLiteral',
    value: string,
  ) => {
    const field: BibliographyField = key.startsWith('issued') ? 'issued' : 'accessed';
    setEditor((current) => ({ ...current, [key]: value }));
    setAcceptedProvenance((current) => ({
      ...current,
      [field]: { field, source: 'manual', confirmed: true },
    }));
  };

  const reload = useCallback(async () => {
    const [nextItems, nextDocuments] = await Promise.all([
      listBibliographyItems(getToken),
      listLibraryDocuments(getToken),
    ]);
    setItems(nextItems);
    setDocuments(nextDocuments);
  }, [getToken]);

  useEffect(() => {
    let active = true;
    setItems([]);
    setDocuments([]);
    setSelected(null);
    setSelectedId('');
    setSuggestions([]);
    setAcceptedProvenance({});
    setEditor(emptyEditor());
    setError('');
    if (!isLoaded || !isSignedIn)
      return () => {
        active = false;
      };
    void reload().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your bibliography.');
    });
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, reload]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        !query ||
        `${item.title} ${authorsLabel(item.authors)} ${item.container_title}`
          .toLocaleLowerCase()
          .includes(query),
    );
  }, [items, search]);

  const startNew = () => {
    setSelected(null);
    setSelectedId('');
    setEditor(emptyEditor());
    setSuggestions([]);
    setAcceptedProvenance({});
    setError('');
    setMessage('');
  };

  const editItem = (item: BibliographyItem) => {
    setSelected(item);
    setSelectedId(item.id);
    setEditor(editorFromItem(item));
    setSuggestions(item.metadata_suggestions);
    setAcceptedProvenance({});
    setError('');
    setMessage('');
  };

  const addAuthor = () => {
    setEditor((current) => ({
      ...current,
      authors: [...current.authors, { family: '', given: '', literal: undefined, suffix: undefined }],
    }));
    setAcceptedProvenance((current) => ({
      ...current,
      authors: { field: 'authors', source: 'manual', confirmed: true },
    }));
  };

  const updateAuthor = (index: number, key: 'family' | 'given' | 'literal', value: string) => {
    setEditor((current) => ({
      ...current,
      authors: current.authors.map((author, i) =>
        i === index
          ? {
              family: key === 'family' ? value : author.family,
              given: key === 'given' ? value : author.given,
              literal: key === 'literal' ? value : author.literal,
              suffix: author.suffix,
            }
          : author,
      ),
    }));
    setAcceptedProvenance((current) => ({
      ...current,
      authors: { field: 'authors', source: 'manual', confirmed: true },
    }));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const input = inputFromEditor(editor, suggestions, selected, acceptedProvenance);
      const saved = selected
        ? await updateBibliographyItem(
            getToken,
            selected.id,
            BibliographyItemUpdateSchema.parse({ ...input, expected_revision: selected.revision }),
          )
        : await createBibliographyItem(getToken, input);
      await reload();
      editItem(saved);
      setMessage(`Saved revision ${saved.revision}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this reference.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await deleteBibliographyItem(getToken, selected.id);
      await reload();
      startNew();
      setMessage('Reference deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this reference.');
    } finally {
      setBusy(false);
    }
  };

  const useSuggestion = (suggestion: BibliographyMetadataSuggestion) => {
    const field = suggestion.field;
    const textFields: Partial<Record<BibliographyField, keyof EditorState>> = {
      title: 'title',
      container_title: 'containerTitle',
      edition: 'edition',
      volume: 'volume',
      issue: 'issue',
      item_pages: 'itemPages',
      publisher: 'publisher',
      doi: 'doi',
      isbn: 'isbn',
      url: 'url',
      repository_commit: 'repositoryCommit',
    };
    const target = textFields[field];
    if (target) {
      setEditor((current) => ({ ...current, [target]: suggestion.value }));
    } else if (field === 'issued') {
      setEditor((current) => ({
        ...current,
        issuedYear: '',
        issuedMonth: '',
        issuedDay: '',
        issuedLiteral: suggestion.value,
      }));
    } else if (field === 'accessed') {
      setEditor((current) => ({
        ...current,
        accessedYear: '',
        accessedMonth: '',
        accessedDay: '',
        accessedLiteral: suggestion.value,
      }));
    } else if (field === 'authors') {
      setEditor((current) => ({
        ...current,
        authors: [
          ...current.authors,
          {
            family: undefined,
            given: undefined,
            literal: suggestion.value,
            suffix: undefined,
          },
        ],
      }));
    }
    const remaining = suggestions.filter((item) => item !== suggestion);
    setSuggestions(remaining);
    setAcceptedProvenance((current) => ({
      ...current,
      [field]: { field, source: suggestion.source, confirmed: true },
    }));
    setSelected((current) =>
      current
        ? {
            ...current,
            metadata_suggestions: remaining,
            metadata_provenance: [
              ...current.metadata_provenance.filter((item) => item.field !== field),
              {
                field,
                source: suggestion.source,
                confirmed: true,
              },
            ],
          }
        : current,
    );
    setMessage(`Applied suggested ${field} from ${suggestion.source}; review it and save to confirm.`);
  };

  const addSuggestion = () => {
    setError('');
    try {
      const suggestion = BibliographyMetadataSuggestionSchema.parse({
        field: BibliographyFieldSchema.parse(suggestionField),
        value: suggestionValue,
        source: suggestionSource,
      });
      setSuggestions((current) => [...current, suggestion]);
      setSelected((current) =>
        current
          ? {
              ...current,
              metadata_suggestions: [...current.metadata_suggestions, suggestion],
            }
          : current,
      );
      setSuggestionValue('');
      setMessage('Suggestion is unconfirmed until you apply and review it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid metadata suggestion.');
    }
  };

  const parseImports = () => {
    setError('');
    try {
      const next = parseCitationImport(importText, importFormat, items);
      setImported(next);
      setMessage(`Parsed ${next.length} import${next.length === 1 ? '' : 's'}. Review fields before saving.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not parse these citation records.');
    }
  };

  const reviewImport = (candidate: ImportedCitation, forceNew = false) => {
    const existing =
      !forceNew && candidate.duplicate?.itemId.startsWith('batch:')
        ? null
        : !forceNew
          ? (items.find((item) => item.id === candidate.duplicate?.itemId) ?? null)
          : null;
    const incoming = editorFromInput(candidate.input);
    const base = existing ? editorFromItem(existing) : emptyEditor();
    const merged = existing
      ? {
          ...base,
          kind: candidate.input.kind,
          ...(candidate.input.title ? { title: incoming.title } : {}),
          ...(candidate.input.authors.length ? { authors: incoming.authors } : {}),
          ...(candidate.input.issued
            ? {
                issuedYear: incoming.issuedYear,
                issuedMonth: incoming.issuedMonth,
                issuedDay: incoming.issuedDay,
                issuedLiteral: incoming.issuedLiteral,
              }
            : {}),
          ...(candidate.input.container_title ? { containerTitle: incoming.containerTitle } : {}),
          ...(candidate.input.edition ? { edition: incoming.edition } : {}),
          ...(candidate.input.volume ? { volume: incoming.volume } : {}),
          ...(candidate.input.issue ? { issue: incoming.issue } : {}),
          ...(candidate.input.item_pages ? { itemPages: incoming.itemPages } : {}),
          ...(candidate.input.publisher ? { publisher: incoming.publisher } : {}),
          ...(candidate.input.doi ? { doi: incoming.doi } : {}),
          ...(candidate.input.isbn ? { isbn: incoming.isbn } : {}),
          ...(candidate.input.url ? { url: incoming.url } : {}),
          ...(candidate.input.accessed
            ? {
                accessedYear: incoming.accessedYear,
                accessedMonth: incoming.accessedMonth,
                accessedDay: incoming.accessedDay,
                accessedLiteral: incoming.accessedLiteral,
              }
            : {}),
          ...(candidate.input.repository_commit ? { repositoryCommit: incoming.repositoryCommit } : {}),
        }
      : incoming;
    setSelected(existing);
    setSelectedId(existing?.id ?? '');
    setEditor(merged);
    setSuggestions(existing?.metadata_suggestions ?? []);
    setAcceptedProvenance(
      Object.fromEntries(
        acceptedImportProvenance(candidate.input, candidate.source).map((entry) => [entry.field, entry]),
      ),
    );
    setError('');
    setMessage(
      existing
        ? `Possible duplicate by ${candidate.duplicate?.reason}. Review imported changes; save applies them to revision ${existing.revision}.`
        : 'Review imported fields in the editor; save when you are ready to add this reference.',
    );
  };

  const formatSelected = async () => {
    setCitationBusy(true);
    setError('');
    setFormattedCitation(null);
    try {
      setFormattedCitation(await formatCitation(items, selectedId, citationStyle, citationLocator));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not format these citations.');
    } finally {
      setCitationBusy(false);
    }
  };

  const downloadExport = (format: CitationExportFormat) => {
    setError('');
    try {
      const content = exportCitationData(items, format);
      const mime = format === 'csl_json' ? 'application/json' : 'text/plain';
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `studyvault-bibliography.${format === 'csl_json' ? 'json' : format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export these records.');
    }
  };

  const applyIdentifier = () => {
    setError('');
    try {
      const normalized = normalizeIdentifier(identifierKind, identifierValue, editor.kind);
      setEditor((current) => ({
        ...current,
        ...(identifierKind === 'doi' ? { doi: normalized.doi } : {}),
        ...(identifierKind === 'url' ? { url: normalized.url } : {}),
        ...(identifierKind === 'isbn' ? { isbn: normalized.isbn } : {}),
      }));
      setIdentifierValue('');
      setMessage(`Normalized ${identifierKind.toUpperCase()} locally; no external lookup was made.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not normalize this identifier.');
    }
  };

  const inputClass = 'mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm';
  const labelClass = 'block text-sm font-medium text-neutral-800';
  if (!isLoaded)
    return (
      <section className="rounded border p-4" role="status">
        Loading bibliography.
      </section>
    );
  if (!isSignedIn)
    return <section className="rounded border p-4">Sign in to manage private references.</section>;

  return (
    <section
      id="bibliography-workspace"
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Bibliography library</h2>
          <p className="text-sm text-neutral-600">
            Add or edit metadata yourself. Missing dates and authors stay missing; no lookup or citation is
            invented.
          </p>
        </div>
        <label className="sr-only" htmlFor="bibliography-search">
          Search references
        </label>
        <input
          id="bibliography-search"
          aria-label="Search references"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, author, container"
          className="w-full rounded border px-3 py-2 text-sm sm:w-64"
        />
        <button type="button" onClick={startNew} className="rounded border px-3 py-2 text-sm">
          New reference
        </button>
      </header>
      <div className="space-y-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
        <div>
          <h3 className="font-semibold">Import and normalize references</h3>
          <p className="text-sm text-neutral-700">
            Paste BibTeX, RIS or CSL-JSON (up to 256 KiB / 50 records). Imports are local; inspect each record
            before saving.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(150px,0.5fr)_1fr]">
          <label className={labelClass}>
            Import format
            <select
              className={inputClass}
              value={importFormat}
              onChange={(event) => setImportFormat(event.target.value as CitationImportFormat)}
            >
              <option value="bibtex">BibTeX</option>
              <option value="ris">RIS</option>
              <option value="csl_json">CSL-JSON</option>
            </select>
          </label>
          <label className={labelClass}>
            Choose a local file
            <input
              className={inputClass}
              type="file"
              accept=".bib,.ris,.json,application/json,text/plain"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                if (file.size > 256 * 1024) {
                  setError('Import files are limited to 256 KiB.');
                  return;
                }
                const extension = file.name.toLocaleLowerCase().split('.').at(-1);
                if (extension === 'bib') setImportFormat('bibtex');
                else if (extension === 'ris') setImportFormat('ris');
                else if (extension === 'json') setImportFormat('csl_json');
                void file
                  .text()
                  .then(setImportText)
                  .catch(() => setError('Could not read this local file.'));
              }}
            />
          </label>
        </div>
        <label className={labelClass}>
          Citation records
          <textarea
            className={`${inputClass} min-h-32 font-mono`}
            value={importText}
            maxLength={256 * 1024}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={
              '@book{example,\n  title = {Example},\n  author = {Lovelace, Ada},\n  year = {1843}\n}'
            }
          />
        </label>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={parseImports}>
          Parse and preview
        </button>
        {imported.length > 0 && (
          <ul aria-label="Imported reference previews" className="max-h-80 space-y-2 overflow-auto">
            {imported.map((candidate, index) => (
              <li key={`${candidate.input.title}-${index}`} className="rounded border bg-white p-3">
                <p className="font-medium">{candidate.input.title || '(no title supplied)'}</p>
                <p className="text-sm text-neutral-700">
                  {candidate.input.authors
                    .map(
                      (author) => author.literal ?? [author.given, author.family].filter(Boolean).join(' '),
                    )
                    .join('; ') || 'No author'}{' '}
                  · {candidate.input.issued?.year ?? candidate.input.issued?.literal ?? 'No date'} ·{' '}
                  {candidate.input.kind}
                </p>
                {(candidate.input.doi || candidate.input.isbn || candidate.input.url) && (
                  <p className="break-all text-xs text-neutral-600">
                    {[
                      candidate.input.doi && `DOI ${candidate.input.doi}`,
                      candidate.input.isbn && `ISBN ${candidate.input.isbn}`,
                      candidate.input.url,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {candidate.duplicate && (
                  <p role="status" className="text-sm text-amber-800">
                    Possible duplicate by {candidate.duplicate.reason}:{' '}
                    {candidate.duplicate.itemId.startsWith('batch:')
                      ? 'another record in this import; keep the earlier row to avoid saving it twice'
                      : 'a saved record'}
                    .
                  </p>
                )}
                {candidate.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-amber-800">
                    {warning}
                  </p>
                ))}
                {candidate.duplicate ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!candidate.duplicate.itemId.startsWith('batch:') && (
                      <button
                        type="button"
                        className="rounded border px-3 py-1.5 text-sm"
                        onClick={() => reviewImport(candidate)}
                      >
                        Review duplicate
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-sm"
                      onClick={() => reviewImport(candidate, true)}
                    >
                      Keep as separate record
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-2 rounded border px-3 py-1.5 text-sm"
                    onClick={() => reviewImport(candidate)}
                  >
                    Review in editor
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3 rounded-lg border border-neutral-300 p-4">
        <div>
          <h3 className="font-semibold">Normalize an identifier</h3>
          <p className="text-sm text-neutral-700">
            Normalize a DOI, HTTP(S) URL or ISBN locally. No remote metadata lookup occurs.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[0.7fr_1.5fr_auto]">
          <label className={labelClass}>
            Identifier type
            <select
              className={inputClass}
              value={identifierKind}
              onChange={(event) => setIdentifierKind(event.target.value as 'doi' | 'url' | 'isbn')}
            >
              <option value="doi">DOI</option>
              <option value="url">URL</option>
              <option value="isbn">ISBN</option>
            </select>
          </label>
          <label className={labelClass}>
            Identifier
            <input
              className={inputClass}
              value={identifierValue}
              maxLength={2048}
              onChange={(event) => setIdentifierValue(event.target.value)}
            />
          </label>
          <button type="button" className="mt-6 rounded border px-3 py-2 text-sm" onClick={applyIdentifier}>
            Normalize into form
          </button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]">
        <div>
          <p className="mb-2 text-sm font-medium">
            {filteredItems.length} of {items.length} references
          </p>
          <ul className="max-h-[60vh] space-y-2 overflow-auto">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => editItem(item)}
                  aria-current={selectedId === item.id ? 'true' : undefined}
                  className={`w-full rounded border p-3 text-left ${selectedId === item.id ? 'border-blue-700 bg-blue-50' : 'border-neutral-200'}`}
                >
                  <span className="block font-medium">{item.title || '(untitled reference)'}</span>
                  <span className="block text-xs text-neutral-600">
                    {kindLabels[item.kind]} · {authorsLabel(item.authors) || 'No author'} ·{' '}
                    {item.issued?.year ?? item.issued?.literal ?? 'No date'}
                  </span>
                  {missingFields(item).length > 0 && (
                    <span className="mt-1 block text-xs text-amber-800">
                      Missing {missingFields(item).join(', ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Source type
              <select
                className={inputClass}
                value={editor.kind}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    kind: BibliographyItemKindSchema.parse(event.target.value),
                  }))
                }
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Title
              <input
                className={inputClass}
                value={editor.title}
                maxLength={2000}
                onChange={(event) => setTextField('title', 'title', event.target.value)}
              />
            </label>
          </div>
          <fieldset className="rounded border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-medium">Citation preview and exports</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelClass}>
                Style
                <select
                  className={inputClass}
                  value={citationStyle}
                  onChange={(event) => setCitationStyle(event.target.value as CitationStyle)}
                >
                  <option value="apa">APA 7th</option>
                  <option value="mla">MLA 9th</option>
                  <option value="ieee">IEEE 2023</option>
                </select>
              </label>
              <label className={labelClass}>
                Cited reference
                <select
                  className={inputClass}
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  <option value="">Choose a saved reference</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || '(untitled reference)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Page / section locator
                <input
                  className={inputClass}
                  value={citationLocator}
                  maxLength={120}
                  onChange={(event) => setCitationLocator(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={citationBusy || items.length === 0}
                onClick={() => void formatSelected()}
                className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {citationBusy ? 'Formatting…' : 'Format APA / MLA / IEEE'}
              </button>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => downloadExport('bibtex')}
                className="rounded border px-3 py-2 text-sm"
              >
                Export BibTeX
              </button>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => downloadExport('ris')}
                className="rounded border px-3 py-2 text-sm"
              >
                Export RIS
              </button>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => downloadExport('csl_json')}
                className="rounded border px-3 py-2 text-sm"
              >
                Export CSL-JSON
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-600">
              IEEE preview numbers follow the order of the references listed in your library.
            </p>
            {formattedCitation && (
              <div className="mt-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold">In-text citation</h4>
                  <pre className="whitespace-pre-wrap rounded bg-neutral-100 p-3 text-sm">
                    {formattedCitation.citation}
                  </pre>
                </div>
                <div>
                  <h4 className="text-sm font-semibold">Bibliography</h4>
                  <pre className="whitespace-pre-wrap rounded bg-neutral-100 p-3 text-sm">
                    {formattedCitation.bibliography}
                  </pre>
                </div>
              </div>
            )}
            <p className="mt-3 rounded bg-blue-50 p-3 text-sm text-neutral-800">
              citeproc-js implements the Citation Style Language · © Frank Bennett.{' '}
              <a className="underline" href="https://citationstyles.org/">
                citationstyles.org
              </a>{' '}
              ·{' '}
              <a className="underline" href="/licenses/CPAL-1.0.txt">
                CPAL license
              </a>{' '}
              ·{' '}
              <a className="underline" href="/licenses/citeproc-2.4.63.js">
                citeproc 2.4.63 source
              </a>{' '}
              ·{' '}
              <a className="underline" href="/licenses/citation-js-mit-license.txt">
                Citation.js MIT license
              </a>
              .
            </p>
            <p className="text-xs text-neutral-600">
              APA 7, MLA 9 and IEEE 2023 CSL files are supplied with their original authors and CC BY-SA 3.0
              metadata.{' '}
              <a className="underline" href="https://creativecommons.org/licenses/by-sa/3.0/legalcode">
                Style license
              </a>
              .
            </p>
          </fieldset>
          <fieldset className="space-y-2 rounded border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-medium">Authors</legend>
            {editor.authors.map((author, index) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={`author-${index}`}>
                {author.literal !== undefined ? (
                  <label className={labelClass}>
                    Organization or literal name
                    <input
                      className={inputClass}
                      value={author.literal}
                      onChange={(event) => updateAuthor(index, 'literal', event.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label className={labelClass}>
                      Given name
                      <input
                        className={inputClass}
                        value={author.given ?? ''}
                        onChange={(event) => updateAuthor(index, 'given', event.target.value)}
                      />
                    </label>
                    <label className={labelClass}>
                      Family name
                      <input
                        className={inputClass}
                        value={author.family ?? ''}
                        onChange={(event) => updateAuthor(index, 'family', event.target.value)}
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="mt-6 rounded border px-2 py-1 text-sm"
                  onClick={() => {
                    setEditor((current) => ({
                      ...current,
                      authors: current.authors.filter((_, i) => i !== index),
                    }));
                    setAcceptedProvenance((current) => ({
                      ...current,
                      authors: { field: 'authors', source: 'manual', confirmed: true },
                    }));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              disabled={editor.authors.length >= 40}
              onClick={addAuthor}
            >
              Add author
            </button>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Publication year
              <input
                className={inputClass}
                type="number"
                min="1"
                max="9999"
                value={editor.issuedYear}
                onChange={(event) => {
                  setDatePart('issuedYear', event.target.value);
                  setDatePart('issuedLiteral', '');
                }}
              />
            </label>
            <label className={labelClass}>
              Publication month
              <input
                className={inputClass}
                type="number"
                min="1"
                max="12"
                value={editor.issuedMonth}
                onChange={(event) => setDatePart('issuedMonth', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Publication day
              <input
                className={inputClass}
                type="number"
                min="1"
                max="31"
                value={editor.issuedDay}
                onChange={(event) => setDatePart('issuedDay', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Other date text
              <input
                className={inputClass}
                maxLength={120}
                value={editor.issuedLiteral}
                onChange={(event) => {
                  setDatePart('issuedLiteral', event.target.value);
                  setDatePart('issuedYear', '');
                  setDatePart('issuedMonth', '');
                  setDatePart('issuedDay', '');
                }}
              />
            </label>
            <label className={labelClass}>
              Container / publication
              <input
                className={inputClass}
                value={editor.containerTitle}
                maxLength={1000}
                onChange={(event) => setTextField('containerTitle', 'container_title', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Edition
              <input
                className={inputClass}
                value={editor.edition}
                maxLength={120}
                onChange={(event) => setTextField('edition', 'edition', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Volume
              <input
                className={inputClass}
                value={editor.volume}
                maxLength={80}
                onChange={(event) => setTextField('volume', 'volume', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Issue
              <input
                className={inputClass}
                value={editor.issue}
                maxLength={80}
                onChange={(event) => setTextField('issue', 'issue', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Page range
              <input
                className={inputClass}
                value={editor.itemPages}
                maxLength={120}
                placeholder="e.g. 12-28"
                onChange={(event) => setTextField('itemPages', 'item_pages', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Publisher
              <input
                className={inputClass}
                value={editor.publisher}
                maxLength={300}
                onChange={(event) => setTextField('publisher', 'publisher', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              DOI
              <input
                className={inputClass}
                value={editor.doi}
                maxLength={300}
                onChange={(event) => setTextField('doi', 'doi', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              ISBN
              <input
                className={inputClass}
                value={editor.isbn}
                maxLength={17}
                onChange={(event) => setTextField('isbn', 'isbn', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              URL
              <input
                className={inputClass}
                type="url"
                value={editor.url}
                maxLength={2048}
                onChange={(event) => setTextField('url', 'url', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Repository commit
              <input
                className={inputClass}
                value={editor.repositoryCommit}
                maxLength={128}
                onChange={(event) =>
                  setTextField('repositoryCommit', 'repository_commit', event.target.value)
                }
              />
            </label>
            <label className={labelClass}>
              Accessed year
              <input
                className={inputClass}
                type="number"
                min="1"
                max="9999"
                value={editor.accessedYear}
                onChange={(event) => {
                  setDatePart('accessedYear', event.target.value);
                  setDatePart('accessedLiteral', '');
                }}
              />
            </label>
            <label className={labelClass}>
              Accessed month
              <input
                className={inputClass}
                type="number"
                min="1"
                max="12"
                value={editor.accessedMonth}
                onChange={(event) => setDatePart('accessedMonth', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Accessed day
              <input
                className={inputClass}
                type="number"
                min="1"
                max="31"
                value={editor.accessedDay}
                onChange={(event) => setDatePart('accessedDay', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Other access date text
              <input
                className={inputClass}
                maxLength={120}
                value={editor.accessedLiteral}
                onChange={(event) => {
                  setDatePart('accessedLiteral', event.target.value);
                  setDatePart('accessedYear', '');
                  setDatePart('accessedMonth', '');
                  setDatePart('accessedDay', '');
                }}
              />
            </label>
          </div>
          <label className={labelClass}>
            Link an owned study document (optional)
            <select
              className={inputClass}
              value={editor.sourceDocumentId}
              onChange={(event) =>
                setEditor((current) => ({ ...current, sourceDocumentId: event.target.value }))
              }
            >
              <option value="">No linked document</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded border border-amber-300 bg-amber-50 p-3">
            <h3 className="text-sm font-medium">Unconfirmed metadata suggestions</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-[0.8fr_0.8fr_1.5fr_auto]">
              <label className={labelClass}>
                Field
                <select
                  className={inputClass}
                  value={suggestionField}
                  onChange={(event) => setSuggestionField(BibliographyFieldSchema.parse(event.target.value))}
                >
                  {BibliographyFieldSchema.options.map((field) => (
                    <option key={field} value={field}>
                      {field.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Source
                <select
                  aria-label="Suggestion source"
                  className={inputClass}
                  value={suggestionSource}
                  onChange={(event) =>
                    setSuggestionSource(event.target.value as BibliographyMetadataSuggestion['source'])
                  }
                >
                  {(['url', 'doi', 'isbn', 'bibtex', 'ris', 'csl_json'] as const).map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Unconfirmed value
                <input
                  className={inputClass}
                  value={suggestionValue}
                  maxLength={4000}
                  onChange={(event) => setSuggestionValue(event.target.value)}
                />
              </label>
              <button type="button" className="mt-6 rounded border px-3 py-2 text-sm" onClick={addSuggestion}>
                Add
              </button>
            </div>
            {suggestions.length > 0 && (
              <ul className="mt-2 space-y-2 text-sm">
                {suggestions.map((suggestion, index) => (
                  <li key={`${suggestion.field}-${index}`}>
                    <span>
                      {suggestion.field}: {suggestion.value} ({suggestion.source})
                    </span>
                    <button
                      type="button"
                      onClick={() => useSuggestion(suggestion)}
                      className="ml-2 underline"
                    >
                      Apply for review
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected?.metadata_provenance.length ? (
            <p className="text-xs text-neutral-600">
              Confirmed metadata provenance:{' '}
              {selected.metadata_provenance.map((entry) => `${entry.field}=${entry.source}`).join(' · ')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? 'Saving.' : selected ? 'Save changes' : 'Save reference'}
            </button>
            {selected && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="rounded border px-4 py-2 text-sm"
              >
                Delete
              </button>
            )}
          </div>
          {selected && (
            <p className="text-xs text-neutral-600">
              Revision {selected.revision} · manually entered values are confirmed only when you save.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-green-800">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
