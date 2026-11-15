export default function Loading() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl space-y-4 p-8"
      aria-busy="true"
      aria-label="Loading page"
    >
      <p className="sr-only" role="status">Loading page</p>
      <div aria-hidden="true" className="h-8 w-48 animate-pulse rounded bg-neutral-200" />
      <div aria-hidden="true" className="h-24 animate-pulse rounded border bg-neutral-100" />
      <div aria-hidden="true" className="h-24 animate-pulse rounded border bg-neutral-100" />
    </main>
  );
}
