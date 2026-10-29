// Shown while the history is fetched: same footprint as the real list, so nothing jumps
export default function HistoryLoading() {
  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-8"
      aria-busy
    >
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <div className="skeleton h-3 w-40 rounded-full" />
          <div className="skeleton mt-4 h-3 w-full rounded-full" />
          <div className="skeleton mt-2 h-3 w-2/3 rounded-full" />
        </div>
      ))}
    </main>
  );
}
