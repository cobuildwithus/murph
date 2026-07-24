import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { DesignPage } from "./design-page";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Design",
  description: "Brand guidelines, visual identity, and component library.",
});

export default function Page() {
  return (
    <>
      <Suspense>
        <DesignPage />
      </Suspense>
      <SiteFooter />
    </>
  );
}
