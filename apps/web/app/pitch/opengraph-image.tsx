import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = "Murph, the private personal health assistant that remembers.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function PitchOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        logoDataUri={logoDataUri}
        eyebrow="MURPH"
        headline={"The personal health assistant\nthat remembers."}
        headlineFontSize={68}
        subtext="Private help now, with useful health context that compounds over time."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
