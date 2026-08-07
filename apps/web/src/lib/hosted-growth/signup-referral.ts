import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  upsertHostedMemberIdentity,
} from "../hosted-onboarding/hosted-member-identity-store";
import { createHostedMember } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import {
  generateHostedInviteCode,
  generateHostedInviteId,
  generateHostedMemberId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  inviteExpiresAt,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";

const HOSTED_SIGNUP_REFERRAL_TOKEN_PREFIX =
  "murph_signup_referral_v1.";
const HOSTED_SIGNUP_REFERRAL_TOKEN_DOMAIN =
  "murph.hosted-signup-referral.v1";
const HOSTED_SIGNUP_REFERRAL_TOKEN_VERSION = 1;
const HOSTED_SIGNUP_REFERRAL_TOKEN_MAX_BYTES = 512;
const HOSTED_SIGNUP_REFERRAL_LINK_EXPIRES_AT =
  new Date("2099-12-31T23:59:59.999Z");
const HOSTED_SIGNUP_REFERRAL_INVITE_CHANNEL = "signup-referral";
export const HOSTED_SIGNUP_REFERRAL_MAX_CLAIMS_PER_HOUR = 50;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

type HostedSignupReferralTokenPayload = {
  referrerMemberId: string;
  version: typeof HOSTED_SIGNUP_REFERRAL_TOKEN_VERSION;
};

export interface HostedSignupReferralLink {
  expiresAt: Date;
  signupUrl: string;
}

export interface HostedSignupReferralLinkStatus {
  expiresAt: Date;
}

type HostedSignupReferralInvite = {
  expiresAt: Date;
  inviteCode: string;
};

type HostedSignupReferralReadClient = Pick<PrismaClient, "hostedMember">;

export function buildHostedSignupReferralUrl(
  referralToken: string,
  publicBaseUrl = requireHostedOnboardingPublicBaseUrl(),
): string {
  return new URL(
    `/r/${encodeURIComponent(referralToken)}`,
    publicBaseUrl,
  ).toString();
}

function buildHostedClaimedSignupUrl(
  inviteCode: string,
  publicBaseUrl: string,
): string {
  return new URL(
    `/join/${encodeURIComponent(inviteCode)}`,
    publicBaseUrl,
  ).toString();
}

export async function issueHostedSignupReferralLink(input: {
  now?: Date;
  prisma?: PrismaClient;
  publicBaseUrl?: string;
  referrerMemberId: string;
}): Promise<HostedSignupReferralLink> {
  const now = input.now ?? new Date();
  assertHostedSignupReferralLinkCurrent(now);
  const prisma = input.prisma ?? getPrisma();
  await requireActiveHostedSignupReferrer({
    prisma,
    referrerMemberId: input.referrerMemberId,
  });
  const referralToken = issueHostedSignupReferralToken({
    referrerMemberId: input.referrerMemberId,
  });

  return {
    expiresAt: copyHostedSignupReferralLinkExpiry(),
    signupUrl: buildHostedSignupReferralUrl(
      referralToken,
      input.publicBaseUrl,
    ),
  };
}

export async function readHostedSignupReferralLink(input: {
  now?: Date;
  prisma?: PrismaClient;
  referralCode: string;
}): Promise<HostedSignupReferralLinkStatus> {
  const now = input.now ?? new Date();
  assertHostedSignupReferralLinkCurrent(now);
  const token = requireHostedSignupReferralToken(input.referralCode);
  const prisma = input.prisma ?? getPrisma();
  await requireActiveHostedSignupReferrer({
    prisma,
    referrerMemberId: token.referrerMemberId,
  });
  return {
    expiresAt: copyHostedSignupReferralLinkExpiry(),
  };
}

export async function claimHostedSignupReferralLink(input: {
  now?: Date;
  prisma?: PrismaClient;
  publicBaseUrl?: string;
  referralCode: string;
}): Promise<HostedSignupReferralLink> {
  const now = input.now ?? new Date();
  assertHostedSignupReferralLinkCurrent(now);
  const token = requireHostedSignupReferralToken(input.referralCode);
  const publicBaseUrl = new URL(
    "/",
    input.publicBaseUrl ?? requireHostedOnboardingPublicBaseUrl(),
  ).toString();

  const prisma = input.prisma ?? getPrisma();
  const invite = await prisma.$transaction(
    (tx) => claimHostedSignupReferralLinkTx({
      now,
      prisma: tx,
      referrerMemberId: token.referrerMemberId,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  return {
    expiresAt: invite.expiresAt,
    signupUrl: buildHostedClaimedSignupUrl(
      invite.inviteCode,
      publicBaseUrl,
    ),
  };
}

function issueHostedSignupReferralToken(input: {
  referrerMemberId: string;
}): string {
  const payload: HostedSignupReferralTokenPayload = {
    referrerMemberId: input.referrerMemberId,
    version: HOSTED_SIGNUP_REFERRAL_TOKEN_VERSION,
  };
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  return `${HOSTED_SIGNUP_REFERRAL_TOKEN_PREFIX}${encodedPayload}.${createHostedSignupReferralSignature(encodedPayload)}`;
}

function requireHostedSignupReferralToken(
  token: string,
): HostedSignupReferralTokenPayload {
  const payload = openHostedSignupReferralToken(token);
  if (!payload) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND",
      httpStatus: 404,
      message: "That Murph referral link is no longer available.",
    });
  }
  return payload;
}

function openHostedSignupReferralToken(
  token: string,
): HostedSignupReferralTokenPayload | null {
  if (
    token !== token.trim()
    || !token.startsWith(HOSTED_SIGNUP_REFERRAL_TOKEN_PREFIX)
    || Buffer.byteLength(token, "utf8") > HOSTED_SIGNUP_REFERRAL_TOKEN_MAX_BYTES
  ) {
    return null;
  }

  const parts = token
    .slice(HOSTED_SIGNUP_REFERRAL_TOKEN_PREFIX.length)
    .split(".");
  const encodedPayload = parts[0];
  const suppliedSignature = parts[1];
  if (
    parts.length !== 2
    || !encodedPayload
    || !suppliedSignature
    || !BASE64URL_PATTERN.test(encodedPayload)
    || !SHA256_BASE64URL_PATTERN.test(suppliedSignature)
  ) {
    return null;
  }

  const expectedSignature = createHostedSignupReferralSignature(encodedPayload);
  const suppliedSignatureBytes = Buffer.from(suppliedSignature, "base64url");
  const expectedSignatureBytes = Buffer.from(expectedSignature, "base64url");
  if (
    suppliedSignatureBytes.byteLength !== expectedSignatureBytes.byteLength
    || !timingSafeEqual(suppliedSignatureBytes, expectedSignatureBytes)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) {
      return null;
    }
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }

  if (!isHostedSignupReferralTokenPayload(payload)) {
    return null;
  }
  return payload;
}

