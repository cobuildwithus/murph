import type { Metadata } from "next";

import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import {
  buildJoinInvitePreviewStatus,
  parseJoinInvitePreviewStage,
} from "@/src/components/hosted-onboarding/join-invite-preview";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";
import { JoinInviteSuccessClient } from "@/src/components/hosted-onboarding/join-invite-success-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  // Keep the parent invite card: createMurphPageMetadata otherwise injects
  // the site default, which overrides the parent segment's dedicated image.
  const ogImage = createMurphOgImageRef({
    alt: "You’re invited to Murph.",
    url: `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}/opengraph-image`,
  });

  return createMurphPageMetadata({
    title: "Finishing setup — Murph",
    description: "Finish setting up your Murph account after checkout.",
    openGraph: { images: [ogImage] },
    twitter: { images: [ogImage] },
  });
}

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ session_id?: string; preview?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponentOrRaw(inviteCode);
  const sessionId = typeof searchParams.session_id === "string"
    ? decodeURIComponentOrRaw(searchParams.session_id)
    : null;

  const previewStage =
    process.env.NODE_ENV !== "production"
      ? parseJoinInvitePreviewStage(searchParams.preview)
      : null;

  if (previewStage) {
    return (
      <JoinInviteSuccessClient
        initialStatus={buildJoinInvitePreviewStatus(previewStage, decodedInviteCode)}
        inviteCode={decodedInviteCode}
        sessionId={null}
        preview
      />
    );
  }

  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember,
    inviteCode: decodedInviteCode,
  });

  return (
    <JoinInviteSuccessClient
      initialStatus={initialStatus}
      inviteCode={decodedInviteCode}
      sessionId={sessionId}
    />
  );
}

function decodeURIComponentOrRaw(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
