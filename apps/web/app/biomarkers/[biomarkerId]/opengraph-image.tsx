import { ImageResponse } from "next/og";

import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";

export const alt = "A Murph biomarker.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

function resolveHeadlineFontSize(title: string): number {
  if (title.length > 40) return 52;
  if (title.length > 26) return 62;
  if (title.length > 16) return 74;
  return 82;
}

export default async function BiomarkerOGImage({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}) {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerOverview(biomarkerId);
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();
  const headline = biomarker?.title ?? "Understand your biomarkers.";

  return new ImageResponse(
    (
      <MurphHeroOg
        logoDataUri={logoDataUri}
        eyebrow="MURPH BIOMARKER"
        headline={headline}
        headlineFontSize={resolveHeadlineFontSize(headline)}
        subtext="What it means, how to move it, and what the evidence says."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
