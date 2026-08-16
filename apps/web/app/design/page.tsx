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
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const requestedTab = (await searchParams).tab;
  const activeTab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;

  return (
    <>
      <DesignPage activeTab={activeTab} />
      <SiteFooter vitalsMode="synthetic" />
    </>
  );
}
