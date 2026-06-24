import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BiomarkerResearch } from "@/src/components/biomarkers/biomarker-detail/biomarker-research";
import { resolveHealthCommonsBiomarkerResearch } from "@/src/lib/health-commons/biomarker-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}): Promise<Metadata> {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerResearch(biomarkerId);

  if (!biomarker) {
    return {};
  }

  return createMurphPageMetadata({
    description: `Evidence and Commons memo for ${biomarker.title}.`,
    openGraph: {
      type: "article",
    },
    title: `${biomarker.title} research | Murph Biomarkers`,
  });
}

export default async function BiomarkerResearchPage({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerResearch(biomarkerId);

  if (!biomarker) {
    notFound();
  }

  if (biomarker.routeId !== biomarkerId) {
    redirect(`/biomarkers/${biomarker.routeId}/research`);
  }

  return <BiomarkerResearch biomarker={biomarker} />;
}
