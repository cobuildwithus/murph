import type { Metadata } from "next";

import { buildJoinInvitePageModel } from "@/src/components/hosted-onboarding/join-invite-page-model";
import { JoinInvitePageView } from "@/src/components/hosted-onboarding/join-invite-page-view";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

const JOIN_INVITE_METADATA_DESCRIPTION =
  "Finish signup, then add a phone number or connect Telegram so Murph can reach you.";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph invite",
  description: JOIN_INVITE_METADATA_DESCRIPTION,
});

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
