import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/legal/terms",
  },
  description:
    "Murph's Terms of Service for the hosted service, local software, health disclaimers, subscriptions, privacy, and acceptable use.",
  openGraph: {
    type: "article",
  },
  title: "Murph Terms of Service",
  twitter: {
    description:
      "Murph's Terms of Service for hosted Murph, local software, subscriptions, privacy, and acceptable use.",
  },
});

export default async function TermsOfServicePage() {
  return await LegalPolicyPage({
    markdownFileName: "terms-of-service.md",
    pdfHref: "/legal/terms.pdf",
  });
}
