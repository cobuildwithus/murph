import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  listHealthCommonsBiomarkerRoutes,
  resolveHealthCommonsBiomarkerDetail,
} from "@/src/lib/health-commons/biomarker-detail";
import { BiomarkerLayoutClient } from "./biomarker-layout-client";

export function generateStaticParams(): Array<{ biomarkerId: string }> {
  return listHealthCommonsBiomarkerRoutes().map((biomarkerId) => ({ biomarkerId }));
}

export default async function BiomarkerDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ biomarkerId: string }>;
}) {
  const { biomarkerId } = await params;
  const biomarker = resolveHealthCommonsBiomarkerDetail(biomarkerId);

  if (!biomarker) {
    notFound();
  }

  // Alias redirects (e.g. /biomarkers/spo2 → /biomarkers/blood-oxygen-spo2)
  // happen in the leaf pages so each route preserves its own subpath
  // (Overview vs Research) instead of always redirecting to Overview.

  return (
    <BiomarkerLayoutClient key={biomarker.pageRevisionId} biomarker={biomarker}>
      {children}
    </BiomarkerLayoutClient>
  );
}
