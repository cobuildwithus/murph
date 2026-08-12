import { redirect } from "next/navigation";

import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { SettingsDataPrivacyAuthRequired } from "./settings-data-privacy-auth-required";

type SettingsDataPrivacySearchParams = {
  accountDeletion?: string | string[];
};

export default async function SettingsDataPrivacyPage({
  searchParams,
}: {
  searchParams?: Promise<SettingsDataPrivacySearchParams>;
} = {}) {
  const { authenticated } = await getHostedPageAuthSnapshot();

  if (authenticated) {
    const resolvedSearchParams: SettingsDataPrivacySearchParams = await (
      searchParams ?? Promise.resolve({})
    );
    const accountDeletion = Array.isArray(resolvedSearchParams.accountDeletion)
      ? resolvedSearchParams.accountDeletion[0]
      : resolvedSearchParams.accountDeletion;
    redirect(accountDeletion === "retry"
      ? "/settings?accountDeletion=retry#data-privacy"
      : "/settings#data-privacy");
  }

  return (
    <SettingsDataPrivacyAuthRequired />
  );
}
