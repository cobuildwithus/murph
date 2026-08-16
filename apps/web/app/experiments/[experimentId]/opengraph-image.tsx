import { ImageResponse } from "next/og";

import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";

import {
  loadMurphHeroOgAssets,
  MurphHeroOg,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";

export const alt = "A Murph experiment.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

function resolveHeadlineFontSize(title: string): number {
  if (title.length > 40) return 52;
  if (title.length > 26) return 62;
  if (title.length > 16) return 74;
  return 82;
}

export default async function ExperimentOGImage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const shell = resolveHealthCommonsExperimentShell(experimentId);
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();
  const headline = shell?.title ?? "Run an experiment.";

  return new ImageResponse(
    (
      <MurphHeroOg
        logoDataUri={logoDataUri}
        eyebrow="MURPH EXPERIMENT"
        headline={headline}
        headlineFontSize={resolveHeadlineFontSize(headline)}
        subtext="See what the evidence says, then run it yourself."
      />
    ),
    { ...OG_SIZE, fonts }
  );
}
