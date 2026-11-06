import type { Metadata } from "next";

import { JoinInviteCheckoutPausedScreen } from "@/src/components/hosted-onboarding/join-invite-checkout-paused-screen";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { decodeURIComponentOrRaw } from "@/src/lib/http";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  // Keep the parent invite card: createMurphPageMetadata otherwise injects
  // the site default, which overrides the parent segment's dedicated image.
  // Tolerant decode: metadata must not become a new failure path for
  // malformed codes.
  const ogImage = createMurphOgImageRef({
    alt: "You’re invited to Murph.",
    url: `/join/${encodeURIComponent(decodeURIComponentOrRaw(inviteCode))}/opengraph-image`,
  });

  return createMurphPageMetadata({
    title: "Checkout paused — Murph",
    description: "Return to your Murph invite when you are ready to finish checkout.",
    openGraph: { images: [ogImage] },
    twitter: { images: [ogImage] },
  });
}

export default async function JoinInviteCancelPage(input: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await input.params;
  const href = `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}`;

  return (
    <LinkPageFrame>
      <JoinInviteCheckoutPausedScreen href={href} />
    </LinkPageFrame>
  );
}
