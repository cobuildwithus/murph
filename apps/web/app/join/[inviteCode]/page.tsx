import type { Metadata } from "next";
import { cookies } from "next/headers";

import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { resolveHostedPrivyClientAppId } from "@/src/lib/hosted-onboarding/landing";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/service";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Healthy Bob hosted invite",
  description: "Verify your phone and finish hosted Healthy Bob checkout.",
  openGraph: {
    title: "Healthy Bob hosted invite",
    description: "Verify your phone and finish hosted Healthy Bob checkout.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Healthy Bob hosted invite",
    description: "Verify your phone and finish hosted Healthy Bob checkout.",
  },
};

export default async function JoinInvitePage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const cookieStore = await cookies();
  const sessionRecord = await resolveHostedSessionFromCookieStore(cookieStore);
  const initialStatus = await buildHostedInvitePageData({
    inviteCode: decodeURIComponent(inviteCode),
    sessionRecord,
  });
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const privyAppId = resolveHostedPrivyClientAppId();
  const shareData = shareCode
    ? await buildHostedSharePageData({
        inviteCode: decodeURIComponent(inviteCode),
        shareCode,
        sessionRecord,
      })
    : null;

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl">
        <JoinInviteClient
          inviteCode={decodeURIComponent(inviteCode)}
          initialStatus={initialStatus}
          privyAppId={privyAppId}
          shareCode={shareCode}
          sharePreview={shareData?.share?.preview ?? null}
        />
      </div>
    </main>
  );
}
