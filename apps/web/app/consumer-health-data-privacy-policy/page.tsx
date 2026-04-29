import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/consumer-health-data-privacy-policy",
  },
  description:
    "Murph's separate Consumer Health Data Privacy Policy covering consumer health data categories, sources, purposes, sharing, rights, deletion, appeals, and sale/no-sale.",
  openGraph: {
    type: "article",
  },
  title: "Murph Consumer Health Data Privacy Policy",
  twitter: {
    description:
      "Murph's separate Consumer Health Data Privacy Policy for health-related personal information.",
  },
});

export default async function ConsumerHealthDataPrivacyPolicyAliasPage() {
  return await LegalPolicyPage({
    markdownFileName: "consumer-health-data-privacy-policy.md",
    pdfHref: "/legal/consumer-health-data-privacy.pdf",
  });
}