function isHostedSignupReferralTokenPayload(
  value: unknown,
): value is HostedSignupReferralTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const referrerMemberId = record.referrerMemberId;
  return Object.keys(record).length === 2
    && record.version === HOSTED_SIGNUP_REFERRAL_TOKEN_VERSION
    && typeof referrerMemberId === "string"
    && referrerMemberId.length > 0
    && referrerMemberId.length <= 128
    && referrerMemberId === referrerMemberId.trim();
}

function createHostedSignupReferralSignature(
  encodedPayload: string,
): string {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(JSON.stringify([
      HOSTED_SIGNUP_REFERRAL_TOKEN_DOMAIN,
      HOSTED_SIGNUP_REFERRAL_TOKEN_VERSION,
      encodedPayload,
    ]), "utf8")
    .digest("base64url");
}

function assertHostedSignupReferralLinkCurrent(now: Date): void {
  if (
    Number.isNaN(now.getTime())
    || now.getTime() >= HOSTED_SIGNUP_REFERRAL_LINK_EXPIRES_AT.getTime()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRAL_LINK_EXPIRED",
      httpStatus: 410,
      message: "That Murph referral link has expired.",
    });
  }
}

function copyHostedSignupReferralLinkExpiry(): Date {
  return new Date(HOSTED_SIGNUP_REFERRAL_LINK_EXPIRES_AT.getTime());
}

