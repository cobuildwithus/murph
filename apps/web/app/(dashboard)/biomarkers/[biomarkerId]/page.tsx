import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BiomarkerOverview } from "@/src/components/biomarkers/biomarker-detail/biomarker-overview";
import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}): Promise<Metadata> {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerOverview(biomarkerId);

  if (!biomarker) {
    return {};
  }

  return createMurphPageMetadata({
    description: biomarker.summary,
    openGraph: {
      type: "article",
    },
    title: `${biomarker.title} | Murph Biomarkers`,
  });
}

export default async function BiomarkerOverviewPage({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerOverview(biomarkerId);

  if (!biomarker) {
    notFound();
  }

  if (biomarker.routeId !== biomarkerId) {
    redirect(`/biomarkers/${biomarker.routeId}`);
  }

  return <BiomarkerOverview biomarker={biomarker} />;
}
