import type { Metadata } from "next";

import { LegalPolicyPage } from "@/src/components/legal/legal-policy-page";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-static";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: {
    canonical: "/legal",
  },
  description:
    "Current Murph legal documents, PDFs, and versioned legal manifest.",
  openGraph: {
    type: "article",
  },
  title: "Murph Legal Documents",
});

export default async function LegalDocumentsPage() {
  return await LegalPolicyPage({
    markdownFileName: "legal-documents.md",
    pdfHref: "/legal/legal-documents.pdf",
  });
}
