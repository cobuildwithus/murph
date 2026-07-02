import "server-only";

import { HostedBillingStatus, type PrismaClient } from "@prisma/client";
import { APIError, PrivyClient, type User as PrivyUser } from "@privy-io/node";

import {
  recordHostedLaunchRequiredConsent,
  readHostedConsentStatus,
} from "../legal/consent";
import { getPrisma } from "../prisma";
import { lookupHostedMemberIdentityByPrivyUserId } from "../hosted-onboarding/hosted-member-identity-store";
import { activateHostedMemberForPositiveSourceTx } from "../hosted-onboarding/member-activation";
import { ensureHostedMemberForPrivyIdentity } from "../hosted-onboarding/member-identity-service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedOnboardingEnvironment } from "../hosted-onboarding/env";
import {
  resolveHostedPrivyIdentityFromVerifiedUser,
  syncHostedPrivyMemberIdMetadata,
  type HostedPrivyUser,
} from "../hosted-onboarding/privy";

export type HostedOpsAppReviewMemberMode = "apply" | "dry-run";

export type HostedOpsAppReviewMemberPrincipal =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "privyUserId"; value: string };

export interface HostedOpsAppReviewMemberSummary {
  action: "applied" | "dry-run";
  activated?: boolean;
  billingStatus: HostedBillingStatus | null;
  consentGranted: boolean;
  consentScopes: readonly string[];
  member: string | null;
  metadataSynced: boolean;
  principal: string;
  privyUser: string;
  suspended?: boolean;
}

const REQUIRED_CONSENT_SCOPES = ["launch.legal", "launch.health-data"] as const;
const OPS_SOURCE = "app-store-review-ops";

export async function prepareHostedOpsAppReviewMember(input: {
  createPrivyUser?: boolean;
  mode: HostedOpsAppReviewMemberMode;
  now?: Date;
  principal: HostedOpsAppReviewMemberPrincipal;
  prisma?: PrismaClient;
}): Promise<HostedOpsAppReviewMemberSummary> {
  if (input.createPrivyUser === true && input.principal.kind !== "email") {
    throw new Error("Privy test-user creation currently supports email principals only.");
  }
  if (input.createPrivyUser === true && input.mode !== "apply") {
    throw new Error("Privy test-user creation requires apply mode.");
  }

  const environment = readHostedOnboardingEnvironment(process.env);
  const privyAppId = normalizeRequiredEnv("NEXT_PUBLIC_PRIVY_APP_ID", environment.privyAppId);
  const privyAppSecret = normalizeRequiredEnv("PRIVY_APP_SECRET", environment.privyAppSecret);
  const privy = new PrivyClient({ appId: privyAppId, appSecret: privyAppSecret });

  const user = input.createPrivyUser === true && input.principal.kind === "email"
    ? await readOrCreatePrivyEmailUser({
        email: input.principal.value,
        privy,
      })
    : await readPrivyUser({ principal: input.principal, privy });
  const identity = resolveHostedPrivyIdentityFromVerifiedUser(user as HostedPrivyUser);
  const prisma = input.prisma ?? getPrisma();
  const existing = await lookupHostedMemberIdentityByPrivyUserId({
    prisma,
    privyUserId: identity.userId,
  });
  const existingConsentScopes = existing
    ? await readGrantedLaunchConsentScopes({ memberId: existing.core.id, prisma })
    : [];

  if (input.mode === "dry-run") {
    return buildSummary({
      action: "dry-run",
      billingStatus: existing?.core.billingStatus ?? null,
      consentScopes: existingConsentScopes,
      memberId: existing?.core.id ?? null,
      metadataSynced: readPrivyMetadataMemberId(user) === existing?.core.id,
      principal: input.principal,
      privyUserId: identity.userId,
    });
  }

  const now = input.now ?? new Date();
  const member = await ensureHostedMemberForPrivyIdentity({
    authMethod: input.principal.kind === "email"
      ? "email"
      : input.principal.kind === "phone"
        ? "phone"
        : undefined,
    identity,
    now,
    prisma,
  });

  const activation = await prisma.$transaction((tx) => activateHostedMemberForPositiveSourceTx({
    dispatchContext: {
      eventCreatedAt: now,
      occurredAt: now.toISOString(),
      sourceEventId: `app-store-review:${identity.userId}`,
      sourceType: "hosted.app_store_review",
    },
    memberId: member.id,
    prisma: tx,
    skipIfBillingAlreadyActive: true,
    skipIfPreviouslyActivated: true,
  }));

  const metadataUpdated = await syncHostedPrivyMemberIdMetadata({
    memberId: member.id,
    privyUserId: identity.userId,
    verifiedPrivyUser: user as HostedPrivyUser,
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
    metadataSynced: metadataUpdated || readPrivyMetadataMemberId(user) === member.id,
    principal: input.principal,
    privyUserId: identity.userId,
    suspended: Boolean(currentMember.suspendedAt),
  });
}

async function readPrivyUser(input: {
  principal: HostedOpsAppReviewMemberPrincipal;
  privy: PrivyClient;
}): Promise<PrivyUser> {
  try {
    switch (input.principal.kind) {
      case "email":
        return await input.privy.users().getByEmailAddress({ address: input.principal.value });
      case "phone":
        return await input.privy.users().getByPhoneNumber({ number: input.principal.value });
      case "privyUserId":
        return await input.privy.users()._get(input.principal.value);
    }
  } catch (error) {
    throw mapPrivyAppReviewError(error, {
      code: "HOSTED_OPS_APP_REVIEW_PRIVY_USER_LOOKUP_FAILED",
      httpStatus: isPrivyMissingUserError(error) ? 409 : 503,
      message: isPrivyMissingUserError(error)
        ? "Privy reviewer user does not exist yet."
        : "Privy reviewer user lookup failed.",
      operationName: "privy_user_lookup",
      retryable: isRetryablePrivyError(error),
    });
  }
}

