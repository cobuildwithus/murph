import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FamilySetupAuthRequired } from "@/src/components/family/family-setup-auth-required";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Set up Family · Murph",
    description: "Open your private Murph Family settings.",
  }),
  robots: { follow: false, index: false },
};

export default async function FamilySetupPage() {
  const auth = await getHostedPageAuthSnapshot();

  if (auth.authenticated) {
    redirect("/settings#family");
  }

  return <FamilySetupAuthRequired />;
}
