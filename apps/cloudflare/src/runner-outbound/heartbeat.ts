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

export async function handleRunnerHeartbeatRequest(input: {
  env: RunnerOutboundEnvironmentSource;
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

  const payload = await readHeartbeatPayload(input.request);
  if (!payload.ok) {
    return json(payload);
  }

  const headers = readRunnerActiveInvocationLeaseHeaders(input.request);
  if (headers) {
    if (headers.attemptId !== payload.attemptId) {
      return json({
        ok: false,
        reason: "stale_attempt",
      });
    }
    if (headers.leaseGeneration !== payload.leaseGeneration) {
      return json({
        ok: false,
        reason: "stale_generation",
      });
    }
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const recordActiveInvocationHeartbeat = requireRunnerOutboundUserStubMethod(
    stub,
    "recordActiveInvocationHeartbeat",
  );
  return json(await recordActiveInvocationHeartbeat({
    attemptId: payload.attemptId,
    leaseGeneration: payload.leaseGeneration,
    userId: input.userId,
  }));
}

async function readHeartbeatPayload(request: Request): Promise<
  | {
    attemptId: string;
    leaseGeneration: string;
    ok: true;
  }
  | {
    ok: false;
    reason: "malformed_request";
  }
> {
  try {
    const body = await readJsonObject(request);
    const attemptId = readRequiredString(body, "attemptId");
    const leaseGeneration = readRequiredString(body, "leaseGeneration");
    readRequiredString(body, "requestId");
    return {
      attemptId,
      leaseGeneration,
      ok: true,
    };
  } catch {
    return {
      ok: false,
      reason: "malformed_request",
    };
  }
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