async function readOrCreatePrivyEmailUser(input: {
  email: string;
  privy: PrivyClient;
}): Promise<PrivyUser> {
  try {
    return await input.privy.users().getByEmailAddress({ address: input.email });
  } catch (error) {
    if (!isPrivyMissingUserError(error)) {
      throw mapPrivyAppReviewError(error, {
        code: "HOSTED_OPS_APP_REVIEW_PRIVY_USER_LOOKUP_FAILED",
        httpStatus: 503,
        message: "Privy reviewer user lookup failed.",
        operationName: "privy_email_lookup_before_create",
        retryable: isRetryablePrivyError(error),
      });
    }
  }

  try {
    return await input.privy.users().create({
      linked_accounts: [
        {
          address: input.email,
          type: "email",
        },
      ],
    });
  } catch (error) {
    if (isPrivyConflictError(error)) {
      return readPrivyUser({
        principal: {
          kind: "email",
          value: input.email,
        },
        privy: input.privy,
      });
    }

    throw mapPrivyAppReviewError(error, {
      code: "HOSTED_OPS_APP_REVIEW_PRIVY_USER_CREATE_FAILED",
      httpStatus: 503,
      message: "Privy reviewer user creation failed.",
      operationName: "privy_email_user_create",
      retryable: isRetryablePrivyError(error),
    });
  }
}

function mapPrivyAppReviewError(error: unknown, input: {
  code: string;
  httpStatus: number;
  message: string;
  operationName: string;
  retryable: boolean;
}): Error {
  return hostedOnboardingError({
    cause: error,
    code: input.code,
    details: {
      operationName: input.operationName,
      ...readPrivyErrorDetails(error),
    },
    httpStatus: input.httpStatus,
    message: input.message,
    retryable: input.retryable,
  });
}

function readPrivyErrorDetails(error: unknown): Record<string, string | number | boolean> {
  return {
    providerErrorType: error instanceof Error ? error.name : typeof error,
    ...readPrivyStatusDetails(error),
    ...readPrivyErrorCodeDetails(error),
    ...readPrivyRequestDetails(error),
  };
}

function readPrivyStatusDetails(error: unknown): Record<string, number> {
  const statusCode = readPrivyStatusCode(error);
  return statusCode === null ? {} : { statusCode };
}

function readPrivyErrorCodeDetails(error: unknown): Record<string, string> {
  const providerErrorCode = readPrivyProviderErrorCode(error);
  return providerErrorCode === null ? {} : { providerErrorCode };
}

function readPrivyRequestDetails(error: unknown): Record<string, boolean> {
  return error instanceof APIError
    ? { providerRequestIdPresent: hasPrivyRequestIdHeader(error.headers) }
    : {};
}

function readPrivyProviderErrorCode(error: unknown): string | null {
  if (!(error instanceof APIError)) {
    return null;
  }

  const providerError = error.error;
  if (!providerError || typeof providerError !== "object") {
    return null;
  }

  for (const key of ["code", "error", "type"]) {
    const value = Reflect.get(providerError, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function hasPrivyRequestIdHeader(headers: Headers | undefined): boolean {
  return Boolean(
    headers?.get("x-request-id")
    || headers?.get("x-privy-request-id")
    || headers?.get("request-id"),
  );
}

function isPrivyMissingUserError(error: unknown): boolean {
  return readPrivyStatusCode(error) === 404;
}

function isPrivyConflictError(error: unknown): boolean {
  return readPrivyStatusCode(error) === 409;
}

function isRetryablePrivyError(error: unknown): boolean {
  const statusCode = readPrivyStatusCode(error);
  return statusCode === null || statusCode === 429 || statusCode >= 500;
}

function readPrivyStatusCode(error: unknown): number | null {
  return error instanceof APIError && typeof error.status === "number"
    ? error.status
    : null;
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

function normalizeRequiredEnv(name: string, value: string | null | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(`${name} must be present in the command environment.`);
  }
  return normalized;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readPrivyMetadataMemberId(user: PrivyUser): string | null {
  const metadata = user.custom_metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = Reflect.get(metadata, "murph_member_id");
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildSummary(input: {
  action: "applied" | "dry-run";
  activated?: boolean;
  billingStatus: HostedBillingStatus | null;
  consentScopes: readonly string[];
  memberId: string | null;
  metadataSynced: boolean;
  principal: HostedOpsAppReviewMemberPrincipal;
  privyUserId: string;
  suspended?: boolean;
}): HostedOpsAppReviewMemberSummary {
  return {
    action: input.action,
    activated: input.activated,
    billingStatus: input.billingStatus,
    consentGranted: REQUIRED_CONSENT_SCOPES.every((scope) => input.consentScopes.includes(scope)),
    consentScopes: input.consentScopes,
    member: input.memberId ? redactIdentifier(input.memberId) : null,
    metadataSynced: input.metadataSynced,
    principal: redactPrincipal(input.principal),
    privyUser: redactIdentifier(input.privyUserId),
    suspended: input.suspended,
  };
}

function redactPrincipal(principal: HostedOpsAppReviewMemberPrincipal): string {
  switch (principal.kind) {
    case "email":
      return `email:${redactEmail(principal.value)}`;
    case "phone":
      return `phone:${redactPhone(principal.value)}`;
    case "privyUserId":
      return `privyUserId:${redactIdentifier(principal.value)}`;
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
