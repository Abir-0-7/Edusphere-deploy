'use client';

import { useState } from 'react';
import type { GameSession, VersionedGameAction } from '@studyvault/types';

type Question = NonNullable<GameSession['view']['question']>;
type Props = {
  question: Question;
  disabled: boolean;
  reducedMotion: boolean;
  onAction: (action: VersionedGameAction) => void;
};

const primary =
  'min-h-11 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';
const secondary =
  'min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

function ActivityTable({ columns, rows, caption }: { columns: string[]; rows: string[][]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-slate-600">
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="border-b border-slate-200 px-4 py-3 font-bold text-slate-900"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-slate-50">
              {row.map((value, index) => (
                <td key={index} className="border-b border-slate-100 px-4 py-3 tabular-nums text-slate-700">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A client receives only the public activity. Keys, graph grading and proof
 * dependencies stay on the server, just as they do for the original games. */
export function GameActivity({ question, disabled, reducedMotion, onAction }: Props) {
  const [line, setLine] = useState<number | null>(null);
  const [repair, setRepair] = useState<number | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const activity = question.activity;
  if (!activity) return null;
  const motion = reducedMotion ? '' : 'motion-safe:transition motion-safe:hover:-translate-y-0.5';
  const kindLabels = {
    debug: 'Debugging case file',
    sql: 'Query investigation',
    graph: 'Pathfinding lab',
    proof: 'Build the argument',
    data: 'Evidence room',
    adaptive: 'Adaptive practice',
    escape: 'Exam Escape',
  };
  const moveStep = (index: number, delta: number) => {
    const next = [...order];
    const other = index + delta;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    setOrder(next);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4" aria-label={`${kindLabels[activity.kind]} activity`}>
      <header
        className={`rounded-2xl border p-5 sm:p-6 ${activity.kind === 'debug' || activity.kind === 'sql' ? 'border-slate-700 bg-slate-950 text-slate-50' : 'border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 text-slate-950'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            className={`text-xs font-extrabold uppercase tracking-[0.16em] ${activity.kind === 'debug' || activity.kind === 'sql' ? 'text-emerald-300' : 'text-emerald-900'}`}
          >
            {kindLabels[activity.kind]}
          </h3>
          {question.progress && (
            <span
              className="rounded-full border border-current/20 px-3 py-1 text-xs font-bold"
              role="status"
              aria-label={`Challenge ${question.progress.current} of ${question.progress.total}`}
            >
              Challenge {question.progress.current} / {question.progress.total}
            </span>
          )}
        </div>
        <p className="mt-3 whitespace-pre-wrap text-base font-semibold leading-7">{question.prompt}</p>
        {activity.kind === 'adaptive' && (
          <div className="mt-4 rounded-xl border border-emerald-800/15 bg-white/75 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">
              Current difficulty: {activity.level}
            </p>
            <p className="mt-1 text-sm text-slate-700">{activity.reason}</p>
            <p className="mt-2 text-xs text-slate-600">
              This adjusts practice difficulty only. It is not a calibrated mastery assessment.
            </p>
          </div>
        )}
        {activity.kind === 'escape' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-900/10 bg-amber-50 p-3">
            <span className="rounded-full bg-amber-900 px-3 py-1 text-xs font-bold text-white">
              Room {activity.position} of {activity.total}
            </span>
            <span className="font-bold text-amber-950">{activity.room}</span>
            <p className="w-full text-xs text-amber-900">
              Unlock every room to escape. A correct answer opens the next room; three incorrect answers end
              the attempt. There is no timer.
            </p>
          </div>
        )}
      </header>

      {activity.kind === 'debug' && (
        <>
          <fieldset disabled={disabled} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
            <legend className="px-2 text-sm font-bold text-slate-900">1. Select the faulty line</legend>
            <div className="space-y-2">
              {activity.lines.map((code, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Line ${index + 1}: ${code}`}
                  aria-pressed={line === index}
                  onClick={() => setLine(index)}
                  className={`flex min-h-11 w-full items-start gap-3 overflow-x-auto rounded-xl border p-3 text-left ${line === index ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200' : 'border-slate-200 bg-slate-50 hover:bg-amber-50'}`}
                >
                  <span aria-hidden="true" className="shrink-0 font-mono text-slate-500">
                    {index + 1}
                  </span>
                  <code className="whitespace-pre font-mono text-sm text-slate-950">{code || ' '}</code>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={disabled} className="rounded-2xl border border-slate-200 bg-white p-4">
            <legend className="px-2 text-sm font-bold text-slate-900">2. Choose the repair</legend>
            <div className="grid gap-2">
              {activity.repairs.map((text, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Repair ${index + 1}: ${text}`}
                  aria-pressed={repair === index}
                  onClick={() => setRepair(index)}
                  className={`min-h-11 rounded-xl border p-3 text-left font-mono text-sm ${repair === index ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-200 hover:bg-emerald-50'}`}
                >
                  {text}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className={primary}
            disabled={disabled || line === null || repair === null}
            onClick={() => {
              if (line !== null && repair !== null)
                onAction({ type: 'debug', question_id: question.id, line, repair });
            }}
          >
            Submit repair
          </button>
        </>
      )}

      {activity.kind === 'sql' && (
        <>
          <ActivityTable columns={activity.columns} rows={activity.rows} caption="Query data" />
          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950 p-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-300">
              Read-only query
            </p>
            <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-emerald-50">
              {activity.query}
            </pre>
            <p className="mt-3 text-xs text-slate-400">
              Reason about this fixed dataset. No query is executed against your account.
            </p>
          </div>
        </>
      )}

      {activity.kind === 'graph' && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-700">
            Undirected, unweighted graph. Find a shortest path from <strong>{activity.start}</strong> to{' '}
            <strong>{activity.goal}</strong>. Any shortest route is accepted.
          </p>
          <svg
            aria-hidden="true"
            viewBox="0 0 400 260"
            className="mx-auto max-h-64 w-full rounded-xl bg-emerald-50"
          >
            {activity.edges.map(([a, b], index) => {
              const ai = activity.nodes.indexOf(a),
                bi = activity.nodes.indexOf(b);
              const angle = (i: number) => (2 * Math.PI * i) / activity.nodes.length - Math.PI / 2;
              return (
                <line
                  key={index}
                  x1={200 + 145 * Math.cos(angle(ai))}
                  y1={130 + 92 * Math.sin(angle(ai))}
                  x2={200 + 145 * Math.cos(angle(bi))}
                  y2={130 + 92 * Math.sin(angle(bi))}
                  stroke="#94a3b8"
                  strokeWidth="3"
                />
              );
            })}
            {activity.nodes.map((node, index) => {
              const angle = (2 * Math.PI * index) / activity.nodes.length - Math.PI / 2;
              return (
                <g
                  key={node}
                  transform={`translate(${200 + 145 * Math.cos(angle)} ${130 + 92 * Math.sin(angle)})`}
                >
                  <circle
                    r="18"
                    fill={path.includes(node) ? '#065f46' : '#fff'}
                    stroke="#065f46"
                    strokeWidth="2"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="13"
                    fontWeight="700"
                    fill={path.includes(node) ? '#fff' : '#064e3b'}
                  >
                    {node}
                  </text>
                </g>
              );
            })}
          </svg>
          <div>
            <h4 className="text-sm font-bold text-slate-900">Connections</h4>
            <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700" aria-label="Graph connections">
              {activity.edges.length === 0 ? (
                <li>No edges</li>
              ) : (
                activity.edges.map(([a, b], index) => (
                  <li key={index} className="rounded-full bg-slate-100 px-3 py-1">
                    {a} — {b}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose path nodes">
            {activity.nodes.map((node) => (
              <button
                type="button"
                key={node}
                disabled={disabled || path.includes(node)}
                aria-label={`Node ${node}`}
                onClick={() => setPath([...path, node])}
                className={secondary}
              >
                {node}
              </button>
            ))}
          </div>
          <p role="status" className="rounded-xl bg-slate-50 p-3 font-mono text-sm text-slate-900">
            Your path: {path.length ? path.join(' → ') : 'Choose the start node, then each connected node.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || path.length === 0}
              onClick={() => onAction({ type: 'path', question_id: question.id, node_ids: path })}
              className={primary}
            >
              Submit path
            </button>
            <button
              type="button"
              disabled={disabled || path.length === 0}
              onClick={() => setPath([])}
              className={secondary}
            >
              Clear path
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAction({ type: 'path', question_id: question.id, node_ids: [] })}
              className={secondary}
            >
              No path exists
            </button>
          </div>
        </div>
      )}

      {activity.kind === 'proof' && (
        <div className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
          <p className="text-sm text-indigo-950">
            Select every step in a valid logical order. Independent steps may appear in either order.
            Rearrange your draft before checking it.
          </p>
          <div className="grid gap-2">
            {activity.steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                aria-label={`Add step ${index + 1}: ${step.text}`}
                disabled={disabled || order.includes(step.id)}
                onClick={() => setOrder([...order, step.id])}
                className={`min-h-11 rounded-xl border border-indigo-200 bg-white p-3 text-left text-sm font-semibold text-slate-900 disabled:opacity-45 ${motion}`}
              >
                {step.text}
              </button>
            ))}
          </div>
          <h4 className="text-sm font-bold text-indigo-950">Your proof order</h4>
          {order.length === 0 && (
            <p className="text-sm text-slate-600">Choose the first step to start your argument.</p>
          )}
          <ol className="space-y-2" aria-label="Your proof order">
            {order.map((id, index) => {
              const stepIndex = activity.steps.findIndex((step) => step.id === id);
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-white p-3"
                >
                  <span className="min-w-0 flex-1 text-sm text-slate-900">
                    <strong>{index + 1}.</strong> {activity.steps[stepIndex]?.text}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      aria-label={`Move step ${stepIndex + 1} up`}
                      onClick={() => moveStep(index, -1)}
                      className={secondary}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === order.length - 1}
                      aria-label={`Move step ${stepIndex + 1} down`}
                      onClick={() => moveStep(index, 1)}
                      className={secondary}
                    >
                      Down
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || order.length !== activity.steps.length}
              onClick={() => onAction({ type: 'order', question_id: question.id, step_ids: order })}
              className={primary}
            >
              Check proof
            </button>
            <button
              type="button"
              disabled={disabled || !order.length}
              onClick={() => setOrder([])}
              className={secondary}
            >
              Reset order
            </button>
          </div>
        </div>
      )}

      {activity.kind === 'data' && (
        <>
          <p className="text-sm font-semibold text-slate-700">Units: {activity.units}</p>
          <ActivityTable columns={activity.columns} rows={activity.rows} caption="Evidence data" />
        </>
      )}

      {activity.kind !== 'debug' && activity.kind !== 'graph' && activity.kind !== 'proof' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {question.choices.map((choice, index) => (
            <button
              key={index}
              type="button"
              disabled={disabled}
              onClick={() => onAction({ type: 'answer', question_id: question.id, choice: index })}
              className={`flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-default ${motion}`}
            >
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-950"
              >
                {String.fromCharCode(65 + index)}
              </span>
              {choice}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
