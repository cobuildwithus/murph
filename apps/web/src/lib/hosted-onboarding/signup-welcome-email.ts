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

type HostedSignupWelcomeEmailStartAction =
  | {
      href: string;
      kind: "email";
      label: string;
      line: string;
    }
  | {
      href: string;
      kind: "telegram";
      label: string;
      line: string;
    }
  | {
      href: string;
      kind: "text";
      label: string;
      line: string;
    };

export type HostedSignupWelcomeEmailResult =
  | {
      reason: "member_not_found" | "member_too_old" | "no_verified_email" | "not_configured";
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
      reason: "no_verified_email",
      status: "skipped",
    };
  }

  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma,
  });
  const murphStartAction = buildHostedSignupWelcomeEmailMurphStartAction({
    routing,
    source: input.env ?? process.env,
  });

  return sendHostedSignupWelcomeEmail({
    env: input.env,
    fetchImpl: input.fetchImpl,
    memberId: input.memberId,
    murphStartAction,
    recipientEmail,
  });
}

export async function sendHostedSignupWelcomeEmail(input: {
  env?: HostedSignupWelcomeEmailEnv;
  fetchImpl?: typeof fetch;
  memberId: string;
  murphStartAction?: HostedSignupWelcomeEmailStartAction | null;
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

  const murphStartLine = input.murphStartAction?.line ?? input.murphStartLine;
  const response = await (input.fetchImpl ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    body: JSON.stringify({
      from: config.from,
      html: buildHostedSignupWelcomeEmailHtml({
        founderName: config.founderName,
        murphStartAction: input.murphStartAction,
        murphStartLine,
      }),
      subject: HOSTED_SIGNUP_WELCOME_EMAIL_SUBJECT,
      text: buildHostedSignupWelcomeEmailText({
        founderName: config.founderName,
        murphStartLine,
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
    ? "At the end you see what actually improved. Best thing to do right now is sync your wearable or health data and text Murph."
    : "At the end you see what actually improved. Best thing to do right now is sync your wearable or health data and text Murph to start your first experiment!";

  return [
    "Hey, welcome to Murph!",
    "",
    `I'm ${input.founderName}, the founder of Murph. I built Murph because I had a WHOOP and kept looking at my scores every morning without really using the data.`,
    "",
    "What I really wanted was a way to try a new health experiment and actually know whether it's working. That's basically what Murph does. You sync your wearable or health data, pick a protocol, and it runs you through an experiment over text.",
    "",
    nextStep,
    ...(murphStartLine ? ["", murphStartLine] : []),
    "",
    "Email me if anything's confusing or not working. We're early, shipping fast, and I want to hear it!",
    "",
    `- ${input.founderName}`,
  ].join("\n");
}

function buildHostedSignupWelcomeEmailHtml(input: {
  founderName: string;
  murphStartAction?: HostedSignupWelcomeEmailStartAction | null;
  murphStartLine?: string | null;
}): string {
  const murphStartLine = normalizeNullableString(
    input.murphStartAction?.line ?? input.murphStartLine,
  );
  const nextStep = murphStartLine
    ? "At the end you see what actually improved. Best thing to do right now is sync your wearable or health data and text Murph."
    : "At the end you see what actually improved. Best thing to do right now is sync your wearable or health data and text Murph to start your first experiment!";
  const paragraphs = [
    "Hey, welcome to Murph!",
    `I'm ${input.founderName}, the founder of Murph. I built Murph because I had a WHOOP and kept looking at my scores every morning without really using the data.`,
    "What I really wanted was a way to try a new health experiment and actually know whether it's working. That's basically what Murph does. You sync your wearable or health data, pick a protocol, and it runs you through an experiment over text.",
    nextStep,
  ];
  const body = [
    ...paragraphs.map(renderHostedSignupWelcomeEmailParagraphHtml),
    ...(murphStartLine
      ? [
          renderHostedSignupWelcomeEmailRawParagraphHtml(
            buildHostedSignupWelcomeEmailStartLineHtml({
              action: input.murphStartAction ?? null,
              fallbackLine: murphStartLine,
            }),
          ),
        ]
      : []),
    renderHostedSignupWelcomeEmailParagraphHtml(
      "Email me if anything's confusing or not working. We're early, shipping fast, and I want to hear it!",
    ),
    renderHostedSignupWelcomeEmailParagraphHtml(`- ${input.founderName}`),
  ];

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<body style=\"margin:0;padding:32px;background:#ffffff;color:#222222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.55;\">",
    '<main style="max-width:680px;">',
    ...body,
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function buildHostedSignupWelcomeEmailMurphStartAction(input: {
  routing: HostedMemberRoutingStateSnapshot | null;
  source: HostedSignupWelcomeEmailEnv;
}): HostedSignupWelcomeEmailStartAction {
  const linqRecipientPhone = normalizeNullableString(input.routing?.linqRecipientPhone)
    ?? normalizeNullableString(input.routing?.pendingLinqRecipientPhone);

  if (linqRecipientPhone) {
    const formattedPhone = formatHostedSignupWelcomeEmailPhoneNumber(linqRecipientPhone);

    return {
      href: buildHostedSignupWelcomeEmailSmsHref(linqRecipientPhone),
      kind: "text",
      label: formattedPhone,
      line: `Shoot Murph a text at ${formattedPhone} to start your first experiment.`,
    };
  }

  if (
    normalizeNullableString(input.routing?.telegramUserId)
    || normalizeNullableString(input.routing?.telegramUserLookupKey)
    || normalizeNullableString(input.routing?.telegramThreadId)
  ) {
    const username = readHostedSignupWelcomeEmailTelegramUsername(input.source);

    return {
      href: `https://t.me/${username.slice(1)}`,
      kind: "telegram",
      label: username,
      line: `Shoot Murph a message on Telegram at ${username} to start your first experiment.`,
    };
  }

  return {
    href: `mailto:${MURPH_CONTACT_EMAIL}`,
    kind: "email",
    label: MURPH_CONTACT_EMAIL,
    line: `Shoot Murph an email at ${MURPH_CONTACT_EMAIL} to start your first experiment.`,
  };
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

function buildHostedSignupWelcomeEmailSmsHref(phoneNumber: string): string {
  const normalized = phoneNumber.trim();
  const compactPhoneNumber = normalized.replace(/[^\d+]/g, "");

  return `sms:${compactPhoneNumber || normalized}`;
}

function buildHostedSignupWelcomeEmailStartLineHtml(input: {
  action: HostedSignupWelcomeEmailStartAction | null;
  fallbackLine: string;
}): string {
  if (!input.action) {
    return escapeHostedSignupWelcomeEmailHtml(input.fallbackLine);
  }

  const escapedHref = escapeHostedSignupWelcomeEmailHtml(input.action.href);
  const escapedLabel = escapeHostedSignupWelcomeEmailHtml(input.action.label);
  const linkedLabel = `<a href="${escapedHref}" style="color:#0b57d0;text-decoration:underline;">${escapedLabel}</a>`;

  switch (input.action.kind) {
    case "email":
      return `Shoot Murph an email at ${linkedLabel} to start your first experiment.`;
    case "telegram":
      return `Shoot Murph a message on Telegram at ${linkedLabel} to start your first experiment.`;
    case "text":
      return `Shoot Murph a text at ${linkedLabel} to start your first experiment.`;
  }
}

function renderHostedSignupWelcomeEmailParagraphHtml(value: string): string {
  return renderHostedSignupWelcomeEmailRawParagraphHtml(
    escapeHostedSignupWelcomeEmailHtml(value),
  );
}

function renderHostedSignupWelcomeEmailRawParagraphHtml(value: string): string {
  return `<p style="margin:0 0 24px;">${value}</p>`;
}

function escapeHostedSignupWelcomeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
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
