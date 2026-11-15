export default function PrivacyPage() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-5 p-8">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p>StudyVault uses your uploaded material to provide chapters, summaries, chat, and flashcards.</p>
      <section>
        <h2 className="text-xl font-semibold">Data we store</h2>
        <p className="mt-1">
          We store your account identifier, uploaded document text, generated study content, reviews, focus
          sessions, and usage records needed to run the service.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Retention and control</h2>
        <p className="mt-1">
          Original PDF bytes are cleared after parsing. Your account data remains until you delete it.
          Signed-in users can export their data or permanently delete their account from the Account page.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-semibold">AI providers</h2>
        <p className="mt-1">
          Relevant document excerpts and questions are sent to the configured AI provider only to produce the
          requested study feature. Never include secrets in uploads.
        </p>
      </section>
    </main>
  );
}
