"use client";

import { Trash2 } from "lucide-react";

import { HostedAuthRequiredScreen } from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

export function SettingsDataPrivacyAuthRequired() {
  return (
    <HostedAuthRequiredScreen
      description="Sign in to open the Data & privacy section, where you can export your data or delete your Murph account."
      eyebrow="Account privacy"
      eyebrowIcon={Trash2}
      footer="After sign-in, this link opens the deletion controls directly in settings."
      title="Sign in to manage your data"
    />
  );
}
