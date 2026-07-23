import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/subprocessors",
  },
  description:
    "Murph subprocessors, model providers, and connected services that may process personal information or health data.",
  openGraph: {
    type: "article",
  },
  title: "Murph Subprocessors and Connected Services",
});

export default async function SubprocessorsPage() {
  return await LegalPolicyPage({
    markdownFileName: "subprocessors.md",
    pdfHref: "/legal/subprocessors.pdf",
  });
}
