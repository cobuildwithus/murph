export default function JoinInviteLoading() {
  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl">
        <section className="space-y-5 rounded-lg bg-white p-6 shadow-sm md:p-8">
          <span className="inline-block rounded bg-olive/10 px-3.5 py-1.5 text-sm font-semibold text-olive">
            Loading invite
          </span>
          <div className="space-y-3">
            <div className="h-12 w-3/4 animate-pulse rounded bg-stone-200 md:h-14" />
            <div className="h-5 w-full animate-pulse rounded bg-stone-100" />
            <div className="h-5 w-5/6 animate-pulse rounded bg-stone-100" />
          </div>
          <div className="space-y-3 rounded border border-stone-200/60 bg-stone-50/70 p-5">
            <div className="h-10 w-full animate-pulse rounded bg-stone-200" />
            <div className="h-10 w-full animate-pulse rounded bg-stone-100" />
            <div className="h-10 w-2/3 animate-pulse rounded bg-stone-100" />
          </div>
        </section>
      </div>
    </main>
  );
}
