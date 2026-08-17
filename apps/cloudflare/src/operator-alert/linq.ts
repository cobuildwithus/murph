import LinqAPIV3, { APIError } from "@linqapp/sdk";
import type {
  Chat,
  MessageCreateParams,
  PhoneNumberListResponse,
} from "@linqapp/sdk/resources";

const OPERATOR_ALERT_LINQ_SDK_BASE_URL = "https://linq-sdk.invalid";
const OPERATOR_ALERT_FETCH_TIMEOUT_MS = 10_000;
const LINQ_HEALTH_BODY_LIMIT_BYTES = 256 * 1_024;

export type OperatorAlertFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class OperatorAlertLinqError extends Error {
  constructor(
    readonly code:
      | "linq_duplicate_recipient"
      | "linq_health_suppressed"
      | "linq_health_unavailable"
      | "linq_rejected_response"
      | "linq_retryable_response",
  ) {
    super(code);
    this.name = "OperatorAlertLinqError";
  }
}

/**
 * Delivers one already-persisted operator page to both configured direct
 * chats. Callers own incident state, pacing, and exact pending bytes; this
 * helper owns only secret-safe Linq destination validation and egress.
 */
export async function sendOperatorLinqAlert(input: {
  apiBaseUrl: string;
  apiToken: string;
  chatIds: readonly [primary: string, secondary: string];
  fetchImplementation?: OperatorAlertFetch;
  idempotencyKey: string;
  message: string;
}): Promise<void> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const destinationResults = await Promise.allSettled(
    input.chatIds.map((chatId) =>
      resolveOperatorLinqDestination({
        apiBaseUrl: input.apiBaseUrl,
        apiToken: input.apiToken,
        chatId,
        fetchImplementation,
      })
    ),
  );
  const primaryResult = destinationResults[0];
  const secondaryResult = destinationResults[1];
  const failures: unknown[] = [];
  const destinations: Array<{ idempotencyKey: string; recipient: string }> = [];
  if (primaryResult.status === "rejected") {
    failures.push(primaryResult.reason);
  } else if (primaryResult.value.sendable) {
    destinations.push({
      idempotencyKey: input.idempotencyKey,
      recipient: primaryResult.value.recipient,
    });
  } else {
    failures.push(new OperatorAlertLinqError("linq_health_suppressed"));
  }

  if (secondaryResult.status === "rejected") {
    failures.push(secondaryResult.reason);
  } else if (primaryResult.status === "fulfilled") {
    if (secondaryResult.value.recipient === primaryResult.value.recipient) {
      failures.push(new OperatorAlertLinqError("linq_duplicate_recipient"));
    } else if (!secondaryResult.value.sendable) {
      failures.push(new OperatorAlertLinqError("linq_health_suppressed"));
    } else {
      destinations.push({
        idempotencyKey: `${input.idempotencyKey}-recipient-2`,
        recipient: secondaryResult.value.recipient,
      });
    }
  }

  const sendResults = await Promise.allSettled(
    destinations.map((destination) =>
      sendOperatorLinqMessage({
        apiBaseUrl: input.apiBaseUrl,
        apiToken: input.apiToken,
        fetchImplementation,
        idempotencyKey: destination.idempotencyKey,
        message: input.message,
        recipient: destination.recipient,
      })
    ),
  );
  for (const result of sendResults) {
    if (result.status === "rejected") {
      failures.push(result.reason);
    }
  }
  const failure = failures[0];
  if (failure !== undefined) {
    throw failure;
  }
}

export function classifyOperatorLinqAlertFailure(error: unknown): string {
  return error instanceof OperatorAlertLinqError
    ? error.code
    : "linq_transport_failed";
}

async function resolveOperatorLinqDestination(input: {
  apiBaseUrl: string;
  apiToken: string;
  chatId: string;
  fetchImplementation: OperatorAlertFetch;
}): Promise<{ recipient: string; sendable: boolean }> {
  const client = createOperatorLinqClient(input);
  const [chatResult, phoneNumbersResult] = await Promise.allSettled([
    client.chats.retrieve(input.chatId),
    client.phoneNumbers.list(),
  ]);
  if (chatResult.status === "rejected") {
    throw new OperatorAlertLinqError("linq_health_unavailable");
  }
  const chatIdentity = resolveLinqDirectChatIdentity(chatResult.value);
  if (phoneNumbersResult.status === "rejected") {
    return {
      recipient: chatIdentity.recipient,
      sendable: false,
    };
  }
  return {
    recipient: chatIdentity.recipient,
    sendable:
      chatIdentity.chatHealthy
      && hasHealthyLinqSenderLine({
        phoneNumbers: phoneNumbersResult.value,
        sender: chatIdentity.sender,
      }),
  };
}

