import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";

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
        subtext="Your personal health assistant. See what actually makes you healthier."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
