"use client";

import { MonitorCheck } from "lucide-react";

import { HostedAuthRequiredScreen } from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

export function ComputerHandoffAuthRequiredState() {
  return (
    <HostedAuthRequiredScreen
      description="This link is private to the Murph account that received it. Sign in, then this page will reload so you can finish here."
      eyebrow="Private page"
      eyebrowIcon={MonitorCheck}
      footer="The handoff stays paused until the account is verified."
      title="Sign in to open this private page"
    />
  );
}
