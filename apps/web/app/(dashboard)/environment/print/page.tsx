import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { EnvironmentPrintPageClient } from "./environment-print-page-client";

export const metadata: Metadata = {
  title: "Environment report — Murph",
  robots: { follow: false, index: false },
};

export default async function EnvironmentPrintPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();

  if (!auth.authenticated) {
    redirect("/");
  }

  const generatedOn = new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return <EnvironmentPrintPageClient generatedOn={generatedOn} />;
}
