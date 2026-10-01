import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = "Murph — your personal AI health team.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function PitchOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        logoDataUri={logoDataUri}
        eyebrow="MURPH"
        headline={"Your personal\nAI health team."}
        headlineFontSize={68}
        subtext="Murph learns from your wearables and bloodwork, texts you first, and helps you follow through."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
