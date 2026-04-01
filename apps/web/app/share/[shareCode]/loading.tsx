export default function HostedShareLoading() {
  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <section className="mx-auto w-full max-w-2xl space-y-5 rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <span className="inline-block rounded-full bg-green-50 px-3.5 py-1.5 text-sm font-semibold text-green-700">
          Loading share
        </span>
        <div className="space-y-3">
          <div className="h-12 w-2/3 animate-pulse rounded bg-stone-200 md:h-14" />
          <div className="h-5 w-full animate-pulse rounded bg-stone-100" />
          <div className="h-5 w-4/5 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="space-y-3 rounded-xl border border-stone-200/60 bg-stone-50/60 p-4">
          <div className="h-6 w-1/2 animate-pulse rounded bg-stone-200" />
          <div className="h-4 w-full animate-pulse rounded bg-stone-100" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-stone-100" />
        </div>
      </section>
    </main>
  );
}
