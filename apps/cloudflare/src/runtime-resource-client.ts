import { HOSTED_RUNTIME_RESOURCES_PATH, parseHostedRuntimeSnapshotResponse, type HostedRuntimeSnapshotCommand } from "@murphai/hosted-execution/runtime-resources";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import { readHostedWebControlPlaneResponseText } from "./runtime-platform/web-control-transport.ts";

export class HostedRuntimeResourceRejectedError extends Error {
  readonly status = 409;
  constructor(readonly code: "HOSTED_RUNTIME_OWNER_STALE" | "HOSTED_RUNTIME_RESOURCE_RETIRED") {
    super(`Hosted runtime resource rejected: ${code}.`);
  }
}

export async function commandHostedRuntimeSnapshot(input: {
  source: Readonly<Record<string, unknown>>; userId: string; command: HostedRuntimeSnapshotCommand;
}) {
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
    callbackSigning: env.webCallbackSigning, boundUserId: input.userId,
    method: "POST", path: HOSTED_RUNTIME_RESOURCES_PATH, body: JSON.stringify(input.command), timeoutMs: env.webControlTimeoutMs,
  });
  if (!response.ok) await throwRuntimeResourceRejection(response, env.webControlTimeoutMs, "snapshot");
  const result = parseHostedRuntimeSnapshotResponse(JSON.parse(await readHostedWebControlPlaneResponseText({
    response, description: "Hosted runtime snapshot", maxBytes: 64 * 1024, signal: null, timeoutMs: env.webControlTimeoutMs,
  })));
  if (result.session && result.session.userId !== input.userId) throw new Error("Hosted runtime snapshot member mismatch.");
  if (result.managedUpload && result.managedUpload.userId !== input.userId) throw new Error("Hosted runtime upload member mismatch.");
  return result;
}

export async function commandHostedRuntimeMedia(input: {
  source: Readonly<Record<string, unknown>>; userId: string;
  command: import("@murphai/hosted-execution/runtime-media").HostedRuntimeMediaCommand;
}) {
  const { HOSTED_RUNTIME_MEDIA_PATH, parseHostedRuntimeMediaResponse } = await import("@murphai/hosted-execution/runtime-media");
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
    callbackSigning: env.webCallbackSigning, boundUserId: input.userId,
    method: "POST", path: HOSTED_RUNTIME_MEDIA_PATH, body: JSON.stringify(input.command), timeoutMs: env.webControlTimeoutMs,
  });
  if (!response.ok) throw new Error(`Hosted runtime media command returned HTTP ${response.status}.`);
  const result = parseHostedRuntimeMediaResponse(JSON.parse(await readHostedWebControlPlaneResponseText({
    response, description: "Hosted runtime media", maxBytes: 16 * 1024, signal: null, timeoutMs: env.webControlTimeoutMs,
  })));
  if (result.cutover !== "postgres") throw new Error("Hosted runtime media ownership is not active.");
  return result;
}

export async function recordHostedRuntimeOrphan(input: {
  source: Readonly<Record<string, unknown>>; userId: string;
  resource: import("@murphai/hosted-execution/runtime-resource-purge").HostedRuntimeResourcePurge;
}): Promise<void> {
  const { HOSTED_RUNTIME_ORPHAN_RECORD_PATH } = await import("@murphai/hosted-execution/runtime-resource-purge");
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
    callbackSigning: env.webCallbackSigning, boundUserId: input.userId,
    method: "POST", path: HOSTED_RUNTIME_ORPHAN_RECORD_PATH, body: JSON.stringify(input.resource), timeoutMs: env.webControlTimeoutMs,
  });
  if (!response.ok) throw new Error(`Hosted runtime orphan recording returned HTTP ${response.status}.`);
  const result = JSON.parse(await readHostedWebControlPlaneResponseText({ response, description: "Hosted runtime orphan", maxBytes: 1024, signal: null, timeoutMs: env.webControlTimeoutMs }));
  if (result?.recorded !== true) throw new TypeError("Hosted runtime orphan recording was not acknowledged.");
}

export async function commandHostedRuntimeReplicaPut(input: {
  source: Readonly<Record<string, unknown>>; userId: string;
  command: import("@murphai/hosted-execution/runtime-resources").HostedRuntimeReplicaPutCommand;
}): Promise<boolean> {
  const { HOSTED_RUNTIME_REPLICA_PUT_PATH } = await import("@murphai/hosted-execution/runtime-resources");
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: env.hostedWebBaseUrl, allowHttpHosts: env.hostedWebAllowHttpHosts,
    callbackSigning: env.webCallbackSigning, boundUserId: input.userId,
    method: "POST", path: HOSTED_RUNTIME_REPLICA_PUT_PATH, body: JSON.stringify(input.command), timeoutMs: env.webControlTimeoutMs,
  });
  if (!response.ok) await throwRuntimeResourceRejection(response, env.webControlTimeoutMs, "replica PUT");
  const result = JSON.parse(await readHostedWebControlPlaneResponseText({ response, description: "Hosted runtime replica PUT", maxBytes: 1024, signal: null, timeoutMs: env.webControlTimeoutMs }));
  if (typeof result?.applied !== "boolean") throw new TypeError("Hosted runtime replica PUT result is invalid.");
  return result.applied;
}

async function throwRuntimeResourceRejection(
  response: Response,
  timeoutMs: number,
  operation: "snapshot" | "replica PUT",
): Promise<never> {
  let code: unknown;
  if (response.status === 409) {
    try {
      const body = JSON.parse(await readHostedWebControlPlaneResponseText({
        response, description: "Hosted runtime resource rejection", maxBytes: 1024,
        signal: null, timeoutMs,
      }));
      code = body?.error?.code;
    } catch { /* Unknown responses remain failures, without copying their body. */ }
  } else {
    // The caller will not consume a failed response. Release its transport.
    void response.body?.cancel().catch(() => undefined);
  }
  if (code === "HOSTED_RUNTIME_OWNER_STALE" || code === "HOSTED_RUNTIME_RESOURCE_RETIRED") {
    throw new HostedRuntimeResourceRejectedError(code);
  }
  throw new Error(`Hosted runtime ${operation} command returned HTTP ${response.status}.`);
}
