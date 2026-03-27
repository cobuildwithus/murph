export const dynamic = "force-dynamic";

export default async function JoinInviteCancelPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const href = `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-xl space-y-5 rounded-lg bg-white p-8 shadow-sm md:p-10">
        <div className="flex h-12 w-12 items-center justify-center rounded bg-amber-50">
          <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
          Checkout paused
        </h1>
        <p className="leading-relaxed text-stone-500">
          Your verified phone session is still ready. Jump back to the invite page whenever you want to finish
          checkout.
        </p>
        <a
          href={href}
          className="inline-flex rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light"
        >
          Return to invite
        </a>
      </section>
    </main>
  );
}
