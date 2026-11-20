'use client';

import { useAuth } from '@clerk/nextjs';
import { CoverBuilder } from '@/components/cover-builder';
import { BibliographyWorkspace } from '@/components/bibliography-workspace';
import { WhiteboardWorkspace } from '@/components/whiteboard-workspace';
import { OcrWorkspace } from '@/components/ocr-workspace';
import { CodeReviewWorkspace } from '@/components/code-review-workspace';
import { DraftChecklistWorkspace } from '@/components/draft-checklist-workspace';

export default function ToolsPage() {
  const { isLoaded, userId, getToken } = useAuth();
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Tools</h1>
      {isLoaded && userId ? (
        <WhiteboardWorkspace key={userId} ownerId={userId} getToken={getToken} />
      ) : (
        <p role="status">Loading your whiteboard account.</p>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <CoverBuilder
          key={isLoaded ? (userId ?? 'signed-out') : 'auth-loading'}
          ownerId={isLoaded ? (userId ?? null) : null}
        />
        {isLoaded && userId ? <OcrWorkspace key={userId} ownerId={userId} getToken={getToken} /> : null}
      </div>
      <BibliographyWorkspace key={isLoaded ? (userId ?? 'signed-out') : 'auth-loading'} />
      {isLoaded && userId ? <CodeReviewWorkspace key={userId} ownerId={userId} getToken={getToken} /> : null}
      {isLoaded && userId ? (
        <DraftChecklistWorkspace key={userId} ownerId={userId} getToken={getToken} />
      ) : null}
    </main>
  );
}
