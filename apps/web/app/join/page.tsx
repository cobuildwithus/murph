import { redirect } from "next/navigation";

import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { readHostedMemberOwnsSubscription } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function JoinResumePage() {
  const auth = await getHostedPageAuthSnapshot();
  const member = auth.authenticatedMember;

  if (!member) {
    redirect("/");
  }

  const stage = deriveHostedPostVerificationStage({
    billingStatus: member.billingStatus,
    hasExistingSubscription: await readHostedMemberOwnsSubscription({
      billingStatus: member.billingStatus,
      memberId: member.id,
    }),
    sponsoredAccessActive: await readActiveHostedMemberAccess({ memberId: member.id }),
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
