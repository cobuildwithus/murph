import Link from "next/link";

export default async function JoinInviteSuccessPage(input: {
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
        <div className="flex h-12 w-12 items-center justify-center rounded bg-olive/10">
          <svg className="h-6 w-6 text-olive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
          Payment received
        </h1>
        <p className="leading-relaxed text-stone-500">
          We&apos;re finishing hosted activation now. Head back to your invite page and it will show when the
          subscription state turns active.
        </p>
        <Link
          href={href}
          className="inline-flex rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light"
        >
          Return to Murph
        </Link>
      </section>
    </main>
  );
}
