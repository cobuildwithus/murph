import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../../_og/og-shared";

export const alt = "You’re invited to Murph Family.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function FamilyInviteOGImage() {
  const { fonts, heroDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        heroDataUri={heroDataUri}
        eyebrow="MURPH FAMILY"
        headline="You’re invited."
        subtext="Your own private health assistant, covered by someone you know."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
