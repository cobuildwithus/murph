import type { Metadata } from "next";

import { buildJoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import { JoinInvitePageView } from "@/src/components/hosted-onboarding/join-invite-page-view";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

const JOIN_INVITE_METADATA_DESCRIPTION =
  "Finish signup, then add a phone number or connect Telegram so Murph can reach you.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  const ogImage = {
    alt: "You’re invited to Murph.",
    height: 630,
    type: "image/png",
    url: `/join/${encodeURIComponent(inviteCode)}/opengraph-image`,
    width: 1200,
  } as const;

  return createMurphPageMetadata({
    title: "Murph invite",
    description: JOIN_INVITE_METADATA_DESCRIPTION,
    openGraph: { images: [ogImage] },
    twitter: { images: [ogImage] },
  });
}

export default async function JoinInvitePage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const model = await buildJoinInvitePageModel({
    inviteCode: decodedInviteCode,
    preview: searchParams.preview,
  });

  return <JoinInvitePageView model={model} />;
}
