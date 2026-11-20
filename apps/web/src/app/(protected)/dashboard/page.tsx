import { auth, currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { documents, flashcards, focusSessions, tokenLedger } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';
import { GameVaultLink } from '@/components/game-vault-link';

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const [clerkUser, user] = await Promise.all([currentUser(), getUserByClerkId(userId)]);
  const recentDocuments = user
    ? await getDb()
        .select({
          id: documents.id,
          filename: documents.filename,
          status: documents.status,
          pages: documents.pageCount,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(eq(documents.userId, user.id))
        .orderBy(desc(documents.updatedAt))
        .limit(4)
    : [];
  const [dueCards, focusTotals, tokenTotals] = user
    ? await Promise.all([
        getDb()
          .select({ value: sql<number>`count(*)::int` })
          .from(flashcards)
          .where(
            and(
              eq(flashcards.userId, user.id),
              sql`${flashcards.dueDate} <= to_char(current_date, 'YYYY-MM-DD')`,
            ),
          ),
        getDb()
          .select({ value: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int` })
          .from(focusSessions)
          .where(
            and(
              eq(focusSessions.userId, user.id),
              eq(focusSessions.status, 'completed'),
              sql`${focusSessions.startedAt} >= now() - interval '7 days'`,
            ),
          ),
        getDb()
          .select({ value: sql<number>`coalesce(sum(${tokenLedger.amount}), 0)::int` })
          .from(tokenLedger)
          .where(eq(tokenLedger.userId, user.id)),
      ])
    : [[], [], []];
  const dueCount = dueCards[0]?.value ?? 0;
  const focusMinutes = Math.floor((focusTotals[0]?.value ?? 0) / 60);
  const tokenBalance = tokenTotals[0]?.value ?? 0;
  const firstName = clerkUser?.firstName?.trim() || 'there';
  const greeting = firstName === 'there' ? 'Welcome to your study space' : `Welcome back, ${firstName}`;

  return (
    <main className="workspace-page coast-dashboard">
      <section className="dashboard-welcome">
        <div>
          <p className="page-kicker">YOUR LEARNING DESK</p>
          <h1 className="dashboard-greeting">{greeting}</h1>
          <p className="page-subtitle">
            Pick up a course, practice what you know, or make room for your next idea.
          </p>
        </div>
        <Link className="action-primary" href="/library">
          Add study material <span aria-hidden="true">+</span>
        </Link>
      </section>

      <section className="dashboard-resume" aria-label="Continue studying">
        <div className="dashboard-resume-copy">
          <p className="dashboard-resume-kicker">CONTINUE YOUR STUDY LOOP</p>
          <h2>{recentDocuments[0] ? recentDocuments[0].filename : 'Your next idea starts here.'}</h2>
          <p>
            {recentDocuments[0]
              ? 'Return to your material, chapter summaries, and cited answers.'
              : 'Add a PDF and turn it into chapters, summaries, and practice.'}
          </p>
          <Link
            className="dashboard-resume-action"
            href={
              recentDocuments[0]
                ? '/tutor?documentId=' + encodeURIComponent(recentDocuments[0].id)
                : '/library'
            }
          >
            {recentDocuments[0] ? 'Resume studying' : 'Choose a PDF'} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="dashboard-book-art" aria-hidden="true">
          <div className="dashboard-book-orbit" />
          <div className="dashboard-book-page">
            <span>STUDY NOTES</span>
            <i />
            <i />
            <b>KEY IDEA</b>
            <i />
          </div>
          <span className="dashboard-book-spark">✳</span>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Study summary">
        <article className="dashboard-metric">
          <span className="metric-label">RECENT COURSES</span>
          <strong className="metric-value">{recentDocuments.length}</strong>
          <span className="metric-foot">recent courses shown</span>
        </article>
        <article className="dashboard-metric dashboard-metric-warm">
          <span className="metric-label">RECALL PRACTICE</span>
          <strong className="metric-value">{dueCount}</strong>
          <span className="metric-foot">flashcards due today</span>
        </article>
        <article className="dashboard-metric dashboard-metric-green">
          <span className="metric-label">FOCUS · 7 DAYS</span>
          <strong className="metric-value">
            {focusMinutes}
            <span className="metric-unit"> min</span>
          </strong>
          <span className="metric-foot">completed focus sessions</span>
        </article>
        <Link href="/progress" className="dashboard-metric dashboard-metric-green dashboard-metric-link">
          <span className="metric-label">STUDY TOKENS</span>
          <strong className="metric-value">{tokenBalance}</strong>
          <span className="metric-foot">earned by studying · view progress →</span>
        </Link>
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-library surface">
          <div className="dashboard-section-head">
            <div>
              <p className="page-kicker">YOUR MATERIAL</p>
              <h2 className="section-heading">Recent courses</h2>
            </div>
            <Link className="small-link" href="/library">
              Open library <span aria-hidden="true">→</span>
            </Link>
          </div>

          {recentDocuments.length === 0 ? (
            <div className="dashboard-empty">
              <span className="empty-index" aria-hidden="true">
                01
              </span>
              <div>
                <h3>Your first mini-course starts with a PDF</h3>
                <p>
                  Upload lecture notes or a textbook chapter. EduSphere will structure it into lessons,
                  summaries, and practice.
                </p>
                <Link className="action-secondary" href="/library">
                  Choose a PDF <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          ) : (
            <ul className="document-list">
              {recentDocuments.map((document, index) => (
                <li key={document.id} className="document-list-item">
                  <span className={`document-list-index document-index-${index % 3}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="document-list-main">
                    <h3>{document.filename}</h3>
                    <p>
                      {document.pages ? `${document.pages} pages` : 'PDF material'}{' '}
                      <span aria-hidden="true">·</span> {document.status}
                    </p>
                  </div>
                  <Link
                    href={`/tutor?documentId=${encodeURIComponent(document.id)}`}
                    className="action-secondary"
                  >
                    {document.status === 'parsed' ? 'Study' : 'Open'} <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="dashboard-next">
          <p className="page-kicker">CHOOSE A NEXT STEP</p>
          <h2 className="section-heading">A little practice goes a long way.</h2>
          <p className="section-caption">
            Short, useful sessions fit between classes, work, and the rest of your day.
          </p>
          <div className="dashboard-shortcuts">
            <Link
              href={
                recentDocuments[0]
                  ? `/tutor?documentId=${encodeURIComponent(recentDocuments[0].id)}`
                  : '/library'
              }
              className="shortcut-row"
            >
              <span className="shortcut-no">01</span>
              <span>
                <strong>Learn with your AI tutor</strong>
                <small>Guided lessons, explanations, and viva practice</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/review" className="shortcut-row">
              <span className="shortcut-no">02</span>
              <span>
                <strong>Recall with flashcards</strong>
                <small>Practice due cards with spaced repetition</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
            <GameVaultLink className="shortcut-row">
              <span className="shortcut-no">03</span>
              <span>
                <strong>Play a logic challenge</strong>
                <small>Sorting, N-Queens, Hanoi, and more</small>
              </span>
              <span aria-hidden="true">→</span>
            </GameVaultLink>
          </div>
        </aside>
      </section>
    </main>
  );
}
