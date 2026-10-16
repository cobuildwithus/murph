import type { Metadata } from "next";
import { cache } from "react";

import { readInvitePreview } from "@/src/lib/game/service";
import { resolveDecodedRouteParam } from "@/src/lib/http";

import { GameInviteView } from "./game-invite-view";

export const dynamic = "force-dynamic";

type GameInvitePageProps = { params: Promise<{ token: string }> };

// Metadata and the page share one read per request.
const readPreview = cache(readInvitePreview);

export async function generateMetadata(props: GameInvitePageProps): Promise<Metadata> {
  const preview = await readPreview(await resolveDecodedRouteParam(props.params, "token"));
  return {
    description: "Open it in Murph to accept.",
    referrer: "no-referrer",
    robots: { follow: false, index: false },
    title: preview ? `${preview.inviterFirstName} challenged you` : "Murph",
  };
}

export default async function GameInvitePage(props: GameInvitePageProps) {
  const token = await resolveDecodedRouteParam(props.params, "token");
  return (
    <main className="min-h-dvh bg-background px-6 py-7 text-foreground sm:px-10 sm:py-9">
      <GameInviteView preview={await readPreview(token)} token={token} />
    </main>
  );
}
