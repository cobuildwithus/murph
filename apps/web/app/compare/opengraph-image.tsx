import { ImageResponse } from "next/og";

import { COMPARISONS } from "@/src/lib/comparisons/catalog";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = "Murph comparison guides.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ComparisonIndexOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        eyebrow="MURPH COMPARISON GUIDES"
        headline="Murph, compared clearly."
        headlineFontSize={74}
        logoDataUri={logoDataUri}
        subtext={`${COMPARISONS.length} source-verified guides to the health tools you already know.`}
      />
    ),
    { ...OG_SIZE, fonts },
  );
}
