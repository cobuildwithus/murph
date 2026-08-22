import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BiomarkerOverview } from "@/src/components/biomarkers/biomarker-detail/biomarker-overview";
import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

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

  const ogImage = {
    alt: `${biomarker.title}, a Murph biomarker.`,
    height: 630,
    type: "image/png",
    url: `/biomarkers/${encodeURIComponent(biomarkerId)}/opengraph-image`,
    width: 1200,
  } as const;

  return createMurphPageMetadata({
    alternates: {
      canonical: `/biomarkers/${encodeURIComponent(biomarker.routeId)}`,
    },
    description: biomarker.summary,
    openGraph: {
      images: [ogImage],
      type: "article",
    },
    title: `${biomarker.title} | Murph Biomarkers`,
    twitter: {
      images: [ogImage],
    },
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
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
