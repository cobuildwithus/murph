import type { Metadata } from "next";
import { cookies } from "next/headers";

import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import {
  resolveHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const metadata: Metadata = {
  title: "Murph hosted invite",
  description: "Verify your phone and finish hosted Murph checkout.",
  openGraph: {
    title: "Murph hosted invite",
    description: "Verify your phone and finish hosted Murph checkout.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Murph hosted invite",
    description: "Verify your phone and finish hosted Murph checkout.",
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
  const privyClientId = resolveHostedPrivyClientId();
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
          privyClientId={privyClientId}
          shareCode={shareCode}
          sharePreview={shareData?.share?.preview ?? null}
        />
      </div>
    </main>
  );
}
