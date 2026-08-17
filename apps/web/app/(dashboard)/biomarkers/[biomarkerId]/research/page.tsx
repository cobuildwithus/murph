import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BiomarkerResearch } from "@/src/components/biomarkers/biomarker-detail/biomarker-research";
import { resolveHealthCommonsBiomarkerResearch } from "@/src/lib/health-commons/biomarker-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

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

  // Pass the parent biomarker card through explicitly: createMurphPageMetadata
  // otherwise injects the site default, which overrides the parent segment's
  // file-convention image and unfurls the homepage card here.
  const ogImage = createMurphOgImageRef({
    alt: `${biomarker.title}, a Murph biomarker.`,
    url: `/biomarkers/${encodeURIComponent(biomarkerId)}/opengraph-image`,
  });

  return createMurphPageMetadata({
    alternates: {
      canonical: `/biomarkers/${encodeURIComponent(biomarker.routeId)}/research`,
    },
    description: `Evidence and Commons memo for ${biomarker.title}.`,
    openGraph: {
      type: "article",
      images: [ogImage],
    },
    twitter: { images: [ogImage] },
    title: `${biomarker.title} research | Murph Biomarkers`,
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
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
