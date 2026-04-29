import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/consumer-health-data-privacy-policy",
  },
  description:
    "Murph's Consumer Health Data Notice covering consumer health data categories, sources, purposes, sharing, rights, deletion, appeals, and sale/no-sale.",
  openGraph: {
    type: "article",
  },
  title: "Murph Consumer Health Data Notice",
  twitter: {
    description:
      "Murph's Consumer Health Data Notice for health-related personal information.",
  },
});

export default async function ConsumerHealthDataPrivacyPolicyAliasPage() {
  return await LegalPolicyPage({
    markdownFileName: "consumer-health-data-notice.md",
    pdfHref: "/legal/consumer-health-data-notice.pdf",
  });
}
