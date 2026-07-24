import type { Metadata } from "next";

import {
  FamilyInviteScreen,
  type FamilyInviteView,
} from "@/src/components/family/family-invite-screen";
import { JoinInviteCenteredShell } from "@/src/components/hosted-onboarding/join-invite-shell";
import { readConfiguredMurphPhoneNumbers } from "@/src/lib/device-sync/messaging-return-destination";
import {
  buildHostedFamilyInviteMessagesHref,
  readHostedFamilyInviteAcceptanceView,
} from "@/src/lib/hosted-onboarding/family-plan";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  const inviteOpenGraphImage = {
    alt: "You’re invited to Murph Family.",
    height: 630,
    type: "image/png",
    url: `/family/accept/${encodeURIComponent(inviteCode)}/opengraph-image`,
    width: 1200,
  } as const;

  return {
    ...createMurphPageMetadata({
      title: "Family invite · Murph",
      description: "Join a Murph Family plan.",
      openGraph: { images: [inviteOpenGraphImage] },
      twitter: { images: [inviteOpenGraphImage] },
    }),
    robots: { follow: false, index: false },
  };
}

export default async function FamilyAcceptPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await params;
  const [view, auth] = await Promise.all([
    readHostedFamilyInviteAcceptanceView({ inviteCode }),
    getHostedPageAuthSnapshot(),
  ]);

  return (
    <JoinInviteCenteredShell>
      <FamilyInviteScreen
        authenticated={auth.authenticated}
        messagesAcceptHref={resolveMessagesAcceptHref(view)}
        view={view}
      />
    </JoinInviteCenteredShell>
  );
}

// The invitee accepts by texting Murph the family token. Phone-bound invites
// prefer the line an existing member already messages on; unbound invites fall
// back to a configured line and the webhook assigns a home line on first
// contact.
function resolveMessagesAcceptHref(view: FamilyInviteView): string | null {
  if (!view) {
    return null;
  }
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  if (!view.isPhoneBound && !isFullyUnbound) {
    return null;
  }
  const murphPhoneNumber =
    view.messagesRecipientPhone ?? readConfiguredMurphPhoneNumbers()[0] ?? null;
  if (!murphPhoneNumber) {
    return null;
  }
  return buildHostedFamilyInviteMessagesHref({
    inviteCode: view.inviteCode,
    murphPhoneNumber,
  });
}
