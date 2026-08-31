import { ImageResponse } from "next/og";

import { COMPARISONS } from "@/src/lib/comparisons/catalog";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = "Murph personal health assistant comparison guides.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ComparisonIndexOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        eyebrow="MURPH · PERSONAL HEALTH ASSISTANT"
        headline="Murph, compared clearly."
        headlineFontSize={74}
        logoDataUri={logoDataUri}
        subtext={`${COMPARISONS.length} source-backed guides to the health tools you already know.`}
      />
    ),
    { ...OG_SIZE, fonts },
  );
}
