import { ImageResponse } from "next/og";

import { readInvitePreview } from "@/src/lib/game/service";
import { resolveDecodedRouteParam } from "@/src/lib/http";

import { loadMurphHeroOgAssets, OG_CONTENT_TYPE, OG_SIZE } from "../../_og/og-shared";
import { GAME_INVITE_OG_ALT, GameInviteShareCard } from "./invite-share-card";

export const alt = GAME_INVITE_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// The card follows the invite's live state, so it's never prerendered or cached.
export const dynamic = "force-dynamic";

export default async function GameInviteOGImage(props: { params: Promise<{ token: string }> }) {
  const preview = await readInvitePreview(await resolveDecodedRouteParam(props.params, "token"));
  const { fonts } = await loadMurphHeroOgAssets();
  return new ImageResponse(<GameInviteShareCard preview={preview} />, {
    ...OG_SIZE,
    fonts,
    headers: { "Cache-Control": "no-store" },
  });
}
