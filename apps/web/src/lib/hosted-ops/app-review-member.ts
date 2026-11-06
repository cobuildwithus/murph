import "server-only";

import { type HostedBillingStatus, type PrismaClient } from "@prisma/client";
import { recordHostedLaunchRequiredConsent, readHostedConsentStatus } from "../legal/consent";
import { getPrisma } from "../prisma";
import { prepareHostedCryptoDomainRootCandidates } from "../hosted-crypto/domain-root-store";
import { activateHostedMemberForPositiveSourceTx } from "../hosted-onboarding/member-activation";
import { materializePendingHostedGroupJoinConfirmationsBestEffort } from "../hosted-groups/group-join-confirmation";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export type HostedOpsAppReviewMemberMode = "apply" | "dry-run";
export type HostedOpsAppReviewMemberPrincipal =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string };
export interface HostedOpsAppReviewMemberSummary {
  action: "applied" | "dry-run";
  activated?: boolean;
  billingStatus: HostedBillingStatus | null;
  consentGranted: boolean;
  consentScopes: readonly string[];
  member: string | null;
  principal: string;
  suspended?: boolean;
}

const REQUIRED_CONSENT_SCOPES = ["launch.legal", "launch.health-data"] as const;
const OPS_SOURCE = "app-store-review-ops";

/** Prepares product access only. The reviewer first signs in through ordinary authentication. */
export async function prepareHostedOpsAppReviewMember(input: {
  mode: HostedOpsAppReviewMemberMode;
  now?: Date;
  principal: HostedOpsAppReviewMemberPrincipal;
  prisma?: PrismaClient;
}): Promise<HostedOpsAppReviewMemberSummary> {
  const prisma = input.prisma ?? getPrisma();
  const { member, authenticated } = await readExistingReviewAccount(input.principal, prisma);
  const consentScopes = member ? await readGrantedLaunchConsentScopes({ memberId: member.id, prisma }) : [];
  if (input.mode === "dry-run") return buildSummary({
    action: "dry-run", billingStatus: member?.billingStatus ?? null, consentScopes,
    memberId: member?.id ?? null, principal: input.principal,
    suspended: Boolean(member?.suspendedAt),
  });
  if (!member || !authenticated) {
    throw hostedOnboardingError({ code: "APP_REVIEW_SIGN_IN_REQUIRED", httpStatus: 409,
      message: "Sign in to the review account normally before preparing product access." });
  }
  assertHostedMemberNotSuspended(member);
  const now = input.now ?? new Date();
  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma,
      userId: member.id,
    });

  const activation = await prisma.$transaction((tx) => activateHostedMemberForPositiveSourceTx({
    dispatchContext: {
      eventCreatedAt: now,
      occurredAt: now.toISOString(),
      sourceEventId: `app-store-review:${member.id}`,
      sourceType: "hosted.app_store_review",
    },
    memberId: member.id,
    preparedCryptoDomainRoots,
    prisma: tx,
    skipIfBillingAlreadyActive: true,
    skipIfPreviouslyActivated: true,
  }));
  await materializePendingHostedGroupJoinConfirmationsBestEffort({
    memberId: member.id,
    prisma,
  });

  for (const scope of REQUIRED_CONSENT_SCOPES) {
    await recordHostedLaunchRequiredConsent({
      memberId: member.id,
      prisma,
      scope,
      source: OPS_SOURCE,
    });
  }

  const [consent, currentMember] = await Promise.all([
    readHostedConsentStatus({
      memberId: member.id,
      prisma,
    }),
    prisma.hostedMember.findUniqueOrThrow({
      select: {
        billingStatus: true,
        id: true,
        suspendedAt: true,
      },
      where: { id: member.id },
    }),
  ]);

  return buildSummary({
    action: "applied",
    activated: activation.activated,
    billingStatus: currentMember.billingStatus,
    consentScopes: consent.launchScopes.filter((scope) => scope.granted).map((scope) => scope.scope),
    memberId: currentMember.id,
    principal: input.principal,
    suspended: Boolean(currentMember.suspendedAt),
  });
}

async function readExistingReviewAccount(principal: HostedOpsAppReviewMemberPrincipal, prisma: PrismaClient) {
  const existing = principal.kind === "email"
    ? await lookupHostedMemberByVerifiedEmailAddress({ address: principal.value, prisma })
    : await lookupHostedMemberIdentityByPhoneNumber({ phoneNumber: principal.value, prisma });
  const member = existing?.core ?? null;
  const verified = principal.kind === "email" || Boolean(existing && "identity" in existing && existing.identity.phoneNumberVerifiedAt);
  const authenticated = member && verified && await prisma.hostedAuthRecord.findUnique({
    select: { id: true }, where: { model_id: { model: "user", id: member.id } },
  });
  return { member, authenticated };
}

async function readGrantedLaunchConsentScopes(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<string[]> {
  const grants = await input.prisma.hostedConsentGrant.findMany({
    select: { scope: true },
    where: {
      memberId: input.memberId,
      scope: { in: [...REQUIRED_CONSENT_SCOPES] },
      status: "granted",
    },
  });

  return grants.map((grant) => grant.scope);
}

function buildSummary(input: {
  action: "applied" | "dry-run";
  activated?: boolean;
  billingStatus: HostedBillingStatus | null;
  consentScopes: readonly string[];
  memberId: string | null;
  principal: HostedOpsAppReviewMemberPrincipal;
  suspended?: boolean;
}): HostedOpsAppReviewMemberSummary {
  return {
    action: input.action,
    activated: input.activated,
    billingStatus: input.billingStatus,
    consentGranted: REQUIRED_CONSENT_SCOPES.every((scope) => input.consentScopes.includes(scope)),
    consentScopes: input.consentScopes,
    member: input.memberId ? redactIdentifier(input.memberId) : null,
    principal: redactPrincipal(input.principal),
    suspended: input.suspended,
  };
}

function redactPrincipal(principal: HostedOpsAppReviewMemberPrincipal): string {
  switch (principal.kind) {
    case "email":
      return `email:${redactEmail(principal.value)}`;
    case "phone":
      return `phone:${redactPhone(principal.value)}`;
  }
}

function redactEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@", 2);
  const redactedLocal = local.length <= 1 ? "*" : `${local.slice(0, 1)}***`;
  return domain ? `${redactedLocal}@${domain}` : redactedLocal;
}

function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/gu, "");
  return digits.length > 4 ? `***${digits.slice(-4)}` : "***";
}

function redactIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "***";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
