'use client';

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';

const apiBase = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

export default function AccountPage() {
  const { getToken } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const downloadExport = async () => {
    setExporting(true);
    setMessage(null);
    try {
      const token = await getToken();
      const response = await fetch(`${apiBase()}/api/privacy/export`, {
        headers: { authorization: `Bearer ${token ?? ''}` },
      });
      if (!response.ok) throw new Error('Could not create your data export.');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'edusphere-data-export.json';
      link.click();
      URL.revokeObjectURL(href);
      setMessage('Your data export has downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create your data export.');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (confirmation !== 'DELETE') return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      if (!response.ok) throw new Error('Account deletion could not be completed.');
      window.location.assign('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Account deletion could not be completed.');
      setDeleting(false);
    }
  };

  return (
    <main className="coast-account-page mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Your data and account</h1>
        <p className="mt-2 text-neutral-700">
          Download your EduSphere data or permanently close your account.
        </p>
      </div>

      <section className="rounded border p-5" aria-labelledby="export-heading">
        <h2 id="export-heading" className="text-lg font-semibold">
          Export your data
        </h2>
        <p className="mt-1 text-sm text-neutral-700">
          The export is a JSON file with your documents and study records.
        </p>
        <button
          onClick={() => void downloadExport()}
          disabled={exporting}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {exporting ? 'Preparing export…' : 'Download my data'}
        </button>
      </section>

      <section className="rounded border border-red-300 p-5" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="text-lg font-semibold text-red-800">
          Delete account
        </h2>
        <p className="mt-1 text-sm text-neutral-700">
          This permanently deletes your sign-in account and EduSphere data. This cannot be undone.
        </p>
        <label htmlFor="delete-confirmation" className="mt-4 block text-sm font-medium">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
          autoComplete="off"
        />
        <button
          onClick={() => void deleteAccount()}
          disabled={confirmation !== 'DELETE' || deleting}
          className="mt-4 rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {deleting ? 'Deleting account…' : 'Permanently delete account'}
        </button>
      </section>

      {message && (
        <p role="status" className="text-sm text-neutral-800">
          {message}
        </p>
      )}
    </main>
  );
}
