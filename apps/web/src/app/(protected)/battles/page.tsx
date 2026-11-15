'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <textarea aria-label="Code editor" rows={18} readOnly value="Loading editor..." /> });

const problems = {
  'sum-pairs': 'Read two integers and print their sum.',
  'reverse-words': 'Read a line and print its whitespace-separated words in reverse order.',
} as const;

export default function BattlesPage() {
  const [problemId, setProblemId] = useState<keyof typeof problems>('sum-pairs');
  const [language, setLanguage] = useState<'python' | 'javascript'>('python');
  const [source, setSource] = useState('a, b = map(int, input().split())\nprint(a + b)');
  const [result, setResult] = useState<string>('');
  const [running, setRunning] = useState(false);
  async function submit() {
    setRunning(true); setResult('');
    try {
      const response = await fetch('/api/battles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problemId, language, source }) });
      const body = await response.json() as { passed?: number; total?: number; error?: { message?: string } };
      setResult(response.ok ? `${body.passed}/${body.total} tests passed` : (body.error?.message ?? 'Submission failed'));
    } catch { setResult('Submission failed'); } finally { setRunning(false); }
  }
  return <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
    <h1>CP Battle</h1>
    <p>{problems[problemId]}</p>
    <label>Problem <select value={problemId} onChange={(event) => setProblemId(event.target.value as keyof typeof problems)}><option value="sum-pairs">Sum pairs</option><option value="reverse-words">Reverse words</option></select></label>{' '}
    <label>Language <select value={language} onChange={(event) => setLanguage(event.target.value as 'python' | 'javascript')}><option value="python">Python</option><option value="javascript">JavaScript</option></select></label>
    <div style={{ marginTop: '1rem', border: '1px solid #334155' }}><MonacoEditor height="420px" language={language === 'python' ? 'python' : 'javascript'} value={source} onChange={(value) => setSource(value ?? '')} options={{ minimap: { enabled: false }, fontSize: 14 }} /></div>
    <button type="button" onClick={submit} disabled={running || !source.trim()} style={{ marginTop: '1rem' }}>{running ? 'Running...' : 'Run tests'}</button>
    <p role="status" aria-live="polite">{result}</p>
  </main>;
}
