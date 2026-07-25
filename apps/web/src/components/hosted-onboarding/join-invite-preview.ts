import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

export type JoinInvitePreviewStage =
  | "invalid"
  | "expired"
  | "verify"
  | "checkout"
  | "messaging-setup"
  | "blocked"
  | "active"
  | "activating";

const PREVIEW_STAGES: readonly JoinInvitePreviewStage[] = [
  "invalid",
  "expired",
  "verify",
  "checkout",
  "messaging-setup",
  "blocked",
  "active",
  "activating",
];

export function parseJoinInvitePreviewStage(
  value: string | null | undefined,
): JoinInvitePreviewStage | null {
  if (!value) {
    return null;
  }
  return PREVIEW_STAGES.includes(value as JoinInvitePreviewStage)
    ? (value as JoinInvitePreviewStage)
    : null;
}

export function buildJoinInvitePreviewStatus(
  stage: JoinInvitePreviewStage,
  inviteCode: string,
): HostedInviteStatusPayload {
  const futureIso = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  const pastIso = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  const base: HostedInviteStatusPayload = {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: inviteCode,
      expiresAt: futureIso,
      phoneHint: "+1 (415) 555-0123",
      verificationMode: "invite_phone",
    },
    messagingSetupRequired: false,
    murphPhoneNumber: "+14155550199",
    session: {
      authenticated: true,
      expiresAt: futureIso,
      matchesInvite: true,
    },
    stage: "active",
    telegramStartRequired: false,
  };

  switch (stage) {
    case "invalid":
      return { ...base, invite: null, session: { ...base.session, authenticated: false, matchesInvite: false }, stage: "invalid" };
    case "expired":
      return {
        ...base,
        invite: { ...base.invite!, expiresAt: pastIso },
        session: { ...base.session, authenticated: false, matchesInvite: false },
        stage: "expired",
      };
    case "verify":
      return { ...base, session: { ...base.session, authenticated: false, matchesInvite: false }, stage: "verify" };
    case "checkout":
      return { ...base, stage: "checkout" };
    case "messaging-setup":
      return { ...base, messagingSetupRequired: true, stage: "checkout" };
    case "blocked":
      return { ...base, stage: "blocked" };
    case "active":
      return { ...base, stage: "active" };
    case "activating":
      return { ...base, stage: "activating" };
  }
}
