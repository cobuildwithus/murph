import type { Metadata } from "next";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import ContextPageClient from "./context-page-client";

type ContextPageSearchParams = Record<string, string | string[] | undefined>;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Context — Murph",
  description: "The durable facts, preferences, and health context Murph uses for personal recommendations.",
});

export default async function ContextPage({
  searchParams,
}: {
  searchParams?: Promise<ContextPageSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};

  return <ContextPageClient mockMode={readMockMode(resolvedSearchParams)} />;
}

function readMockMode(searchParams: ContextPageSearchParams): boolean {
  const value = searchParams.mock;
  const firstValue = Array.isArray(value) ? value[0] : value;

  return firstValue === "1" || firstValue === "true";
}
