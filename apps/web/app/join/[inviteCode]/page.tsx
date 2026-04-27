import type { Metadata } from "next";

import { HostedPhoneCountryCodeBoundary } from "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary";
import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import {
  buildJoinInvitePreviewStatus,
  parseJoinInvitePreviewStage,
} from "@/src/components/hosted-onboarding/join-invite-preview";
import { JoinInviteShell } from "@/src/components/hosted-onboarding/join-invite-shell";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

const JOIN_INVITE_METADATA_DESCRIPTION =
  "Finish signup, then add a phone number or connect Telegram so Murph can reach you.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph hosted invite",
  description: JOIN_INVITE_METADATA_DESCRIPTION,
});

export default async function JoinInvitePage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string; preview?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const previewStage =
    process.env.NODE_ENV !== "production"
      ? parseJoinInvitePreviewStage(searchParams.preview)
      : null;

  if (previewStage) {
    return (
      <HostedPhoneCountryCodeBoundary>
        <JoinInviteShell>
          <JoinInviteClient
            initialLinkedAccounts={[]}
            inviteCode={decodedInviteCode}
            initialStatus={buildJoinInvitePreviewStatus(previewStage, decodedInviteCode)}
            shareCode={null}
            sharePreview={null}
            preview
          />
        </JoinInviteShell>
      </HostedPhoneCountryCodeBoundary>
    );
  }

  const { authenticatedMember, linkedAccounts } = await getHostedPageAuthSnapshot();
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember,
    inviteCode: decodedInviteCode,
  });
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const shareData = shareCode
    ? await buildHostedSharePageData({
        authenticatedMember,
        inviteCode: decodedInviteCode,
        shareCode,
      })
    : null;

  return (
    <HostedPhoneCountryCodeBoundary>
      <JoinInviteShell>
        <JoinInviteClient
          initialLinkedAccounts={linkedAccounts}
          inviteCode={decodedInviteCode}
          initialStatus={initialStatus}
          shareCode={shareCode}
          sharePreview={shareData?.share?.preview ?? null}
        />
      </JoinInviteShell>
    </HostedPhoneCountryCodeBoundary>
  );
}