async function claimHostedSignupReferralLinkTx(input: {
  now: Date;
  prisma: Prisma.TransactionClient;
  referrerMemberId: string;
}): Promise<HostedSignupReferralInvite> {
  const claimLockAcquired = await tryAcquireHostedSignupReferralClaimLockTx({
    referrerMemberId: input.referrerMemberId,
    tx: input.prisma,
  });
  if (!claimLockAcquired) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY",
      httpStatus: 429,
      message: "That referral link is busy. Try again in a moment.",
      retryable: true,
    });
  }

  // Channel is ordinary onboarding metadata and may later be relabeled during
  // authenticated resume. Referrer attribution is the durable claim evidence.
  const recentClaimCount = await input.prisma.hostedInvite.count({
    where: {
      createdAt: {
        gte: new Date(input.now.getTime() - ONE_HOUR_MS),
      },
      referrerMemberId: input.referrerMemberId,
    },
  });
  if (recentClaimCount >= HOSTED_SIGNUP_REFERRAL_MAX_CLAIMS_PER_HOUR) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED",
      httpStatus: 429,
      message: "That referral link has been used too many times recently. Try again later.",
      retryable: true,
    });
  }

  // Keep the feature-local advisory lock through allocation so concurrent
  // claims cannot exceed the rolling bound. Target crypto preparation may call
  // an external provider, so check authority without holding the referrer's
  // account-wide row, then take that row and recheck immediately before the
  // attributed invite becomes durable.
  await requireActiveHostedSignupReferrer({
    prisma: input.prisma,
    referrerMemberId: input.referrerMemberId,
  });

  const targetMemberId = await createPristineHostedSignupMemberTx(input.prisma);
  await lockHostedMemberRow(input.prisma, input.referrerMemberId);
  await requireActiveHostedSignupReferrer({
    prisma: input.prisma,
    referrerMemberId: input.referrerMemberId,
  });
  return input.prisma.hostedInvite.create({
    data: {
      channel: HOSTED_SIGNUP_REFERRAL_INVITE_CHANNEL,
      expiresAt: inviteExpiresAt(
        input.now,
        getHostedOnboardingEnvironment().inviteTtlHours,
      ),
      id: generateHostedInviteId(),
      inviteCode: generateHostedInviteCode(),
      memberId: targetMemberId,
      referrerMemberId: input.referrerMemberId,
    },
    select: {
      expiresAt: true,
      inviteCode: true,
    },
  });
}

async function tryAcquireHostedSignupReferralClaimLockTx(input: {
  referrerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(
      hashtext(${"hosted-signup-referral-claim"}),
      hashtext(${input.referrerMemberId})
    ) AS locked
  `;
  return rows[0]?.locked === true;
}

async function requireActiveHostedSignupReferrer(input: {
  prisma: HostedSignupReferralReadClient;
  referrerMemberId: string;
}): Promise<void> {
  const referrer = await input.prisma.hostedMember.findUnique({
    select: {
      id: true,
      suspendedAt: true,
    },
    where: {
      id: input.referrerMemberId,
    },
  });
  if (!referrer) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRER_NOT_FOUND",
      httpStatus: 404,
      message: "The referring Murph account is no longer available.",
    });
  }
  assertHostedMemberNotSuspended(referrer);
}

async function createPristineHostedSignupMemberTx(
  prisma: Prisma.TransactionClient,
): Promise<string> {
  const memberId = generateHostedMemberId();
  await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId,
    prisma,
  });
  await upsertHostedMemberIdentity({
    maskedPhoneNumberHint: null,
    memberId,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    prisma,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  return memberId;
}
