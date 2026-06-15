import { HostedBillingStatus, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { normalizeNullableString, parseCommaSeparatedList, parseInteger } from "../primitives";
import {
  claimHostedMemberSignupNotificationEmailAttempt,
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
} from "./hosted-member-store";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT = "New Murph signup";
const HOSTED_SIGNUP_NOTIFICATION_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_SIGNUP_NOTIFICATION_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_SIGNUP_NOTIFICATION_EMAIL_MAX_TIMEOUT_MS = 30_000;

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

export class HostedSignupNotificationEmailError extends Error {
  code: string;
  providerStatus: number | null;

  constructor(message: string, input: { code: string; providerStatus?: number | null }) {
    super(message);
    this.name = "HostedSignupNotificationEmailError";
    this.code = input.code;
    this.providerStatus = input.providerStatus ?? null;
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
  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma,
  });

  if (!member) {
    return {
      reason: "member_not_found",
      status: "skipped",
    };
  }

  if (member.billingStatus !== HostedBillingStatus.active || member.suspendedAt) {
    return {
      reason: "member_not_active",
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

  const response = await (input.fetchImpl ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    body: JSON.stringify({
      from: config.from,
      subject: HOSTED_SIGNUP_NOTIFICATION_EMAIL_SUBJECT,
      text: buildHostedSignupNotificationEmailText({
        billingStatus: member.billingStatus,
        customerEmail,
        memberId: input.memberId,
        sourceEventId: input.sourceEventId,
        sourceEventType: input.sourceEventType,
      }),
      to: config.recipients,
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": buildHostedSignupNotificationEmailIdempotencyKey(input.memberId),
    },
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new HostedSignupNotificationEmailError(
      "Hosted signup notification email send failed.",
      {
        code: "RESEND_SEND_FAILED",
        providerStatus: response.status,
      },
    );
  }

  const payload = await readResendJsonPayload(response);

  return {
    providerMessageId: readResendMessageId(payload),
    status: "sent",
  };
}

type HostedSignupNotificationEmailConfig = {
  apiKey: string;
  from: string;
  recipients: string[];
  timeoutMs: number;
};

function readHostedSignupNotificationEmailConfig(
  source: HostedSignupNotificationEmailEnv,
): HostedSignupNotificationEmailConfig | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FROM);
  const recipients = readHostedSignupNotificationEmailRecipients(
    source.HOSTED_SIGNUP_NOTIFICATION_EMAILS,
  );

  if (!apiKey || !from || recipients.length === 0) {
    return null;
  }

  return {
    apiKey,
    from,
    recipients,
    timeoutMs: readHostedSignupNotificationEmailTimeoutMs(source),
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

function readHostedSignupNotificationEmailTimeoutMs(
  source: HostedSignupNotificationEmailEnv,
): number {
  const configured = parseInteger(source.HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS);

  if (!configured) {
    return HOSTED_SIGNUP_NOTIFICATION_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_SIGNUP_NOTIFICATION_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_SIGNUP_NOTIFICATION_EMAIL_MAX_TIMEOUT_MS,
  );
}

function buildHostedSignupNotificationEmailText(input: {
  billingStatus: string;
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
    `Billing status: ${input.billingStatus}`,
    input.sourceEventType ? `Stripe event: ${input.sourceEventType}` : null,
    input.sourceEventId ? `Stripe event ID: ${input.sourceEventId}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedSignupNotificationEmailIdempotencyKey(memberId: string): string {
  return `hosted-signup-notification/${memberId}`.slice(0, 256);
}

async function readResendJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readResendMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id = "id" in value ? value.id : null;
  return typeof id === "string" && id ? id : null;
}
