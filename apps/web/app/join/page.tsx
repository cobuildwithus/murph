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

export default async function JoinResumePage(input: {
  searchParams: Promise<{
    family_checkout?: string | string[];
    session_id?: string | string[];
  }>;
}) {
  const searchParams = await input.searchParams;
  const auth = await getHostedPageAuthSnapshot();
  const member = auth.authenticatedMember;

  if (!member) {
    redirect("/");
  }

  const familyCheckoutSuccessSessionId =
    searchParams.family_checkout === "success"
    && typeof searchParams.session_id === "string"
    && /^cs_(?:test|live)_[A-Za-z0-9]+$/u.test(searchParams.session_id)
      ? searchParams.session_id
      : null;
  if (familyCheckoutSuccessSessionId) {
    const invite = await issueHostedInvite({
      channel: "web",
      memberId: member.id,
    });
    redirect(
      `/join/${encodeURIComponent(invite.inviteCode)}/success?session_id=${
        encodeURIComponent(familyCheckoutSuccessSessionId)
      }`,
    );
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

  // Billing recovery is a destination decision, not a generic accessible stage.
  // Send members with a retained provider subscription directly to Subscription;
  // /home stays for genuinely active Starter, paid, or sponsored access.
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
