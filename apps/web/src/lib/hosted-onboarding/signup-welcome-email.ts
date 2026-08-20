import { HostedBillingStatus } from "@prisma/client";

import {
  MURPH_CONTACT_EMAIL,
  MURPH_TELEGRAM_BOT_USERNAME,
  normalizeMurphTelegramUsername,
} from "../murph-contact-routing";
import { getPrisma } from "../prisma";
import { normalizeNullableString } from "../primitives";
import {
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-store";
import {
  claimHostedMemberSignupWelcomeEmailAttempt,
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import {
  HostedResendPlainTextEmailError,
  readHostedResendPlainTextEmailConfig,
  sendHostedResendPlainTextEmail,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email";

const HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT = "Welcome to Murph";
const HOSTED_SIGNUP_WELCOME_EMAIL_RECENT_MEMBER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

type HostedSignupWelcomeEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedSignupWelcomeEmailResult =
  | {
      reason:
        | "already_attempted"
        | "member_not_active"
        | "member_not_found"
        | "member_too_old"
        | "no_welcome_email_recipient"
        | "not_configured";
      status: "skipped";
    }
  | {
      providerMessageId: string | null;
      status: "sent";
    };

export const HostedSignupWelcomeEmailError = HostedResendPlainTextEmailError;
export type HostedSignupWelcomeEmailError = HostedResendPlainTextEmailError;

export async function sendHostedSignupWelcomeEmailForRecentMember(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  maxAccountAgeMs?: number;
  memberId: string;
  now?: Date;
  prisma?: Parameters<typeof readHostedMemberCoreState>[0]["prisma"];
}): Promise<HostedSignupWelcomeEmailResult> {
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

  if (
    !isHostedSignupWelcomeEmailRecentMember({
      maxAccountAgeMs: input.maxAccountAgeMs
        ?? HOSTED_SIGNUP_WELCOME_EMAIL_RECENT_MEMBER_MAX_AGE_MS,
      memberCreatedAt: member.createdAt,
      now: input.now ?? new Date(),
    })
  ) {
    return {
      reason: "member_too_old",
      status: "skipped",
    };
  }

  return sendHostedSignupWelcomeEmailForMember({
    env: input.env,
    fetchImpl: input.fetchImpl,
    member,
    memberId: input.memberId,
    now: input.now,
    prisma,
  });
}

export async function sendHostedSignupWelcomeEmailForMember(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  member?: HostedMemberCoreState;
  memberId: string;
  now?: Date;
  prisma?: Parameters<typeof readHostedMemberEmailAuthorization>[0]["prisma"];
}): Promise<HostedSignupWelcomeEmailResult> {
  const prisma = input.prisma ?? getPrisma();
  const member = input.member ?? await readHostedMemberCoreState({
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
  const recipient = readHostedSignupWelcomeEmailRecipient(emailAuthorization);

  if (!recipient) {
    return {
      reason: "no_welcome_email_recipient",
      status: "skipped",
    };
  }

  const config = readHostedSignupWelcomeEmailConfig(input.env ?? process.env);

  if (!config) {
    return {
      reason: "not_configured",
      status: "skipped",
    };
  }

  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma,
  });
  const murphStartLine = buildHostedSignupWelcomeEmailMurphStartLine({
    allowDirectEmailRoute: recipient.source === "verifiedEmail",
    routing,
    source: input.env ?? process.env,
  });

  const claimed = await claimHostedMemberSignupWelcomeEmailAttempt({
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

  return sendHostedSignupWelcomeEmailWithConfig({
    config,
    fetchImpl: input.fetchImpl,
    memberId: input.memberId,
    murphStartLine,
    recipientEmail: recipient.address,
  });
}

export async function sendHostedSignupWelcomeEmail(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  murphStartLine?: string | null;
  recipientEmail: string;
}): Promise<HostedSignupWelcomeEmailResult> {
  const config = readHostedSignupWelcomeEmailConfig(input.env ?? process.env);

  if (!config) {
    return {
      reason: "not_configured",
      status: "skipped",
    };
  }

  return sendHostedSignupWelcomeEmailWithConfig({
    config,
    fetchImpl: input.fetchImpl,
    memberId: input.memberId,
    murphStartLine: input.murphStartLine,
    recipientEmail: input.recipientEmail,
  });
}

export async function sendHostedSignupWelcomeEmailForMemberBestEffort(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  prisma?: Parameters<typeof readHostedMemberEmailAuthorization>[0]["prisma"];
}): Promise<void> {
  try {
    await sendHostedSignupWelcomeEmailForMember(input);
  } catch (error) {
    console.warn("Hosted signup welcome email send failed.", {
      ...(error instanceof HostedSignupWelcomeEmailError
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

async function sendHostedSignupWelcomeEmailWithConfig(input: {
  config: HostedSignupWelcomeEmailConfig;
  fetchImpl?: typeof fetch;
  memberId: string;
  murphStartLine?: string | null;
  recipientEmail: string;
}): Promise<HostedSignupWelcomeEmailResult> {
  const result = await sendHostedResendPlainTextEmail({
    config: input.config.resend,
    fetchImpl: input.fetchImpl,
    idempotencyKey: buildHostedSignupWelcomeEmailIdempotencyKey(input.memberId),
    subject: HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT,
    text: buildHostedSignupWelcomeEmailText({
      founderName: input.config.founderName,
      murphStartLine: input.murphStartLine,
    }),
    to: [input.recipientEmail],
  });

  return {
    providerMessageId: result.providerMessageId,
    status: "sent",
  };
}

type HostedSignupWelcomeEmailConfig = {
  founderName: string;
  resend: HostedResendPlainTextEmailConfig;
};

type HostedSignupWelcomeEmailRecipient = {
  address: string;
  source: "stripeCheckoutEmail" | "verifiedEmail";
};

function readHostedSignupWelcomeEmailRecipient(
  emailAuthorization: Awaited<ReturnType<typeof readHostedMemberEmailAuthorization>>,
): HostedSignupWelcomeEmailRecipient | null {
  if (emailAuthorization?.verifiedEmail?.address) {
    return {
      address: emailAuthorization.verifiedEmail.address,
      source: "verifiedEmail",
    };
  }

  if (emailAuthorization?.stripeCheckoutEmail?.address) {
    return {
      address: emailAuthorization.stripeCheckoutEmail.address,
      source: "stripeCheckoutEmail",
    };
  }

  return null;
}

function readHostedSignupWelcomeEmailConfig(
  source: HostedSignupWelcomeEmailEnv,
): HostedSignupWelcomeEmailConfig | null {
  const resend = readHostedResendPlainTextEmailConfig(source);
  const founderName = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME);

  if (!resend || !founderName) {
    return null;
  }

  return {
    founderName,
    resend,
  };
}

function isHostedSignupWelcomeEmailRecentMember(input: {
  maxAccountAgeMs: number;
  memberCreatedAt: Date;
  now: Date;
}): boolean {
  return input.now.getTime() - input.memberCreatedAt.getTime() < input.maxAccountAgeMs;
}

function buildHostedSignupWelcomeEmailText(input: {
  founderName: string;
  murphStartLine?: string | null;
}): string {
  const murphStartLine = normalizeNullableString(input.murphStartLine);
  const nextStep = murphStartLine
    ? "Best next step: bring Murph one real health question, task, data point, decision, or goal."
    : "Best next step: connect any data you want Murph to use, then start with one real health need.";

  return [
    "Hey, welcome to Murph!",
    "",
    `I'm ${input.founderName}, the founder. I built Murph because health is hard to figure out alone. My data, questions, plans, and follow-through lived in different places, and every tool started without the rest of the picture.`,
    "",
    "Murph is the personal health assistant I wanted to text whenever something came up: a question or decision, data I wanted understood, a change I was trying to make, or a task I needed help handling.",
    "",
    "Murph remembers the useful context, so the help can get more personal instead of starting over every time. It can research, interpret your data, help you plan and follow through, handle supported health errands, run an experiment when you're unsure what works, or bring in people you trust when accountability would help.",
    "",
    nextStep,
    ...(murphStartLine ? ["", murphStartLine] : []),
    "",
    "Hit reply if anything's confusing or broken. We're early and shipping fast.",
    "",
    `- ${input.founderName}`,
  ].join("\n");
}

function buildHostedSignupWelcomeEmailMurphStartLine(input: {
  allowDirectEmailRoute: boolean;
  routing: HostedMemberRoutingStateSnapshot | null;
  source: HostedSignupWelcomeEmailEnv;
}): string | null {
  const linqRecipientPhone = normalizeNullableString(input.routing?.linqRecipientPhone)
    ?? normalizeNullableString(input.routing?.pendingLinqRecipientPhone);

  if (linqRecipientPhone) {
    const formattedPhone = formatHostedSignupWelcomeEmailPhoneNumber(linqRecipientPhone);

    return `Text Murph at ${formattedPhone} with whatever is on your mind about your health.`;
  }

  if (
    normalizeNullableString(input.routing?.telegramUserId)
    || normalizeNullableString(input.routing?.telegramUserLookupKey)
    || normalizeNullableString(input.routing?.telegramThreadId)
  ) {
    const username = readHostedSignupWelcomeEmailTelegramUsername(input.source);

    return `Message Murph on Telegram at ${username} with whatever is on your mind about your health.`;
  }

  return input.allowDirectEmailRoute
    ? `Email Murph at ${MURPH_CONTACT_EMAIL}. Murph will send a private reply so you can start the conversation securely.`
    : null;
}

function readHostedSignupWelcomeEmailTelegramUsername(
  source: HostedSignupWelcomeEmailEnv,
): string {
  const username = normalizeMurphTelegramUsername(source.MURPH_TELEGRAM_USERNAME_OVERRIDE)
    ?? normalizeMurphTelegramUsername(source.TELEGRAM_BOT_USERNAME)
    ?? MURPH_TELEGRAM_BOT_USERNAME;

  return `@${username}`;
}

function formatHostedSignupWelcomeEmailPhoneNumber(phoneNumber: string): string {
  const normalized = phoneNumber.trim();
  const digits = normalized.replace(/\D/g, "");

  if (normalized.startsWith("+") && digits.length === 11 && digits.startsWith("1")) {
    return `(+1) ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return normalized;
}

function buildHostedSignupWelcomeEmailIdempotencyKey(memberId: string): string {
  return `hosted-signup-welcome/${memberId}`.slice(0, 256);
}
