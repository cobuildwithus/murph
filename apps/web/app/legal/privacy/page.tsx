import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/legal/privacy",
  },
  description:
    "Murph's Privacy Policy for hosted and local health data, AI processing, integrations, retention, security, and privacy rights.",
  openGraph: {
    type: "article",
  },
  title: "Murph Privacy Policy",
  twitter: {
    description:
      "Murph's Privacy Policy for health data, AI processing, integrations, retention, security, and privacy rights.",
  },
});

export default async function PrivacyPolicyPage() {
  return await LegalPolicyPage({
    markdownFileName: "privacy-policy.md",
    pdfHref: "/legal/privacy.pdf",
  });
}
