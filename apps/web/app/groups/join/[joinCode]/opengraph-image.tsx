import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../../_og/og-shared";

export const alt = "Join the group on Murph.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function GroupJoinOGImage() {
  const { fonts, heroDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        heroDataUri={heroDataUri}
        eyebrow="MURPH GROUP"
        headline="Join the challenge."
        subtext="Health experiments with friends. Your data stays yours."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
