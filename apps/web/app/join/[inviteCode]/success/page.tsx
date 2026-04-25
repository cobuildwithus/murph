import type { Metadata } from "next";

import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import {
  buildJoinInvitePreviewStatus,
  parseJoinInvitePreviewStage,
} from "@/src/components/hosted-onboarding/join-invite-preview";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { JoinInviteShell } from "@/src/components/hosted-onboarding/join-invite-shell";
import { JoinInviteSuccessClient } from "@/src/components/hosted-onboarding/join-invite-success-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Finishing setup — Murph",
  description: "Finish activating your Murph hosted account after checkout.",
});

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ session_id?: string; share?: string; preview?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const sessionId = typeof searchParams.session_id === "string"
    ? decodeURIComponent(searchParams.session_id)
    : null;

  const previewStage =
    process.env.NODE_ENV !== "production"
      ? parseJoinInvitePreviewStage(searchParams.preview)
      : null;

  if (previewStage) {
    return (
      <JoinInviteShell>
        <JoinInviteSuccessClient
          initialStatus={buildJoinInvitePreviewStatus(previewStage, decodedInviteCode)}
          inviteCode={decodedInviteCode}
          sessionId={null}
          shareCode={null}
          preview
        />
      </JoinInviteShell>
    );
  }

  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember,
    inviteCode: decodedInviteCode,
  });

  return (
    <JoinInviteShell>
      <JoinInviteSuccessClient
        initialStatus={initialStatus}
        inviteCode={decodedInviteCode}
        sessionId={sessionId}
        shareCode={shareCode}
      />
    </JoinInviteShell>
  );
}
