# Phase 8D schema additions

Migrations 0011–0015 add owner/source-scoped `flashcard_decks`, generation drafts, immutable card versions, quality reports, quiz sessions and `concept_graphs`. Existing cards receive a default deck and version-1 snapshot without changing IDs, SM-2 state or review rows. Card edits set `needs_review`; retired cards are omitted from active review. Every added table cascades with account/source deletion.

Quiz `answer_key` remains server-only; privacy exports include questions and submitted results. Graph JSON stores stable objective/node/edge IDs, exact source evidence, annotations and layout with optimistic revision checks. Graph actions revalidate owner, revision, chunk/page/quote and pinned course context. Board actions use the existing account-scoped local Tldraw board.
