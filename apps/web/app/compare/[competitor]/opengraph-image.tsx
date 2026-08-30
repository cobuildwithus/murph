import { ImageResponse } from "next/og";

import { getComparisonByRouteSegment } from "@/src/lib/comparisons/catalog";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";

export const alt = "A Murph comparison guide.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

function resolveHeadlineFontSize(headline: string): number {
  if (headline.length > 34) return 54;
  if (headline.length > 24) return 62;
  return 72;
}

export default async function ComparisonOGImage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const comparison = getComparisonByRouteSegment((await params).competitor);
  const headline = comparison ? `Murph vs ${comparison.name}` : "Murph comparison guide";
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(
    (
      <MurphHeroOg
        eyebrow="MURPH COMPARISON GUIDE"
        headline={headline}
        headlineFontSize={resolveHeadlineFontSize(headline)}
        logoDataUri={logoDataUri}
        subtext={comparison?.headline ?? "A source-verified look at where the products differ."}
        subtextFontSize={20}
      />
    ),
    { ...OG_SIZE, fonts },
  );
}