async function sendOperatorLinqMessage(input: {
  apiBaseUrl: string;
  apiToken: string;
  fetchImplementation: OperatorAlertFetch;
  idempotencyKey: string;
  message: string;
  recipient: string;
}): Promise<void> {
  const body: MessageCreateParams = {
    "Idempotency-Key": input.idempotencyKey,
    message: {
      idempotency_key: input.idempotencyKey,
      parts: [
        {
          type: "text",
          value: input.message,
        },
      ],
    },
    to: [input.recipient],
  };
  try {
    await createOperatorLinqClient(input, {
      discardResponseBody: true,
    }).messages.create(body).asResponse();
  } catch (error) {
    const status = readOperatorLinqErrorStatus(error);
    if (status !== null) {
      throw new OperatorAlertLinqError(
        status === 429 || status >= 500
          ? "linq_retryable_response"
          : "linq_rejected_response",
      );
    }
    throw error;
  }
}

function readOperatorLinqErrorStatus(error: unknown): number | null {
  let current: unknown = error;
  let depth = 0;
  while (current !== null && current !== undefined && depth < 8) {
    if (current instanceof APIError && typeof current.status === "number") {
      return current.status;
    }
    if (current instanceof OperatorAlertLinqResponseTooLargeError) {
      return current.status;
    }
    current = typeof current === "object"
        && current !== null
        && "cause" in current
      ? current.cause
      : undefined;
    depth += 1;
  }
  return null;
}

function createOperatorLinqClient(
  input: {
    apiBaseUrl: string;
    apiToken: string;
    fetchImplementation: OperatorAlertFetch;
  },
  options: { discardResponseBody?: boolean } = {},
): LinqAPIV3 {
  return new LinqAPIV3({
    apiKey: input.apiToken,
    baseURL: OPERATOR_ALERT_LINQ_SDK_BASE_URL,
    fetch: createOperatorLinqFetch(
      normalizeOperatorLinqApiRoot(input.apiBaseUrl),
      input.fetchImplementation,
      options,
    ),
    logLevel: "off",
    maxRetries: 0,
    timeout: OPERATOR_ALERT_FETCH_TIMEOUT_MS,
  });
}

