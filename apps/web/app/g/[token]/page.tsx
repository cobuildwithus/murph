import type { Metadata } from "next";
import { cache } from "react";

import { gameInviteAppUrl } from "@/src/lib/game/access";
import { readInvitePreview } from "@/src/lib/game/service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { createMurphOgImageRef, createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

import { GameInviteView } from "./game-invite-view";
import { inviteShareCopy } from "./invite-copy";

export const dynamic = "force-dynamic";

type GameInvitePageProps = { params: Promise<{ token: string }> };

// Metadata and the page share one read per request.
const readPreview = cache((token: string) => readInvitePreview(token, true));

/**
 * The link preview Messages shows: an open invite's challenge, or just that a
 * closed one isn't available. The card image is this route's own, passed
 * explicitly so the site-wide default never stands in for it.
 */
export async function generateMetadata(props: GameInvitePageProps): Promise<Metadata> {
  const token = await resolveDecodedRouteParam(props.params, "token");
  const copy = inviteShareCopy(await readPreview(token));
  const image = createMurphOgImageRef({ alt: copy.title, url: `/g/${encodeURIComponent(token)}/opengraph-image` });
  return {
    ...createMurphPageMetadata({
      description: copy.description,
      openGraph: { images: [image], type: "website" },
      robots: MURPH_NOINDEX_PAGE_ROBOTS,
      title: copy.title,
      twitter: { images: [image] },
    }),
    referrer: "no-referrer",
  };
}

export default async function GameInvitePage(props: GameInvitePageProps) {
  const token = await resolveDecodedRouteParam(props.params, "token");
  return (
    <main className="flex min-h-dvh flex-col bg-[#1C1915]">
      {/* The night ground reaches past the page: overscroll and Safari's bars. */}
      <style>{"html,body{background:#1C1915}"}</style>
      <GameInviteView appUrl={gameInviteAppUrl(token)} preview={await readPreview(token)} />
    </main>
  );
}
