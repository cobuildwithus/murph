import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import PatternsPageClient from "./patterns-page-client";

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const params = await searchParams;
  const requestedFactor = readSingleSearchParam(params.factor);
  const debugFactor =
    process.env.NODE_ENV !== "production" &&
    readSingleSearchParam(params.debug) === "patterns"
      ? normalizeDebugFactor(requestedFactor)
      : null;

  return <PatternsPageClient debugFactor={debugFactor} />;
}

function readSingleSearchParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeDebugFactor(value: string | null): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized || normalized.length > 80) return "activity";
  return normalized === "yard-work"
    ? "yardwork"
    : normalized === "house-work"
      ? "housework"
      : normalized;
}
