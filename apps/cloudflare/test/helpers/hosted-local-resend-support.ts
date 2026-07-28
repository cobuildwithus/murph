import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  buildHostLoopbackStubBaseUrl,
  readRequestBody,
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";

export interface ObservedResendRequest {
  body: string;
  idempotencyKey: string | null;
  method: string;
  url: string;
}

export type ObservedResendRequestMatcher = (
  request: ObservedResendRequest,
) => boolean;

export interface HostedLocalResendStub {
  acceptedRequests: ObservedResendRequest[];
  armNextPostAcceptLostAcknowledgment(input: {
    matchRequest: ObservedResendRequestMatcher;
  }): void;
  baseUrl: string;
  observedRequests: ObservedResendRequest[];
  stop(): Promise<void>;
}

interface AcceptedResendEmail {
  body: string;
  providerMessageId: string;
}

export async function startHostedLocalResendStub(): Promise<HostedLocalResendStub> {
  const observedRequests: ObservedResendRequest[] = [];
  const acceptedRequests: ObservedResendRequest[] = [];
  const acceptedByIdempotencyKey = new Map<string, AcceptedResendEmail>();
  let lostAcknowledgmentMatcher: ObservedResendRequestMatcher | null = null;

  const server = createServer((request, response) => {
    void handleHostedLocalResendRequest({
      acceptedByIdempotencyKey,
      acceptedRequests,
      loseAcknowledgment: (observed) => {
        if (!lostAcknowledgmentMatcher?.(observed)) {
          return false;
        }
        lostAcknowledgmentMatcher = null;
        return true;
      },
      observedRequests,
      request,
      response,
    }).catch(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      writeJsonResponse(response, 500, { error: "resend_stub_failed" });
    });
  });
  await listenOnEphemeralPort(server);

  return {
    acceptedRequests,
    armNextPostAcceptLostAcknowledgment(input) {
      if (lostAcknowledgmentMatcher) {
        throw new Error(
          "Hosted local Resend lost acknowledgment is already armed.",
        );
      }
      lostAcknowledgmentMatcher = input.matchRequest;
    },
    baseUrl: buildHostLoopbackStubBaseUrl(server, "Hosted local Resend stub"),
    observedRequests,
    stop: async () => {
      await stopHttpStubServer(server);
    },
  };
}

async function handleHostedLocalResendRequest(input: {
  acceptedByIdempotencyKey: Map<string, AcceptedResendEmail>;
  acceptedRequests: ObservedResendRequest[];
  loseAcknowledgment: (request: ObservedResendRequest) => boolean;
  observedRequests: ObservedResendRequest[];
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const body = await readRequestBody(input.request);
  const idempotencyKey = readHeaderValue(
    input.request.headers["idempotency-key"],
  );
  const observed: ObservedResendRequest = {
    body,
    idempotencyKey,
    method: input.request.method ?? "GET",
    url: input.request.url ?? "/",
  };
  input.observedRequests.push(observed);

  if (observed.method !== "POST" || observed.url !== "/emails") {
    writeJsonResponse(input.response, 404, { error: "not_found" });
    return;
  }
  const authorization = readHeaderValue(input.request.headers.authorization);
  if (
    !authorization?.startsWith("Bearer ")
    || authorization.length === "Bearer ".length
  ) {
    writeJsonResponse(input.response, 401, { error: "unauthorized" });
    return;
  }
  if (!idempotencyKey || !isValidResendEmailBody(body)) {
    writeJsonResponse(input.response, 400, { error: "invalid_request" });
    return;
  }

  const existing = input.acceptedByIdempotencyKey.get(idempotencyKey);
  if (existing) {
    if (existing.body !== body) {
      writeJsonResponse(input.response, 409, {
        error: "idempotency_conflict",
      });
      return;
    }
    writeJsonResponse(input.response, 200, { id: existing.providerMessageId });
    return;
  }

  const providerMessageId = `resend_local_${createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 20)}`;
  input.acceptedByIdempotencyKey.set(idempotencyKey, {
    body,
    providerMessageId,
  });
  input.acceptedRequests.push(observed);

  if (input.loseAcknowledgment(observed)) {
    writeJsonResponse(input.response, 503, { error: "accepted_ack_lost" });
    return;
  }
  writeJsonResponse(input.response, 200, { id: providerMessageId });
}

function isValidResendEmailBody(body: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.from === "string"
    && typeof record.subject === "string"
    && typeof record.text === "string"
    && Array.isArray(record.to)
    && record.to.length > 0
    && record.to.every((recipient) => typeof recipient === "string");
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

async function listenOnEphemeralPort(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(0, "0.0.0");
  });
}
