import { cookies } from "next/headers";

import { ShareLinkClient } from "@/src/components/hosted-share/share-link-client";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const dynamic = "force-dynamic";

export default async function HostedSharePage(input: {
  params: Promise<{ shareCode: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { shareCode } = await input.params;
  const searchParams = await input.searchParams;
  const cookieStore = await cookies();
  const sessionRecord = await resolveHostedSessionFromCookieStore(cookieStore);
  const initialData = await buildHostedSharePageData({
    shareCode: decodeURIComponent(shareCode),
    inviteCode: searchParams.invite ? decodeURIComponent(searchParams.invite) : null,
    sessionRecord,
  });

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <ShareLinkClient initialData={initialData} shareCode={decodeURIComponent(shareCode)} />
    </main>
  );
}
