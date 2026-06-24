"use client";

import { Link2 } from "lucide-react";

import { HostedAuthRequiredScreen } from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

export function IntegrationsConnectAuthRequired() {
  return (
    <HostedAuthRequiredScreen
      description="This connection link is private to the Murph account that received it. Sign in, then this page will reload so you can connect."
      eyebrow="Connected apps"
      eyebrowIcon={Link2}
      footer="The connection waits until the account is verified."
      title="Sign in to continue"
    />
  );
}
