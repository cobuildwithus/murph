import type { Metadata } from "next";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import EnvironmentPageClient from "./environment-page-client";

const ENVIRONMENT_OPEN_GRAPH_IMAGE = {
  alt: "Map your environment with Murph",
  height: 630,
  type: "image/png",
  url: "/environment/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Environment — Murph",
  description: "What Murph knows about your home, and what to check next.",
  openGraph: { images: [ENVIRONMENT_OPEN_GRAPH_IMAGE] },
  twitter: { images: [ENVIRONMENT_OPEN_GRAPH_IMAGE] },
});

export default async function EnvironmentPage() {
  const contactOptions = await resolveEnvironmentContactOptions();
  return <EnvironmentPageClient contactOptions={contactOptions} />;
}

async function resolveEnvironmentContactOptions() {
  try {
    const options = await resolveHostedMurphContactOptions({
      message: {
        body: "I want to fill in the missing details in my Environment report.",
      },
    });
    return options.filter(
      (option) => option.kind === "text" || option.kind === "telegram",
    );
  } catch {
    return [];
  }
}
