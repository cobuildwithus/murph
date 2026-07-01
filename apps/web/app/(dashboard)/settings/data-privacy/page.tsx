import { redirect } from "next/navigation";

import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { SettingsDataPrivacyAuthRequired } from "./settings-data-privacy-auth-required";

export default async function SettingsDataPrivacyPage() {
  const { authenticated } = await getHostedPageAuthSnapshot();

  if (authenticated) {
    redirect("/settings#data-privacy");
  }

  return (
    <SettingsDataPrivacyAuthRequired />
  );
}
