import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = "Murph — the AI referee for health challenges.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function PitchOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        logoDataUri={logoDataUri}
        eyebrow="MURPH"
        headline={"The AI referee for\nhealth challenges."}
        headlineFontSize={68}
        subtext="Turn any group chat into a step bet, sleep experiment, or friend challenge."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
