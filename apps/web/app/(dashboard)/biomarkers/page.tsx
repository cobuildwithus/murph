import type { Metadata } from "next";
import { getGeneratedHealthCommonsWebBiomarkerIndex } from "@murphai/health-commons/runtime";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import {
  BiomarkersPageClient,
  type BiomarkerBrowseEntry,
} from "./biomarkers-page-client";

const BROWSE_EXCLUDED_BIOMARKER_ROUTE_IDS = new Set(["blood-glucose"]);

export const metadata: Metadata = createMurphPageMetadata({
  title: "Biomarkers — Murph",
  description:
    "Browse the biomarker library. Track and understand the signals that move your health, then run experiments to see what changes.",
});

export default function BiomarkersPage() {
  const index = getGeneratedHealthCommonsWebBiomarkerIndex();
  const biomarkers: BiomarkerBrowseEntry[] = index.biomarkers
    .filter((entry) =>
      entry.published &&
      !entry.hidden &&
      !BROWSE_EXCLUDED_BIOMARKER_ROUTE_IDS.has(entry.routeId)
    )
    .map((entry) => ({
      key: entry.key,
      routeId: entry.routeId,
      title: entry.title,
      shortName: entry.shortName,
      summary: entry.summary,
      unit: entry.unit,
      categories: entry.categories,
      aliases: entry.aliases,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return <BiomarkersPageClient biomarkers={biomarkers} />;
}
