import "server-only";

import { type HostedBillingStatus, type PrismaClient } from "@prisma/client";

import {
  ensureHostedAutoPulseTrialEnrollment,
  type HostedAutoPulseTrialEnrollmentStatus,
} from "../hosted-onboarding/auto-trial-enrollment-service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { issueHostedInvite } from "../hosted-onboarding/invite-service";
import { getPrisma } from "../prisma";

const HOSTED_OPS_INVITE_CODE_MAX_LENGTH = 512;

export interface HostedOpsOnboardingActivationResult {
  generatedAt: string;
  invite: {
    enrollmentInviteExpiresAt: string;
    enrollmentInviteRefreshed: boolean;
    sourceChannel: string;
    sourceExpired: boolean;
    sourceExpiresAt: string;
  };
  member: {
    billingStatusBefore: HostedBillingStatus;
    suspended: boolean;
  };
  redirectPath: string;
  status: HostedAutoPulseTrialEnrollmentStatus;
}

export async function activateHostedOpsOnboardingFromInvite(input: {
  inviteCodeOrUrl: string;
  prisma?: PrismaClient;
}): Promise<HostedOpsOnboardingActivationResult> {
  const inviteCode = normalizeHostedOpsInviteCodeInput(input.inviteCodeOrUrl);
  if (!inviteCode) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_REQUIRED",
      httpStatus: 400,
      message: "Enter a hosted invite code or join URL.",
      retryable: false,
    });
  }

  const prisma = input.prisma ?? getPrisma();
  const sourceInvite = await prisma.hostedInvite.findUnique({
    select: {
      channel: true,
      expiresAt: true,
      inviteCode: true,
      member: {
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
      },
    },
    where: {
      inviteCode,
    },
  });

  if (!sourceInvite) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_NOT_FOUND",
      httpStatus: 404,
      message: "No hosted invite was found for that code.",
      retryable: false,
    });
  }

  const enrollmentInvite = await issueHostedInvite({
    channel: "web",
    memberId: sourceInvite.member.id,
    prisma,
  });
  const enrollment = await ensureHostedAutoPulseTrialEnrollment({
    inviteCode: enrollmentInvite.inviteCode,
    member: {
      id: sourceInvite.member.id,
      suspendedAt: sourceInvite.member.suspendedAt,
    },
    prisma,
  });
  const generatedAt = new Date();

  return {
    generatedAt: generatedAt.toISOString(),
    invite: {
      enrollmentInviteExpiresAt: enrollmentInvite.expiresAt.toISOString(),
      enrollmentInviteRefreshed:
        enrollmentInvite.inviteCode !== sourceInvite.inviteCode,
      sourceChannel: sourceInvite.channel,
      sourceExpired: sourceInvite.expiresAt <= generatedAt,
      sourceExpiresAt: sourceInvite.expiresAt.toISOString(),
    },
    member: {
      billingStatusBefore: sourceInvite.member.billingStatus,
      suspended: Boolean(sourceInvite.member.suspendedAt),
    },
    redirectPath: enrollment.redirectPath,
    status: enrollment.status,
  };
}

export function normalizeHostedOpsInviteCodeInput(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim();
  if (!value) {
    return null;
  }

  const extracted =
    extractHostedInviteCodeFromUrl(value) ??
    extractHostedInviteCodeFromPath(value) ??
    stripHostedInviteCodeDecorators(value);
  const normalized = extracted.trim();

  return normalized.length > 0 && normalized.length <= HOSTED_OPS_INVITE_CODE_MAX_LENGTH
    ? normalized
    : null;
}

function extractHostedInviteCodeFromUrl(value: string): string | null {
  try {
    return extractHostedInviteCodeFromPath(new URL(value).pathname);
  } catch {
    return null;
  }
}

function extractHostedInviteCodeFromPath(value: string): string | null {
  const path = stripHostedInviteCodeDecorators(value);
  const segments = path.split("/").filter(Boolean);
  const joinIndex = segments.findIndex((segment) => segment === "join");
  if (joinIndex < 0) {
    return null;
  }

  const segment = segments[joinIndex + 1];
  return segment ? decodeHostedInviteCodeSegment(segment) : null;
}

function stripHostedInviteCodeDecorators(value: string): string {
  const [withoutHash = ""] = value.split("#", 1);
  const [withoutQuery = ""] = withoutHash.split("?", 1);
  return withoutQuery.trim().replace(/^\/+|\/+$/gu, "");
}

function decodeHostedInviteCodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
