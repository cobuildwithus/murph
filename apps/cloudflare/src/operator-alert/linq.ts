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
  const authorization = `Bearer ${input.apiToken}`;
  const chatUrl = new URL(
    `chats/${encodeURIComponent(input.chatId)}`,
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const phoneNumbersUrl = new URL(
    "phone_numbers",
    ensureTrailingSlash(input.apiBaseUrl),
  );
  const [chatResponseResult, phoneNumbersResponseResult] =
    await Promise.allSettled([
      fetchWithTimeout(input.fetchImplementation, chatUrl, {
        headers: { authorization },
        method: "GET",
      }),
      fetchWithTimeout(input.fetchImplementation, phoneNumbersUrl, {
        headers: { authorization },
        method: "GET",
      }),
    ]);
  if (
    chatResponseResult.status === "rejected"
    || !chatResponseResult.value.ok
  ) {
    throw new OperatorAlertLinqError("linq_health_unavailable");
  }
  const chatBody = await readBoundedResponseText(
    chatResponseResult.value,
    LINQ_HEALTH_BODY_LIMIT_BYTES,
  ).catch(() => {
    throw new OperatorAlertLinqError("linq_health_unavailable");
  });
  const chatIdentity = resolveLinqDirectChatIdentity(chatBody);
  if (
    phoneNumbersResponseResult.status === "rejected"
    || !phoneNumbersResponseResult.value.ok
  ) {
    return { recipient: chatIdentity.recipient, sendable: false };
  }
  const phoneNumbersBody = await readBoundedResponseText(
    phoneNumbersResponseResult.value,
    LINQ_HEALTH_BODY_LIMIT_BYTES,
  ).catch(() => null);
  return {
    recipient: chatIdentity.recipient,
    sendable:
      chatIdentity.chatHealthy
      && phoneNumbersBody !== null
      && hasHealthyLinqSenderLine({
        phoneNumbersBody,
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
  const response = await fetchWithTimeout(
    input.fetchImplementation,
    new URL("messages", ensureTrailingSlash(input.apiBaseUrl)),
    {
      body: JSON.stringify({
        message: {
          idempotency_key: input.idempotencyKey,
          parts: [{ type: "text", value: input.message }],
        },
        to: [input.recipient],
      }),
      headers: {
        authorization: `Bearer ${input.apiToken}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new OperatorAlertLinqError(
      response.status === 429 || response.status >= 500
        ? "linq_retryable_response"
        : "linq_rejected_response",
    );
  }
}

function resolveLinqDirectChatIdentity(chatBody: string): {
  chatHealthy: boolean;
  recipient: string;
  sender: string;
} {
  let chatValue: unknown;
  try {
    chatValue = JSON.parse(chatBody);
  } catch {
    throw new OperatorAlertLinqError("linq_health_unavailable");
  }
  if (
    !isObjectRecord(chatValue)
    || chatValue.is_group !== false
    || !Array.isArray(chatValue.handles)
  ) {
    throw new OperatorAlertLinqError("linq_health_suppressed");
  }
  const activeHandles = chatValue.handles.filter(
    (candidate): candidate is Record<string, unknown> =>
      isObjectRecord(candidate)
      && (candidate.status === undefined || candidate.status === "active"),
  );
  const senderHandles = activeHandles.filter((candidate) => candidate.is_me === true);
  const recipientHandles = activeHandles.filter((candidate) => candidate.is_me === false);
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
  phoneNumbersBody: string;
  sender: string;
}): boolean {
  let phoneNumbersValue: unknown;
  try {
    phoneNumbersValue = JSON.parse(input.phoneNumbersBody);
  } catch {
    return false;
  }
  if (
    !isObjectRecord(phoneNumbersValue)
    || !Array.isArray(phoneNumbersValue.phone_numbers)
  ) {
    return false;
  }
  const currentLines = phoneNumbersValue.phone_numbers.filter(
    (candidate) =>
      isObjectRecord(candidate)
      && normalizeLinqPhoneNumber(candidate.phone_number) === input.sender,
  );
  const currentLine = currentLines[0];
  const reputation = isObjectRecord(currentLine?.reputation)
    ? currentLine.reputation
    : null;
  const reputationStatus = normalizeLinqHealthStatus(reputation?.status)
    ?? normalizeLinqHealthStatus(currentLine?.health_status);
  return currentLines.length === 1
    && isObjectRecord(currentLine)
    && reputationStatus === "HEALTHY";
}

async function fetchWithTimeout(
  fetchImplementation: OperatorAlertFetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  return await fetchImplementation(input, {
    ...init,
    // Workers fetch rejects redirect: "error" before network I/O. Manual
    // redirects remain fail-closed because every caller requires response.ok.
    redirect: "manual",
    signal: AbortSignal.timeout(OPERATOR_ALERT_FETCH_TIMEOUT_MS),
  });
}

async function readBoundedResponseText(
  response: Response,
  limitBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new Error("Response exceeded the operator alert body limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > limitBytes) {
      await reader.cancel();
      throw new Error("Response exceeded the operator alert body limit.");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
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
