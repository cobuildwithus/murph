import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/legal/health-ai-safety-disclosure",
  },
  description:
    "Murph's health AI safety disclosure covering general wellness use, AI limitations, emergencies, medication boundaries, and provider processing.",
  openGraph: {
    type: "article",
  },
  title: "Murph Health AI Safety Disclosure",
});

export default async function HealthAiSafetyDisclosurePage() {
  return await LegalPolicyPage({
    markdownFileName: "health-ai-safety-disclosure.md",
    pdfHref: "/legal/health-ai-safety-disclosure.pdf",
  });
}
