import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";
import {
  getHostedPageAuthSnapshot,
  getHostedSidebarAuthSnapshot,
} from "@/src/lib/hosted-onboarding/page-auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await getHostedPageAuthSnapshot();
  const member = auth.authenticatedMember;

  if (
    member
    && deriveHostedPostVerificationStage({
      billingStatus: member.billingStatus,
      suspendedAt: member.suspendedAt,
    }) === "checkout"
  ) {
    const invite = await issueHostedInvite({
      channel: "web",
      memberId: member.id,
    });
    redirect(`/join/${encodeURIComponent(invite.inviteCode)}`);
  }

  const sidebarAuth = await getHostedSidebarAuthSnapshot();

  return <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>;
}
