import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../../_og/og-shared";

export const alt = "Join your people on Murph.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function GroupJoinOGImage() {
  const { fonts, heroDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        heroDataUri={heroDataUri}
        eyebrow="MURPH GROUP"
        headline="Join your people."
        subtext="Get healthier together. You choose what you share."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
