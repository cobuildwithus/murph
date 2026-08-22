import "server-only";

import { type PrismaClient } from "@prisma/client";
import { after } from "next/server";

import { getPrisma } from "../prisma";
import {
  claimHostedMemberSignupNotificationEmailAttempt,
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
  readHostedMemberSignupNotificationContext,
} from "./hosted-member-store";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "./resend-plain-text-email";
import {
  readHostedSignupNotificationEmailConfig,
  type HostedSignupNotificationEmailEnv,
} from "./signup-notification-email-config";
import {
  formatHostedSignupLocation,
  formatHostedSignupSurface,
  type HostedSignupNotificationContextV1,
  type HostedSignupSurface,
} from "./signup-notification-context";

const HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT = "New Murph signup";

export type HostedSignupNotificationEmailResult =
  | {
      reason:
        | "already_attempted"
        | "member_not_active"
        | "member_not_found"
        | "not_configured";
      status: "skipped";
    }
  | {
      providerMessageId: string | null;
      status: "sent";
    };

export const HostedSignupNotificationEmailError = HostedResendPlainTextEmailError;
export type HostedSignupNotificationEmailError = HostedResendPlainTextEmailError;

export function scheduleHostedSignupNotificationEmails(input: {
  activationSurface?: HostedSignupSurface;
  memberIds: readonly string[];
  prisma: PrismaClient;
}): void {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return;
  }

  const task = async () => {
    for (const memberId of memberIds) {
      await sendHostedSignupNotificationEmailForMemberBestEffort({
        activationSurface: input.activationSurface,
        memberId,
        prisma: input.prisma,
      });
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}

export async function sendHostedSignupNotificationEmailForMemberBestEffort(input: {
  activationSurface?: HostedSignupSurface;
  env?: HostedSignupNotificationEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<void> {
  try {
    await sendHostedSignupNotificationEmailForMember(input);
  } catch (error) {
    console.warn("Hosted signup notification email send failed.", {
      ...(error instanceof HostedSignupNotificationEmailError
        ? {
            errorCode: error.code,
            providerStatus: error.providerStatus,
          }
        : {
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
    });
  }
}

export async function sendHostedSignupNotificationEmailForMember(input: {
  activationSurface?: HostedSignupSurface;
  env?: HostedSignupNotificationEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedSignupNotificationEmailResult> {
  const now = input.now ?? new Date();
  const config = readHostedSignupNotificationEmailConfig(input.env ?? process.env);

  if (!config) {
    await claimHostedMemberSignupNotificationEmailAttempt({
      attemptedAt: now,
      memberId: input.memberId,
      prisma: input.prisma ?? getPrisma(),
    });
    return {
      reason: "not_configured",
      status: "skipped",
    };
  }

  const prisma = input.prisma ?? getPrisma();
  const hasActiveAccess = await readActiveHostedMemberAccess({
    memberId: input.memberId,
    prisma,
  });

  if (!hasActiveAccess) {
    const member = await readHostedMemberCoreState({
      memberId: input.memberId,
      prisma,
    });
    return {
      reason: member ? "member_not_active" : "member_not_found",
      status: "skipped",
    };
  }

  const signupSnapshot = await readHostedMemberSignupNotificationContext({
    memberId: input.memberId,
    now,
    prisma,
  });
  if (!signupSnapshot) {
    return {
      reason: "member_not_found",
      status: "skipped",
    };
  }
  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma,
  }).catch(() => null);
  const customerEmail = emailAuthorization?.verifiedEmail?.address
    ?? emailAuthorization?.stripeCheckoutEmail?.address
    ?? null;

  const claimed = await claimHostedMemberSignupNotificationEmailAttempt({
    attemptedAt: now,
    memberId: input.memberId,
    prisma,
  });

  if (!claimed) {
    return {
      reason: "already_attempted",
      status: "skipped",
    };
  }

  const result = await sendHostedResendPlainTextEmail({
    config: config.resend,
    fetchImpl: input.fetchImpl,
    idempotencyKey: buildHostedSignupNotificationEmailIdempotencyKey(input.memberId),
    subject: buildHostedSignupNotificationEmailSubject(signupSnapshot.context),
    text: buildHostedSignupNotificationEmailText({
      customerEmail,
      activationSurface: input.activationSurface,
      fallbackOccurredAt: signupSnapshot.createdAt,
      signupContext: signupSnapshot.context,
    }),
    to: config.recipients,
  });

  return {
    providerMessageId: result.providerMessageId,
    status: "sent",
  };
}

function buildHostedSignupNotificationEmailText(input: {
  activationSurface?: HostedSignupSurface;
  customerEmail?: string | null;
  fallbackOccurredAt: Date;
  signupContext: HostedSignupNotificationContextV1 | null;
}): string {
  const location = formatHostedSignupLocation(input.signupContext?.location);
  const occurredAt = input.signupContext?.occurredAt
    ?? input.fallbackOccurredAt.toISOString();
  const signupSurface = input.signupContext?.surface;
  const timeZone = input.signupContext?.timeZone ?? "UTC";
  const subject = buildHostedSignupNotificationEmailSubject(input.signupContext);

  return [
    `${subject}.`,
    "",
    `Signed up: ${formatHostedSignupLocalDateTime(occurredAt, timeZone)} (${timeZone})`,
    signupSurface
      ? `Signed up via: ${formatHostedSignupSurface(signupSurface)}`
      : input.activationSurface
      ? `Activated via: ${formatHostedSignupSurface(input.activationSurface)}`
      : null,
    location ? `Approximate location (network): ${location}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedSignupNotificationEmailSubject(
  context: HostedSignupNotificationContextV1 | null,
): string {
  return context?.location?.city
    ? `${HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT} near ${context.location.city}`
    : HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT;
}

function formatHostedSignupLocalDateTime(
  occurredAt: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(occurredAt));
}

function buildHostedSignupNotificationEmailIdempotencyKey(memberId: string): string {
  return `hosted-signup-notification/${memberId}`.slice(0, 256);
}
