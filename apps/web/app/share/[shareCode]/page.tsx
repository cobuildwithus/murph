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
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.25rem, 4vw, 2.5rem)",
        background:
          "radial-gradient(circle at top, rgba(191, 219, 254, 0.55) 0%, rgba(248, 250, 252, 1) 38%, rgba(226, 232, 240, 0.96) 100%)",
        color: "rgb(15 23 42)",
      }}
    >
      <ShareLinkClient initialData={initialData} shareCode={decodeURIComponent(shareCode)} />
    </main>
  );
}
