import { MURPH_CONTACT_EMAIL, MURPH_TELEGRAM_BOT_USERNAME } from "../murph-contact-routing";
import { getPrisma } from "../prisma";
import { normalizeNullableString, parseInteger } from "../primitives";
import {
  readHostedMemberRoutingState,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-store";
import { readHostedMemberEmailAuthorization } from "./hosted-member-store";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT = "Welcome to Murph";
const HOSTED_SIGNUP_WELCOME_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_SIGNUP_WELCOME_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_SIGNUP_WELCOME_EMAIL_MAX_TIMEOUT_MS = 30_000;

type HostedSignupWelcomeEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedSignupWelcomeEmailResult =
  | {
      reason: "not_configured" | "no_verified_email";
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
  const recipientEmail = emailAuthorization?.verifiedEmail?.address ?? null;

  if (!recipientEmail) {
    return {
      reason: "no_verified_email",
      status: "skipped",
    };
  }

  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma,
  });

  return sendHostedSignupWelcomeEmail({
    env: input.env,
    fetchImpl: input.fetchImpl,
    memberId: input.memberId,
    murphStartLine: buildHostedSignupWelcomeEmailMurphStartLine({
      routing,
      source: input.env ?? process.env,
    }),
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

function buildHostedSignupWelcomeEmailText(input: {
  founderName: string;
  murphStartLine?: string | null;
}): string {
  const murphStartLine = normalizeNullableString(input.murphStartLine);
  const nextStep = murphStartLine
    ? "At the end you see what actually improved. Best thing to do right now is connect your wearable."
    : "At the end you see what actually improved. Best thing to do right now is connect your wearable and start your first experiment!";

  return [
    "Hey, welcome to Murph!",
    "",
    `I'm ${input.founderName}, the founder of Murph. I built Murph because I had a WHOOP and kept looking at my scores every morning without really using the data.`,
    "",
    "What I really wanted was a way to try a new health experiment, see if it worked, and move on. That's basically what Murph does. You sync your health data, pick a protocol, and it runs you through an experiment over text.",
    "",
    nextStep,
    ...(murphStartLine ? ["", murphStartLine] : []),
    "",
    "Hit reply if anything is confusing or not working. We're early, shipping fast, and I want to hear it!",
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
    return `Shoot Murph a text at ${linqRecipientPhone} to start your first experiment.`;
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
