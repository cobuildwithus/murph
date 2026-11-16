import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CustomConnectionConfirm } from "@/src/components/custom-connections/custom-connections-confirm";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { LinkPageSignIn } from "@/src/components/link-page/link-page-sign-in";
import { readCustomConnectionsPageAccess } from "@/src/lib/custom-connections/access";
import { readActionRequestView } from "@/src/lib/custom-connections/action-requests";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Check a change — Murph",
    description: "Murph wants your OK before it changes something in an MCP server.",
  }),
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

/** One change Murph asked to make in an MCP server. Nothing runs until the signed-in member says so here. */
export default async function CustomConnectionConfirmPage({ params }: { params: Promise<{ requestId: string }> }) {
  const access = await readCustomConnectionsPageAccess();
  if (access === "signed_out") {
    return <LinkPageSignIn detail="Murph wants your OK before it changes something for you." title="Sign in to check this." />;
  }
  // Another member's request, or one that never existed, is simply not here.
  const request = await readActionRequestView(access.memberId, (await params).requestId);
  if (!request) notFound();
  return (
    <LinkPageFrame fit>
      <CustomConnectionConfirm request={request} />
    </LinkPageFrame>
  );
}
