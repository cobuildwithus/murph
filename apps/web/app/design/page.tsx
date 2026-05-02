import type { Metadata } from "next";
import { Suspense } from "react";
import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { DesignPage } from "./design-page";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Design",
  description: "Brand guidelines, visual identity, and component library.",
});

export default function Page() {
  return (
    <HostedPrivyBoundary>
      <Suspense>
        <DesignPage />
      </Suspense>
    </HostedPrivyBoundary>
  );
}
