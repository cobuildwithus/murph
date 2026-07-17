import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { LabsPageClient } from "./labs-page-client";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Labs — Murph",
    description: "Explore available lab tests and nearby collection options.",
  }),
  robots: {
    follow: false,
    index: false,
  },
};

export default async function LabsPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();

  if (!auth.authenticated) {
    redirect("/");
  }

  return <LabsPageClient />;
}
