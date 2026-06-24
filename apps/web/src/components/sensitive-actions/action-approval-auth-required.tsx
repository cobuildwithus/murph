"use client";

import { ShieldCheck } from "lucide-react";

import { HostedAuthRequiredScreen } from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

export function ActionApprovalAuthRequiredState() {
  return (
    <HostedAuthRequiredScreen
      description="This approval is private to the Murph account that received it. Sign in to review the exact action."
      eyebrow="Secure approval"
      eyebrowIcon={ShieldCheck}
      footer="The action stays blocked until the account is verified and you approve it here."
      title="Sign in to review this request"
    />
  );
}
