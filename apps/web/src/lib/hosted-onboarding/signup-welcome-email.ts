import { MURPH_CONTACT_EMAIL, MURPH_TELEGRAM_BOT_USERNAME } from "../murph-contact-routing";
import { getPrisma } from "../prisma";
import { normalizeNullableString, parseInteger } from "../primitives";
import {
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-store";
import {
  readHostedMemberCoreState,
  readHostedMemberEmailAuthorization,
} from "./hosted-member-store";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT = "Welcome to Murph";
const HOSTED_SIGNUP_WELCOME_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_SIGNUP_WELCOME_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_SIGNUP_WELCOME_EMAIL_MAX_TIMEOUT_MS = 30_000;
const HOSTED_SIGNUP_WELCOME_EMAIL_RECENT_MEMBER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

type HostedSignupWelcomeEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedSignupWelcomeEmailResult =
  | {
      reason:
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

export class HostedSignupWelcomeEmailError extends Error {
  code: string;
  providerStatus: number | null;

  constructor(message: string, input: { code: string; providerStatus?: number | null }) {
    super(message);
    this.name = "HostedSignupWelcomeEmailError";
    this.code = input.code;
    this.providerStatus = input.providerStatus ?? null;
  }
}

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
    memberId: input.memberId,
    prisma,
  });
}

export async function sendHostedSignupWelcomeEmailForMember(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  prisma?: Parameters<typeof readHostedMemberEmailAuthorization>[0]["prisma"];
}): Promise<HostedSignupWelcomeEmailResult> {
  const prisma = input.prisma ?? getPrisma();
  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: input.memberId,
    prisma,
  });
  const recipientEmail = emailAuthorization?.verifiedEmail?.address
    ?? emailAuthorization?.stripeCheckoutEmail?.address
    ?? null;

  if (!recipientEmail) {
    return {
      reason: "no_welcome_email_recipient",
      status: "skipped",
    };
  }

  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma,
  });
  const murphStartLine = buildHostedSignupWelcomeEmailMurphStartLine({
    routing,
    source: input.env ?? process.env,
  });

  return sendHostedSignupWelcomeEmail({
    env: input.env,
    fetchImpl: input.fetchImpl,
    memberId: input.memberId,
    murphStartLine,
    recipientEmail,
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

  const response = await (input.fetchImpl ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    body: JSON.stringify({
      from: config.from,
      subject: HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT,
      text: buildHostedSignupWelcomeEmailText({
        founderName: config.founderName,
        murphStartLine: input.murphStartLine,
      }),
      to: [input.recipientEmail],
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": buildHostedSignupWelcomeEmailIdempotencyKey(input.memberId),
    },
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new HostedSignupWelcomeEmailError("Hosted signup welcome email send failed.", {
      code: "RESEND_SEND_FAILED",
      providerStatus: response.status,
    });
  }

  const payload = await readResendJsonPayload(response);

  return {
    providerMessageId: readResendMessageId(payload),
    status: "sent",
  };
}

function readHostedSignupWelcomeEmailConfig(source: HostedSignupWelcomeEmailEnv): {
  apiKey: string;
  founderName: string;
  from: string;
  timeoutMs: number;
} | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FROM);
  const founderName = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME);

  if (!apiKey || !from || !founderName) {
    return null;
  }

  return {
    apiKey,
    founderName,
    from,
    timeoutMs: readHostedSignupWelcomeEmailTimeoutMs(source),
  };
}

function readHostedSignupWelcomeEmailTimeoutMs(source: HostedSignupWelcomeEmailEnv): number {
  const configured = parseInteger(source.HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS);

  if (!configured) {
    return HOSTED_SIGNUP_WELCOME_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_SIGNUP_WELCOME_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_SIGNUP_WELCOME_EMAIL_MAX_TIMEOUT_MS,
  );
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
    ? "Best next step: sync your data and text Murph."
    : "Best next step: sync your data and text Murph to kick off your first experiment.";

  return [
    "Hey, welcome to Murph!",
    "",
    `I'm ${input.founderName}, the founder. I built Murph because I owned a WHOOP, checked my scores every morning, and never really used the data to build healthier habits.`,
    "",
    "What I really wanted was to try a fun health experiment and see if it worked. Stuff like saunas, cold plunges, sprint routines, supplements, and measure how they changed my biomarkers (without having to build a spreadsheet to track it all).",
    "",
    "That's basically what Murph does. You pick a protocol, and Murph runs the experiment and keeps you accountable over text, no busywork for you. At the end, it compares your data before and after so you can see what's actually making you healthier.",
    "",
    nextStep,
    ...(murphStartLine ? ["", murphStartLine] : []),
    "",
    "Hit reply if anything's confusing or broken. We're early and shipping fast, and I want to hear it.",
    "",
    `- ${input.founderName}`,
  ].join("\n");
}

function buildHostedSignupWelcomeEmailMurphStartLine(input: {
  routing: HostedMemberRoutingStateSnapshot | null;
  source: HostedSignupWelcomeEmailEnv;
}): string {
  const linqRecipientPhone = normalizeNullableString(input.routing?.linqRecipientPhone)
    ?? normalizeNullableString(input.routing?.pendingLinqRecipientPhone);

  if (linqRecipientPhone) {
    const formattedPhone = formatHostedSignupWelcomeEmailPhoneNumber(linqRecipientPhone);

    return `Shoot Murph a text at ${formattedPhone} to start your first experiment.`;
  }

  if (
    normalizeNullableString(input.routing?.telegramUserId)
    || normalizeNullableString(input.routing?.telegramUserLookupKey)
    || normalizeNullableString(input.routing?.telegramThreadId)
  ) {
    const username = readHostedSignupWelcomeEmailTelegramUsername(input.source);

    return `Shoot Murph a message on Telegram at ${username} to start your first experiment.`;
  }

  return `Shoot Murph an email at ${MURPH_CONTACT_EMAIL} to start your first experiment.`;
}

function readHostedSignupWelcomeEmailTelegramUsername(
  source: HostedSignupWelcomeEmailEnv,
): string {
  const username = normalizeNullableString(source.TELEGRAM_BOT_USERNAME)
    ?? MURPH_TELEGRAM_BOT_USERNAME;

  return username.startsWith("@") ? username : `@${username}`;
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
