import { redirect } from "next/navigation";

import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { readHostedMemberOwnsSubscription } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  deriveHostedPostVerificationStage,
  hasHostedRecoverableBilling,
} from "@/src/lib/hosted-onboarding/lifecycle";
import { HOSTED_APP_SUBSCRIPTION_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function JoinResumePage() {
  const auth = await getHostedPageAuthSnapshot();
  const member = auth.authenticatedMember;

  if (!member) {
    redirect("/");
  }

  const sponsoredAccessActive = await readActiveHostedMemberAccess({ memberId: member.id });
  const hasExistingSubscription = await readHostedMemberOwnsSubscription({
    billingStatus: member.billingStatus,
    memberId: member.id,
  });
  const stage = deriveHostedPostVerificationStage({
    billingStatus: member.billingStatus,
    hasExistingSubscription,
    sponsoredAccessActive,
    suspendedAt: member.suspendedAt,
  });

  if (stage === "checkout") {
    const invite = await issueHostedInvite({
      channel: "web",
      memberId: member.id,
    });
    redirect(`/join/${encodeURIComponent(invite.inviteCode)}`);
  }

  // Billing to recover is a destination decision, not a generic accessible stage:
  // the dashboard surfaces a billing action only for a narrow paused-trial shape,
  // so send these members straight to the Subscription controls. /home stays for
  // genuinely active or sponsored access.
  if (
    !sponsoredAccessActive
    && stage !== "blocked"
    && hasHostedRecoverableBilling({
      billingStatus: member.billingStatus,
      hasExistingSubscription,
    })
  ) {
    redirect(HOSTED_APP_SUBSCRIPTION_PATH);
  }

  if (stage === "active" || stage === "activating") {
    redirect("/home");
  }

  redirect("/");
}
