import type { Metadata } from "next";

import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";

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
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember: null,
    inviteCode: decodedInviteCode,
  });
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const shareData = shareCode
    ? await buildHostedSharePageData({
        authenticatedMember: null,
        inviteCode: decodedInviteCode,
        shareCode,
      })
    : null;

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl">
        <JoinInviteClient
          inviteCode={decodedInviteCode}
          initialStatus={initialStatus}
          shareCode={shareCode}
          sharePreview={shareData?.share?.preview ?? null}
        />
      </div>
    </main>
  );
}
