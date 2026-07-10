import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";
import {
  MURPH_TAGLINE_LINE_1,
  MURPH_TAGLINE_LINE_2,
} from "@/src/lib/site-metadata";

export const alt = "You’re invited to Murph.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function JoinInviteOGImage() {
  const { fonts, heroDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        heroDataUri={heroDataUri}
        eyebrow="MURPH"
        headline="You’re invited."
        subtext={`${MURPH_TAGLINE_LINE_1} ${MURPH_TAGLINE_LINE_2}`}
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
