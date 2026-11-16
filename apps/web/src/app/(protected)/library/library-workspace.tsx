'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadPdf } from '@/lib/ai-client';
import type { JobStatus } from '@/lib/ai-types';
import { pollUploadJobs } from './library-polling';

export type LibraryDocument = {
  id: string;
  filename: string;
  status: string;
  pageCount: number | null;
  updatedAt: Date;
};

type ActiveUpload = {
  filename: string;
  documentId: string;
  job: JobStatus | null;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function statusLabel(status: string): string {
  if (status === 'parsed') return 'Text extracted';
  if (status === 'failed') return 'Processing failed';
  if (status === 'running') return 'Processing';
  return 'Preparing lessons';
}

export function LibraryWorkspace({
  initialDocuments,
  loadError,
  userSynced,
}: {
  initialDocuments: LibraryDocument[];
  loadError: string;
  userSynced: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const stopPoll = useRef<(() => void) | null>(null);
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(loadError);
  const [activeUpload, setActiveUpload] = useState<ActiveUpload | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => () => stopPoll.current?.(), []);
  useEffect(() => setDocuments(initialDocuments), [initialDocuments]);

  const refreshLibrary = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setSuccessMessage('');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF file to start a study course.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('This file is larger than 20 MB. Choose a smaller PDF.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    setActiveUpload(null);
    try {
      const { jobId, documentId } = await uploadPdf(getToken, file);
      setActiveUpload({ filename: file.name, documentId, job: null });
      stopPoll.current?.();
      stopPoll.current = pollUploadJobs(
        getToken,
        jobId,
        (job) => {
          setActiveUpload((active) => active ? { ...active, job } : active);
        },
        () => {
          setSuccessMessage(`${file.name} is ready. Open it to begin the guided lessons.`);
          stopPoll.current = null;
          setUploading(false);
          refreshLibrary();
        },
        (pollError) => {
          setError(pollError.message);
          stopPoll.current = null;
          setUploading(false);
          refreshLibrary();
        },
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'PDF upload failed. Try again.');
      setUploading(false);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <main className="workspace-page library-page">
      <header className="library-heading">
        <div>
          <p className="page-kicker">YOUR STUDY MATERIAL</p>
          <h1 className="page-heading">My library</h1>
          <p className="page-subtitle">Add a course PDF, then learn chapter by chapter with explanations and active recall.</p>
        </div>
        <span className="library-count">{documents.length} {documents.length === 1 ? 'document' : 'documents'}</span>
      </header>

      <section className="library-upload surface" aria-labelledby="library-upload-title">
        <div className="library-upload-copy">
          <p className="page-kicker">CREATE A MINI-COURSE</p>
          <h2 id="library-upload-title" className="section-heading">Start with a PDF</h2>
          <p className="section-caption">We’ll extract the material and organize it into lessons. Text and scanned PDFs up to 20 MB are supported.</p>
          <div className="library-upload-points" aria-label="What happens after upload">
            <span><b>01</b> Organize chapters</span>
            <span><b>02</b> Explain each lesson</span>
            <span><b>03</b> Practice recall</span>
          </div>
        </div>
        <div className="library-upload-control">
          <input
            ref={inputRef}
            id="library-pdf"
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading}
            onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
            className="library-file-input"
          />
          <label htmlFor="library-pdf" className={`library-file-label${uploading ? ' is-disabled' : ''}`}>
            <span className="upload-symbol" aria-hidden="true">↑</span>
            <span className="library-file-title">{uploading ? 'Building your lessons…' : 'Choose a PDF'}</span>
            <span className="library-file-hint">PDF · up to 20 MB</span>
          </label>
          {uploading && (
            <p className="upload-progress" role="status" aria-live="polite">
              {activeUpload?.job ? `${statusLabel(activeUpload.job.status)}${activeUpload.job.status === 'running' ? ` · attempt ${activeUpload.job.attempts}` : ''}` : 'Uploading your PDF…'}
            </p>
          )}
        </div>
      </section>

      {error && <p className="status-error library-feedback" role="alert">{error}</p>}
      {!userSynced && !loadError && (
        <p className="library-feedback" role="status">
          Your account is still syncing. You can upload a PDF now; refresh the library in a moment if it does not appear.
        </p>
      )}
      {successMessage && (
        <p className="status-success library-feedback" role="status">
          {successMessage}{activeUpload && <Link href={`/tutor?documentId=${encodeURIComponent(activeUpload.documentId)}`} className="library-feedback-link"> Open tutor →</Link>}
        </p>
      )}

      <section className="library-list-section" aria-labelledby="library-list-title">
        <div className="library-list-heading">
          <div>
            <p className="page-kicker">YOUR MATERIAL</p>
            <h2 id="library-list-title" className="section-heading">Courses and documents</h2>
          </div>
          <button type="button" onClick={refreshLibrary} className="action-secondary">Refresh library</button>
        </div>

        {loadError ? (
          <div className="library-empty surface" role="status">
            <h3>Library temporarily unavailable</h3>
            <p>{loadError}</p>
            <button type="button" className="action-secondary" onClick={refreshLibrary}>Try again</button>
          </div>
        ) : documents.length === 0 ? (
          <div className="library-empty surface">
            <span className="library-empty-index" aria-hidden="true">01</span>
            <div>
              <h3>Your library is ready for its first course</h3>
              <p>Choose a lecture PDF above. Once processing finishes, this list will link directly to its lessons, AI tutor, flashcards, and viva practice.</p>
              <button type="button" onClick={() => inputRef.current?.click()} className="action-primary">Choose first PDF <span aria-hidden="true">→</span></button>
            </div>
          </div>
        ) : (
          <ul className="library-document-list">
            {documents.map((document, index) => (
              <li key={document.id} className="library-document-row">
                <span className={`library-document-mark library-document-mark-${index % 3}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <div className="library-document-main">
                  <h3>{document.filename}</h3>
                  <p>{document.pageCount ? `${document.pageCount} pages` : 'PDF'} <span aria-hidden="true">·</span> Added {readableDate(document.updatedAt)}</p>
                </div>
                <span className={`library-document-status status-${document.status}`}>{statusLabel(document.status)}</span>
                {document.status === 'parsed' && (
                  <a
                    href={`/api/documents/${encodeURIComponent(document.id)}/text`}
                    download
                    className="action-secondary"
                    aria-label={`Download extracted text from ${document.filename}`}
                  >
                    Export text
                  </a>
                )}
                <Link href={`/tutor?documentId=${encodeURIComponent(document.id)}`} className="action-secondary" aria-label={`Study ${document.filename}`}>
                  {document.status === 'parsed' ? 'Study' : 'Open'} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function readableDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
}
