import type { Metadata } from "next";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { DesignPage } from "./design-page";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Design",
  description: "Brand guidelines, visual identity, and component library.",
});

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    designFocus?: string | string[];
    tab?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const requestedTab = resolvedSearchParams.tab;
  const requestedDesignFocus = resolvedSearchParams.designFocus;
  const activeTab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const designFocus = Array.isArray(requestedDesignFocus)
    ? requestedDesignFocus[0]
    : requestedDesignFocus;

  return (
    <>
      <DesignPage activeTab={activeTab} designFocus={designFocus} />
      <SiteFooter />
    </>
  );
}
