import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  listHealthCommonsBiomarkerRoutes,
  resolveHealthCommonsBiomarkerDetail,
} from "@/src/lib/health-commons/biomarker-detail";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { BiomarkerPageClient } from "./biomarker-page-client";

export function generateStaticParams(): Array<{ biomarkerId: string }> {
  return listHealthCommonsBiomarkerRoutes().map((biomarkerId) => ({ biomarkerId }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}): Promise<Metadata> {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerDetail(biomarkerId);

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

export default async function BiomarkerPage({
  params,
}: {
  params: Promise<{ biomarkerId: string }>;
}) {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerDetail(biomarkerId);

  if (!biomarker) {
    notFound();
  }

  if (biomarker.routeId !== biomarkerId) {
    redirect(`/biomarkers/${biomarker.routeId}`);
  }

  return <BiomarkerPageClient key={biomarker.pageRevisionId} biomarker={biomarker} />;
}
