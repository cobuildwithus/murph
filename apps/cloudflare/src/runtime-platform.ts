import {
  readHostedRunnerCommitTimeoutMs,
  type HostedRuntimePlatform,
} from "@murphai/assistant-runtime";
import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  buildHostedExecutionRunnerCommitPath,
  buildHostedExecutionRunnerEmailMessagePath,
  buildHostedExecutionRunnerSideEffectPath,
  parseHostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import { CLOUDFLARE_HOSTED_USAGE_RECORD_PATH } from "./outbound-routes.ts";

interface HostedExecutionAiUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}

export function buildHostedExecutionRuntimePlatform(input: {
  boundUserId: string;
  commitTimeoutMs?: number | null;
  fetchImpl?: typeof fetch;
  internalWorkerProxyToken?: string | null;
}): HostedRuntimePlatform {
  const fetchImpl = createCloudflareHostedRuntimeFetch(
    input.internalWorkerProxyToken ?? null,
    input.fetchImpl ?? fetch,
  );
  const timeoutMs = readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null);

  return {
    artifactStore: {
      async get(sha256) {
        const response = await fetchHostedResponse({
          description: `Hosted artifact fetch ${sha256}`,
          fetchImpl,
          timeoutMs,
          url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
        });

        if (response.status === 404) {
          return null;
        }

        assertHostedOk(response, `Hosted artifact fetch ${sha256}`);
        return new Uint8Array(await response.arrayBuffer());
      },
      async put({ bytes, sha256 }) {
        const response = await fetchHostedResponse({
          description: `Hosted artifact upload ${sha256}`,
          fetchImpl,
          init: {
            body: copyBytesToArrayBuffer(bytes),
            method: "PUT",
          },
          timeoutMs,
          url: new URL(`/objects/${sha256}`, `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.artifactStore}/`),
        });

        assertHostedOk(response, `Hosted artifact upload ${sha256}`);
      },
    },
    deviceSyncPort: {
      async applyUpdates(runtimeInput) {
        const payload = await fetchHostedJson({
          body: {
            ...(runtimeInput.occurredAt ? { occurredAt: runtimeInput.occurredAt } : {}),
            updates: runtimeInput.updates,
            userId: input.boundUserId,
          },
          description: "Hosted device-sync runtime apply",
          fetchImpl,
          method: "POST",
          timeoutMs,
          url: new URL(
            HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.deviceSyncPort}/`,
          ),
        });

        return parseHostedExecutionDeviceSyncRuntimeApplyResponse(payload);
      },
      async createConnectLink({ provider }) {
        const payload = await fetchHostedJson({
          description: `Hosted device-sync connect link ${provider}`,
          fetchImpl,
          method: "POST",
          timeoutMs,
          url: new URL(
            buildHostedExecutionDeviceSyncConnectLinkPath(provider),
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.deviceSyncPort}/`,
          ),
        });

        return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
      },
      async fetchSnapshot(runtimeInput = {}) {
        const payload = await fetchHostedJson({
          body: {
            ...(runtimeInput.connectionId ? { connectionId: runtimeInput.connectionId } : {}),
            ...(runtimeInput.provider ? { provider: runtimeInput.provider } : {}),
            userId: input.boundUserId,
          },
          description: "Hosted device-sync runtime snapshot",
          fetchImpl,
          method: "POST",
          timeoutMs,
          url: new URL(
            HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.deviceSyncPort}/`,
          ),
        });

        return parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(payload);
      },
    },
    effectsPort: {
      async commit({ eventId, payload }) {
        const response = await fetchHostedResponse({
          description: `Hosted commit ${eventId}`,
          fetchImpl,
          init: {
            body: JSON.stringify(payload),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          },
          timeoutMs,
          url: new URL(
            buildHostedExecutionRunnerCommitPath(eventId),
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
          ),
        });

        assertHostedOk(response, `Hosted commit ${eventId}`);
      },
      async deletePreparedSideEffect(sideEffect) {
        const url = createHostedSideEffectUrl(sideEffect);
        const response = await fetchHostedResponse({
          description: `Hosted side-effect delete ${sideEffect.effectId}`,
          fetchImpl,
          init: {
            method: "DELETE",
          },
          timeoutMs,
          url,
        });

        assertHostedOk(response, `Hosted side-effect delete ${sideEffect.effectId}`);
      },
      async readRawEmailMessage(rawMessageKey) {
        const response = await fetchHostedResponse({
          description: `Hosted raw email read ${rawMessageKey}`,
          fetchImpl,
          timeoutMs,
          url: new URL(
            buildHostedExecutionRunnerEmailMessagePath(rawMessageKey),
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
          ),
        });

        if (response.status === 404) {
          return null;
        }

        assertHostedOk(response, `Hosted raw email read ${rawMessageKey}`);
        return new Uint8Array(await response.arrayBuffer());
      },
      async readSideEffect(sideEffect) {
        const payload = await fetchHostedJson({
          allowNotFound: false,
          description: `Hosted side-effect read ${sideEffect.effectId}`,
          fetchImpl,
          method: "GET",
          timeoutMs,
          url: createHostedSideEffectUrl(sideEffect),
        });

        const record = readHostedRecordField(payload, "record");
        return record === null ? null : parseHostedExecutionSideEffectRecord(record);
      },
      async sendEmail(request) {
        const payload = await fetchHostedJson({
          body: request,
          description: "Hosted email send",
          fetchImpl,
          method: "POST",
          timeoutMs,
          url: new URL(
            HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
          ),
        });
        const target = readOptionalStringField(payload, "target");

        return target ? { target } : undefined;
      },
      async writeSideEffect(record) {
        const payload = await fetchHostedJson({
          body: record,
          description: `Hosted side-effect write ${record.effectId}`,
          fetchImpl,
          method: "PUT",
          timeoutMs,
          url: createHostedSideEffectUrl(record),
        });

        return parseHostedExecutionSideEffectRecord(
          requireRecordField(payload, "record"),
        );
      },
    },
    usageExportPort: {
      async recordUsage(usage) {
        const payload = await fetchHostedJson({
          body: {
            usage,
          },
          description: "Hosted usage export",
          fetchImpl,
          method: "POST",
          timeoutMs,
          url: new URL(
            CLOUDFLARE_HOSTED_USAGE_RECORD_PATH,
            `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.usageExportPort}/`,
          ),
        });

        return parseHostedExecutionAiUsageRecordResponse(payload);
      },
    },
  };
}

function createCloudflareHostedRuntimeFetch(
  internalWorkerProxyToken: string | null,
  fetchImpl: typeof fetch,
): typeof fetch {
  if (!internalWorkerProxyToken) {
    return fetchImpl;
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
      return fetchImpl(request);
    }

    const headers = new Headers(request.headers);
    headers.set(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER, internalWorkerProxyToken);
    return fetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
}

function createHostedSideEffectUrl(input: {
  effectId: string;
  fingerprint: string;
  kind: string;
}): URL {
  const url = new URL(
    buildHostedExecutionRunnerSideEffectPath(input.effectId),
    `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
  );
  url.searchParams.set("fingerprint", input.fingerprint);
  url.searchParams.set("kind", input.kind);
  return url;
}

async function fetchHostedJson(input: {
  allowNotFound?: boolean;
  body?: unknown;
  description: string;
  fetchImpl: typeof fetch;
  method: "DELETE" | "GET" | "POST" | "PUT";
  timeoutMs: number;
  url: URL;
}): Promise<unknown> {
  const response = await fetchHostedResponse({
    description: input.description,
    fetchImpl: input.fetchImpl,
    init: {
      ...(input.body === undefined
        ? {}
        : {
            body: JSON.stringify(input.body),
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }),
      method: input.method,
    },
    timeoutMs: input.timeoutMs,
    url: input.url,
  });

  if (input.allowNotFound && response.status === 404) {
    return null;
  }

  assertHostedOk(response, input.description);

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

async function fetchHostedResponse(input: {
  description: string;
  fetchImpl: typeof fetch;
  init?: RequestInit;
  timeoutMs: number;
  url: URL;
}): Promise<Response> {
  try {
    return await input.fetchImpl(input.url, {
      ...input.init,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    throw new Error(`${input.description} request failed.`, { cause: error });
  }
}

function assertHostedOk(response: Response, description: string): void {
  if (response.ok) {
    return;
  }

  throw new Error(`${description} failed with HTTP ${response.status}.`);
}

function parseHostedExecutionAiUsageRecordResponse(
  value: unknown,
): HostedExecutionAiUsageRecordResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted AI usage export response must be an object.");
  }

  const recorded = (value as { recorded?: unknown }).recorded;
  const usageIds = (value as { usageIds?: unknown }).usageIds;

  if (typeof recorded !== "number" || !Number.isFinite(recorded)) {
    throw new TypeError("Hosted AI usage export response.recorded must be a finite number.");
  }

  if (!Array.isArray(usageIds) || usageIds.some((entry) => typeof entry !== "string")) {
    throw new TypeError("Hosted AI usage export response.usageIds must be a string array.");
  }

  return {
    recorded,
    usageIds,
  };
}

function readHostedRecordField(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === null || entry === undefined) {
    return null;
  }

  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`Hosted runtime response.${field} must be an object or null.`);
  }

  return entry as Record<string, unknown>;
}

function requireRecordField(value: unknown, field: string): Record<string, unknown> {
  const record = readHostedRecordField(value, field);

  if (!record) {
    throw new TypeError(`Hosted runtime response.${field} must be present.`);
  }

  return record;
}

function readOptionalStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === undefined || entry === null) {
    return null;
  }

  if (typeof entry !== "string") {
    throw new TypeError(`Hosted runtime response.${field} must be a string.`);
  }

  return entry;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
