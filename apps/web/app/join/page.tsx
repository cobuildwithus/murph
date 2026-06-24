import { redirect } from "next/navigation";

import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function JoinResumePage() {
  const auth = await getHostedPageAuthSnapshot();
  const member = auth.authenticatedMember;

  if (!member) {
    redirect("/");
  }

  const stage = deriveHostedPostVerificationStage({
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
  });

  if (stage === "checkout") {
    const invite = await issueHostedInvite({
      channel: "web",
      memberId: member.id,
    });
    redirect(`/join/${encodeURIComponent(invite.inviteCode)}`);
  }

  if (stage === "active" || stage === "activating") {
    redirect("/home");
  }

  redirect("/");
}
