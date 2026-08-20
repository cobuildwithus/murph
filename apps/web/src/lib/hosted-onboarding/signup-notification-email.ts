import "server-only";

import { type PrismaClient } from "@prisma/client";
import { after } from "next/server";

import { getPrisma } from "../prisma";
import { parseCommaSeparatedList } from "../primitives";
import {
  claimHostedMemberSignupNotificationEmailAttempt,
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
} from "./hosted-member-store";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email";

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
  sourceEventId?: string | null;
  sourceEventType?: string | null;
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
        sourceEventId: input.sourceEventId,
        sourceEventType: input.sourceEventType,
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
  sourceEventId?: string | null;
  sourceEventType?: string | null;
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
  sourceEventId?: string | null;
  sourceEventType?: string | null;
}): Promise<HostedSignupNotificationEmailResult> {
  const config = readHostedSignupNotificationEmailConfig(input.env ?? process.env);

  if (!config) {
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
    subject: HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT,
    text: buildHostedSignupNotificationEmailText({
      customerEmail,
      memberId: input.memberId,
      sourceEventId: input.sourceEventId,
      sourceEventType: input.sourceEventType,
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
  memberId: string;
  sourceEventId?: string | null;
  sourceEventType?: string | null;
}): string {
  return [
    "New Murph signup.",
    "",
    `Member ID: ${input.memberId}`,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    input.sourceEventType ? `Stripe event: ${input.sourceEventType}` : null,
    input.sourceEventId ? `Stripe event ID: ${input.sourceEventId}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedSignupNotificationEmailIdempotencyKey(memberId: string): string {
  return `hosted-signup-notification/${memberId}`.slice(0, 256);
}