function createOperatorLinqFetch(
  apiRoot: string,
  fetchImplementation: OperatorAlertFetch,
  options: { discardResponseBody?: boolean },
): (
  request: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> {
  return async (request, init) => {
    const target = mapOperatorLinqSdkUrl(request, apiRoot);
    const headers = new Headers(init?.headers);
    const providerHeaders = new Headers();
    for (const name of ["authorization", "content-type", "idempotency-key"]) {
      const value = headers.get(name);
      if (value !== null) {
        providerHeaders.set(name, value);
      }
    }
    const response = await fetchImplementation(target, {
      ...init,
      headers: providerHeaders,
      // Preserve the fail-closed redirect policy so the SDK bearer token is
      // never replayed to a provider-controlled redirect target.
      redirect: "manual",
    });
    if (options.discardResponseBody === true) {
      await response.body?.cancel().catch(() => undefined);
      return new Response(null, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    return await bufferOperatorLinqResponse(response);
  };
}

function mapOperatorLinqSdkUrl(
  request: string | URL | Request,
  apiRoot: string,
): URL {
  const source = new URL(
    typeof request === "string"
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url,
  );
  const sdkBase = new URL(OPERATOR_ALERT_LINQ_SDK_BASE_URL);
  if (
    source.origin !== sdkBase.origin
    || !/^\/v3(?:\/|$)/u.test(source.pathname)
  ) {
    throw new TypeError("Linq SDK emitted an unexpected operator-alert URL.");
  }

  const relativePath = encodeOperatorLinqSdkPath(
    source.pathname.replace(/^\/v3\/?/u, ""),
  );
  const target = new URL(
    relativePath,
    ensureTrailingSlash(apiRoot),
  );
  target.search = source.search;
  return target;
}

function encodeOperatorLinqSdkPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function normalizeOperatorLinqApiRoot(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (!normalized) {
    throw new TypeError("Operator alert Linq API base URL is required.");
  }
  const url = new URL(normalized);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

async function bufferOperatorLinqResponse(
  response: Response,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const declaredLength = Number(headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > LINQ_HEALTH_BODY_LIMIT_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new OperatorAlertLinqResponseTooLargeError(response.status);
  }
  const bytes = response.body
    ? await readBoundedOperatorLinqStream(response.body, response.status)
    : new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > LINQ_HEALTH_BODY_LIMIT_BYTES) {
    throw new OperatorAlertLinqResponseTooLargeError(response.status);
  }
  if (bytes.byteLength > 0) {
    headers.set("content-type", "application/json");
  }
  const body = bytes.byteLength === 0
      || response.status === 204
      || response.status === 205
      || response.status === 304
    ? null
    : copyOperatorLinqResponseBytes(bytes);
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function copyOperatorLinqResponseBytes(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

async function readBoundedOperatorLinqStream(
  stream: ReadableStream<Uint8Array>,
  status: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      total += next.value.byteLength;
      if (total > LINQ_HEALTH_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OperatorAlertLinqResponseTooLargeError(status);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function resolveLinqDirectChatIdentity(
  chatValue: Chat,
): {
  chatHealthy: boolean;
  recipient: string;
  sender: string;
} {
  if (
    !isObjectRecord(chatValue)
    || chatValue.is_group !== false
    || !Array.isArray(chatValue.handles)
  ) {
    throw new OperatorAlertLinqError("linq_health_suppressed");
  }

  const activeHandles: Record<string, unknown>[] = [];
  for (const candidate of chatValue.handles) {
    if (
      isObjectRecord(candidate)
      && (candidate.status === undefined || candidate.status === "active")
    ) {
      activeHandles.push(candidate);
    }
  }
  const senderHandles = activeHandles.filter(
    (candidate) => candidate.is_me === true,
  );
  const recipientHandles = activeHandles.filter(
    (candidate) => candidate.is_me === false,
  );
  if (senderHandles.length !== 1 || recipientHandles.length !== 1) {
    throw new OperatorAlertLinqError("linq_health_suppressed");
  }
  const sender = senderHandles[0]?.handle;
  const recipient = recipientHandles[0]?.handle;
  if (!isE164PhoneNumber(sender) || !isE164PhoneNumber(recipient)) {
    throw new OperatorAlertLinqError("linq_health_suppressed");
  }
  const chatHealthStatus = isObjectRecord(chatValue.health_status)
    ? normalizeLinqHealthStatus(chatValue.health_status.status)
    : null;
  return {
    chatHealthy: chatHealthStatus === "HEALTHY",
    recipient,
    sender,
  };
}

function hasHealthyLinqSenderLine(input: {
  phoneNumbers: PhoneNumberListResponse;
  sender: string;
}): boolean {
  const phoneNumbersValue = input.phoneNumbers;
  if (
    !isObjectRecord(phoneNumbersValue)
    || !Array.isArray(phoneNumbersValue.phone_numbers)
  ) {
    return false;
  }
  const currentLines: Record<string, unknown>[] = [];
  for (const candidate of phoneNumbersValue.phone_numbers) {
    if (
      isObjectRecord(candidate)
      && normalizeLinqPhoneNumber(candidate.phone_number) === input.sender
    ) {
      currentLines.push(candidate);
    }
  }
  const currentLine = currentLines[0];
  const reputation = isObjectRecord(currentLine?.reputation)
    ? currentLine.reputation
    : null;
  const reputationStatus =
    normalizeLinqHealthStatus(reputation?.status)
    ?? normalizeLinqHealthStatus(currentLine?.health_status);
  return !(
    currentLines.length !== 1
    || !isObjectRecord(currentLine)
    || reputationStatus !== "HEALTHY"
  );
}

class OperatorAlertLinqResponseTooLargeError extends Error {
  constructor(readonly status: number) {
    super("Linq operator-alert response exceeded the configured byte limit.");
    this.name = "OperatorAlertLinqResponseTooLargeError";
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isE164PhoneNumber(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/u.test(value);
}

function normalizeLinqPhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) return prefixed;
  return /^[1-9]\d{6,14}$/u.test(prefixed) ? `+${prefixed}` : null;
}

function normalizeLinqHealthStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
