import { normalizeNullableString, parseInteger } from "../primitives";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const HOSTED_RESEND_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_RESEND_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_RESEND_EMAIL_MAX_TIMEOUT_MS = 30_000;

export type HostedResendPlainTextEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedResendPlainTextEmailConfig = {
  apiKey: string;
  from: string;
  timeoutMs: number;
};

export type HostedResendPlainTextEmailResult = {
  providerMessageId: string | null;
};

export class HostedResendPlainTextEmailError extends Error {
  code: string;
  providerStatus: number | null;

  constructor(message: string, input: { code: string; providerStatus?: number | null }) {
    super(message);
    this.name = "HostedResendPlainTextEmailError";
    this.code = input.code;
    this.providerStatus = input.providerStatus ?? null;
  }
}

export function readHostedResendPlainTextEmailConfig(
  source: HostedResendPlainTextEmailEnv,
): HostedResendPlainTextEmailConfig | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_SIGNUP_WELCOME_EMAIL_FROM);

  if (!apiKey || !from) {
    return null;
  }

  return {
    apiKey,
    from,
    timeoutMs: readHostedResendPlainTextEmailTimeoutMs(source),
  };
}

export async function sendHostedResendPlainTextEmail(input: {
  config: HostedResendPlainTextEmailConfig;
  fetchImpl?: typeof fetch;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string[];
}): Promise<HostedResendPlainTextEmailResult> {
  const response = await (input.fetchImpl ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    body: JSON.stringify({
      from: input.config.from,
      subject: input.subject,
      text: input.text,
      to: input.to,
    }),
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(input.config.timeoutMs),
  });

  if (!response.ok) {
    throw new HostedResendPlainTextEmailError("Hosted Resend email send failed.", {
      code: "RESEND_SEND_FAILED",
      providerStatus: response.status,
    });
  }

  const payload = await readResendJsonPayload(response);

  return {
    providerMessageId: readResendMessageId(payload),
  };
}

function readHostedResendPlainTextEmailTimeoutMs(
  source: HostedResendPlainTextEmailEnv,
): number {
  const configured = parseInteger(source.HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS);

  if (!configured) {
    return HOSTED_RESEND_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_RESEND_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_RESEND_EMAIL_MAX_TIMEOUT_MS,
  );
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
