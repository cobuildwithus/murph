import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { json, methodNotAllowed, notFound, readJsonObject } from "../json.ts";
import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  readRunnerActiveInvocationLeaseHeaders,
} from "./active-lease.ts";

export const HOSTED_RUNTIME_ACTIVE_INVOCATION_HEARTBEAT_PATH =
  "/internal/active-invocation/heartbeat";

interface HeartbeatLeaseProof {
  attemptId: string;
  leaseGeneration: string;
}

interface RunnerHeartbeatProxyContext {
  proxyAttemptId?: string | null;
  proxyLeaseGeneration?: string | null;
}

export async function handleRunnerHeartbeatRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  proxyContext?: RunnerHeartbeatProxyContext;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.url.pathname !== HOSTED_RUNTIME_ACTIVE_INVOCATION_HEARTBEAT_PATH) {
    return notFound();
  }

  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  const payloadLease = await readHeartbeatBodyLease(input.request);
  const headerLease = readHeartbeatHeaderLease(input.request);
  const proxyLease = readHeartbeatProxyLease(input.proxyContext ?? {});
  const mismatchReason =
    readHeartbeatLeaseMismatch(payloadLease, headerLease)
    ?? readHeartbeatLeaseMismatch(payloadLease, proxyLease)
    ?? readHeartbeatLeaseMismatch(headerLease, proxyLease);
  if (mismatchReason) {
    return json({
      ok: false,
      reason: mismatchReason,
    });
  }

  const lease = payloadLease ?? headerLease ?? proxyLease;
  if (!lease) {
    emitHostedExecutionStructuredLog({
      component: "runner-outbound",
      details: {
        contentLengthPresent: input.request.headers.has("content-length") ? "true" : "false",
        contentTypePresent: input.request.headers.has("content-type") ? "true" : "false",
        hasBody: input.request.body ? "true" : "false",
        path: input.url.pathname,
        proxyLeasePresent: proxyLease ? "true" : "false",
        reason: "malformed_request",
      },
      level: "warn",
      message: "Hosted runner heartbeat rejected a malformed payload.",
      phase: "failed",
      userId: input.userId,
    });
    return json({
      ok: false,
      reason: "malformed_request",
    });
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const recordActiveInvocationHeartbeat = requireRunnerOutboundUserStubMethod(
    stub,
    "recordActiveInvocationHeartbeat",
  );
  return json(await recordActiveInvocationHeartbeat({
    attemptId: lease.attemptId,
    leaseGeneration: lease.leaseGeneration,
    userId: input.userId,
  }));
}

async function readHeartbeatBodyLease(request: Request): Promise<HeartbeatLeaseProof | null> {
  if (!request.body) {
    return null;
  }

  try {
    const body = await readJsonObject(request);
    const attemptId = readRequiredString(body, "attemptId");
    const leaseGeneration = readRequiredString(body, "leaseGeneration");
    return {
      attemptId,
      leaseGeneration,
    };
  } catch {
    return null;
  }
}

function readHeartbeatHeaderLease(request: Request): HeartbeatLeaseProof | null {
  const headers = readRunnerActiveInvocationLeaseHeaders(request);
  if (!headers) {
    return null;
  }

  return {
    attemptId: headers.attemptId,
    leaseGeneration: headers.leaseGeneration,
  };
}

function readHeartbeatProxyLease(
  context: RunnerHeartbeatProxyContext,
): HeartbeatLeaseProof | null {
  if (!context.proxyAttemptId || !context.proxyLeaseGeneration) {
    return null;
  }

  return {
    attemptId: context.proxyAttemptId,
    leaseGeneration: context.proxyLeaseGeneration,
  };
}

function readHeartbeatLeaseMismatch(
  left: HeartbeatLeaseProof | null,
  right: HeartbeatLeaseProof | null,
): "stale_attempt" | "stale_generation" | null {
  if (!left || !right) {
    return null;
  }

  if (left.attemptId !== right.attemptId) {
    return "stale_attempt";
  }

  if (left.leaseGeneration !== right.leaseGeneration) {
    return "stale_generation";
  }

  return null;
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Heartbeat request.${field} must be a non-empty string.`);
  }

  return value;
}
