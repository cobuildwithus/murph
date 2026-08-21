import {
  Resend,
  type CreateBatchOptions,
  type CreateBatchRequestOptions,
  type CreateEmailOptions,
  type CreateEmailRequestOptions,
  type Response as ResendResponse,
} from "resend";

import { normalizeNullableString, parseInteger } from "../primitives";

const RESEND_API_BASE_URL = "https://api.resend.com";
const RESEND_SDK_USER_AGENT = "resend-node:6.18.0";
const RESEND_EMAILS_PATH = "/emails";
const RESEND_BATCH_EMAILS_PATH = "/emails/batch";
const HOSTED_RESEND_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_RESEND_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_RESEND_EMAIL_MAX_TIMEOUT_MS = 30_000;

export type HostedResendPlainTextEmailEnv = Readonly<Record<string, string | undefined>>;

export type HostedResendPlainTextEmailConfig = {
  apiBaseUrl?: string;
  apiKey: string;
  from: string;
  timeoutMs: number;
};

export type HostedResendPlainTextEmailResult = {
  providerMessageId: string | null;
};

export type HostedResendPlainTextEmailBatchResult = {
  providerMessageIds: string[];
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
  replyTo?: string | null;
  signal?: AbortSignal;
  subject: string;
  text: string;
  to: string[];
}): Promise<HostedResendPlainTextEmailResult> {
  const requestSignal = input.signal
    ? AbortSignal.any([
        input.signal,
        AbortSignal.timeout(input.config.timeoutMs),
      ])
    : AbortSignal.timeout(input.config.timeoutMs);
  const resend = createHostedResendClient({
    config: input.config,
    fetchImpl: input.fetchImpl,
    requestSignal,
  });
  const replyTo = normalizeHostedResendReplyTo(input.replyTo);
  const email: CreateEmailOptions = {
    from: input.config.from,
    ...(replyTo ? { replyTo } : {}),
    subject: input.subject,
    text: input.text,
    to: input.to,
  };
  const requestOptions: CreateEmailRequestOptions = {
    headers: {
      "Idempotency-Key": input.idempotencyKey,
    },
    idempotencyKey: input.idempotencyKey,
  };
  const response = await resend.emails.send(email, requestOptions);

  if (response.error) {
    throw new HostedResendPlainTextEmailError("Hosted Resend email send failed.", {
      code: "RESEND_SEND_FAILED",
      providerStatus: response.error.statusCode,
    });
  }

  return {
    providerMessageId: readResendMessageId(response.data),
  };
}

export async function sendHostedResendPlainTextEmailBatch(input: {
  config: HostedResendPlainTextEmailConfig;
  emails: Array<{
    subject: string;
    text: string;
    to: string[];
  }>;
  fetchImpl?: typeof fetch;
  idempotencyKey: string;
}): Promise<HostedResendPlainTextEmailBatchResult> {
  const resend = createHostedResendClient({
    config: input.config,
    fetchImpl: input.fetchImpl,
    requestSignal: AbortSignal.timeout(input.config.timeoutMs),
  });
  const emails: CreateBatchOptions = input.emails.map((email) => ({
    from: input.config.from,
    subject: email.subject,
    text: email.text,
    to: email.to,
  }));
  const requestOptions: CreateBatchRequestOptions = {
    batchValidation: "strict",
    headers: {
      "Idempotency-Key": input.idempotencyKey,
    },
    idempotencyKey: input.idempotencyKey,
  };
  const response = await resend.batch.send(emails, requestOptions);

  if (response.error) {
    throw new HostedResendPlainTextEmailError(
      "Hosted Resend email batch send failed.",
      {
        code: "RESEND_BATCH_SEND_FAILED",
        providerStatus: response.error.statusCode,
      },
    );
  }

  return {
    providerMessageIds: readResendBatchMessageIds(response.data),
  };
}

function normalizeHostedResendReplyTo(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > 254 || /[\r\n]/u.test(normalized)) {
    throw new TypeError("Hosted Resend reply-to address is invalid.");
  }
  return normalized;
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

function createHostedResendClient(input: {
  config: HostedResendPlainTextEmailConfig;
  fetchImpl: typeof fetch | undefined;
  requestSignal: AbortSignal;
}): HostedResendClient {
  return new HostedResendClient({
    apiBaseUrl: input.config.apiBaseUrl ?? RESEND_API_BASE_URL,
    apiKey: input.config.apiKey,
    fetchImpl: input.fetchImpl ?? fetch,
    requestSignal: input.requestSignal,
  });
}

class HostedResendClient extends Resend {
  private readonly fetchImpl: typeof fetch;
  private readonly requestSignal: AbortSignal;

  constructor(input: {
    apiBaseUrl: string;
    apiKey: string;
    fetchImpl: typeof fetch;
    requestSignal: AbortSignal;
  }) {
    super(input.apiKey, {
      baseUrl: input.apiBaseUrl,
      userAgent: RESEND_SDK_USER_AGENT,
    });
    this.fetchImpl = input.fetchImpl;
    this.requestSignal = input.requestSignal;
  }

  override async fetchRequest<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ResendResponse<T>> {
    const requestInit: RequestInit = {
      redirect: "error",
      signal: this.requestSignal,
    };

    if (options.body !== undefined) {
      requestInit.body = options.body;
    }
    if (options.headers !== undefined) {
      requestInit.headers = normalizeResendRequestHeaders(options.headers);
    }
    if (options.method !== undefined) {
      requestInit.method = options.method;
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${path}`,
      requestInit,
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        data: null,
        error: {
          message: "Hosted Resend request failed.",
          name: "application_error",
          statusCode: response.status,
        },
        headers: null,
      };
    }

    const payload = normalizeHostedResendSuccessPayload(
      path,
      await readResendJsonPayload(response),
    );

    return {
      // The SDK selects T from the operation path. This client permits only the
      // two paths below and reconstructs their provider-owned response shapes.
      data: payload as T,
      error: null,
      headers: null,
    };
  }
}

function normalizeResendRequestHeaders(headers: HeadersInit): Record<string, string> {
  const source = new Headers(headers);
  const normalized: Record<string, string> = {};
  source.forEach((value, name) => {
    normalized[name] = value;
  });
  const knownHeaderNames = [
    "Authorization",
    "Content-Type",
    "Idempotency-Key",
    "User-Agent",
  ] as const;

  for (const name of knownHeaderNames) {
    const value = source.get(name);
    if (value !== null) {
      delete normalized[name.toLowerCase()];
      normalized[name] = value;
    }
  }

  return normalized;
}

function normalizeHostedResendSuccessPayload(
  path: string,
  value: unknown,
): unknown {
  if (path === RESEND_EMAILS_PATH) {
    return {
      id: readResendMessageId(value) ?? "",
    };
  }

  if (path === RESEND_BATCH_EMAILS_PATH) {
    return {
      data: readResendBatchMessageIds(value).map((id) => ({ id })),
    };
  }

  throw new Error("Unsupported Hosted Resend SDK request path.");
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

function readResendBatchMessageIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const data = "data" in value ? value.data : null;
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((entry) => {
    const id = readResendMessageId(entry);
    return id ? [id] : [];
  });
}
