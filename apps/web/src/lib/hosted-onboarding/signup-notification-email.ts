import "server-only";

import { type PrismaClient } from "@prisma/client";
import { after } from "next/server";

import { getPrisma } from "../prisma";
import { parseCommaSeparatedList } from "../primitives";
import {
  claimHostedMemberSignupNotificationEmailAttempt,
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
  readHostedMemberSignupNotificationContext,
} from "./hosted-member-store";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email";
import {
  formatHostedSignupLocation,
  formatHostedSignupSurface,
  type HostedSignupNotificationContextV1,
  type HostedSignupSurface,
} from "./signup-notification-context";

const HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT = "New Murph signup";

type HostedSignupNotificationEmailEnv = Readonly<Record<string, string | undefined>>;

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
  memberIds: readonly string[];
  prisma: PrismaClient;
  surface?: HostedSignupSurface;
}): void {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return;
  }

  const task = async () => {
    for (const memberId of memberIds) {
      await sendHostedSignupNotificationEmailForMemberBestEffort({
        memberId,
        prisma: input.prisma,
        surface: input.surface,
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
  env?: HostedSignupNotificationEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  surface?: HostedSignupSurface;
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
  env?: HostedSignupNotificationEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  surface?: HostedSignupSurface;
}): Promise<HostedSignupNotificationEmailResult> {
  const config = readHostedSignupNotificationEmailConfig(input.env ?? process.env);

  if (!config) {
    await claimHostedMemberSignupNotificationEmailAttempt({
      attemptedAt: input.now ?? new Date(),
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
  });
  const customerEmail = emailAuthorization?.verifiedEmail?.address
    ?? emailAuthorization?.stripeCheckoutEmail?.address
    ?? null;

  const claimed = await claimHostedMemberSignupNotificationEmailAttempt({
    attemptedAt: input.now ?? new Date(),
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
      fallbackOccurredAt: signupSnapshot.createdAt,
      fallbackSurface: input.surface,
      signupContext: signupSnapshot.context,
    }),
    to: config.recipients,
  });

  return {
    providerMessageId: result.providerMessageId,
    status: "sent",
  };
}

type HostedSignupNotificationEmailConfig = {
  recipients: string[];
  resend: HostedResendPlainTextEmailConfig;
};

function readHostedSignupNotificationEmailConfig(
  source: HostedSignupNotificationEmailEnv,
): HostedSignupNotificationEmailConfig | null {
  const resend = readHostedResendPlainTextEmailConfig(source);
  const recipients = readHostedSignupNotificationEmailRecipients(
    source.HOSTED_SIGNUP_NOTIFICATION_EMAILS,
  );

  if (!resend || recipients.length === 0) {
    return null;
  }

  return {
    recipients,
    resend,
  };
}

function readHostedSignupNotificationEmailRecipients(value: string | undefined): string[] {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const email of parseCommaSeparatedList(value)) {
    const seenKey = email.toLowerCase();

    if (seen.has(seenKey)) {
      continue;
    }

    seen.add(seenKey);
    recipients.push(email);
  }

  return recipients;
}

function buildHostedSignupNotificationEmailText(input: {
  customerEmail?: string | null;
  fallbackOccurredAt: Date;
  fallbackSurface?: HostedSignupSurface;
  signupContext: HostedSignupNotificationContextV1 | null;
}): string {
  const location = formatHostedSignupLocation(input.signupContext?.location);
  const occurredAt = input.signupContext?.occurredAt
    ?? input.fallbackOccurredAt.toISOString();
  const surface = input.signupContext?.surface ?? input.fallbackSurface;
  const timeZone = input.signupContext?.timeZone ?? "UTC";
  const subject = buildHostedSignupNotificationEmailSubject(input.signupContext);

  return [
    `${subject}.`,
    "",
    `Signed up: ${formatHostedSignupLocalDateTime(occurredAt, timeZone)} (${timeZone})`,
    surface ? `Source: ${formatHostedSignupSurface(surface)}` : null,
    location ? `Location: ${location}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedSignupNotificationEmailSubject(
  context: HostedSignupNotificationContextV1 | null,
): string {
  const location = formatHostedSignupLocation(context?.location);
  return location
    ? `${HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT} from ${context?.location?.city ?? location}`
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
