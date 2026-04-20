import {
  parseHostedCipherEnvelope,
  parseHostedUserRecipientPublicKeyJwk,
  parseHostedBrowserSessionKeyEnvelope,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
  type HostedUserRecipientPublicKeyJwk,
} from "@murphai/runtime-state";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  parseHostedBrowserVaultReplicaRef,
  parseHostedRunNudgeResult,
  type HostedBrowserVaultReplicaRef,
  type HostedRunNudgeResult,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import { normalizeHostedExecutionBaseUrl } from "@murphai/hosted-execution/env";
import {
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";

import {
  buildCloudflareHostedControlBrowserVaultSessionPath,
  buildCloudflareHostedControlUserStatusPath,
  buildCloudflareHostedControlUserRunPath,
} from "./routes.ts";

export interface CloudflareHostedControlBrowserVaultSession {
  encryptedReplica: HostedCipherEnvelope;
  replicaAad: CloudflareHostedControlBrowserVaultReplicaAad;
  replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
  replicaRef: HostedBrowserVaultReplicaRef;
  state: "ready";
}

export interface CloudflareHostedControlBrowserVaultReplicaAad {
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  schema: "murph.browser-vault-replica.v1";
  sourceBundleHash: string;
  userId: string;
}

export interface CloudflareHostedControlClient {
  createBrowserVaultSession(input: {
    browserPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
    replicaRef: HostedBrowserVaultReplicaRef;
    userId: string;
  }): Promise<CloudflareHostedControlBrowserVaultSession>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  nudgeUserRun(userId: string): Promise<HostedRunNudgeResult>;
}

export interface CloudflareHostedControlClientOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

const BROWSER_VAULT_REPLICA_NOT_FOUND_ERROR_MESSAGE = "Hosted execution browser vault replica was not found.";

export function createCloudflareHostedControlClient(
  options: CloudflareHostedControlClientOptions,
): CloudflareHostedControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    createBrowserVaultSession(input) {
      const body = JSON.stringify({
        browserPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(input.browserPublicKeyJwk),
        replicaRef: input.replicaRef,
      });
      const userId = input.userId;

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "browser vault session",
        parse: parseCloudflareHostedControlBrowserVaultSession,
        path: buildCloudflareHostedControlBrowserVaultSessionPath(userId),
        request: {
          body,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      }).catch((error) => {
        if (isHostedExecutionHttpError(error, 404)) {
          throw new Error(BROWSER_VAULT_REPLICA_NOT_FOUND_ERROR_MESSAGE);
        }

        throw error;
      });
    },
    getStatus(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "status",
        parse: parseHostedExecutionUserStatus,
        path: buildCloudflareHostedControlUserStatusPath(userId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    nudgeUserRun(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "run",
        parse: parseHostedRunNudgeResult,
        path: buildCloudflareHostedControlUserRunPath(userId),
        request: {
          body: "{}",
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
  };
}

function isHostedExecutionHttpError(error: unknown, status: number): error is Error {
  return error instanceof Error &&
    error.message === `Hosted execution browser vault session failed with HTTP ${status}.`;
}

function parseCloudflareHostedControlBrowserVaultSession(
  value: unknown,
): CloudflareHostedControlBrowserVaultSession {
  const record = requireRecord(value, "Cloudflare browser vault session");
  const state = requireString(record.state, "Cloudflare browser vault session state");

  if (state !== "ready") {
    throw new TypeError("Cloudflare browser vault session state must be ready.");
  }

  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Cloudflare browser vault session replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Cloudflare browser vault session replicaRef must not be null.");
  }

  return {
    encryptedReplica: parseHostedCipherEnvelope(
      record.encryptedReplica,
      "Cloudflare browser vault session encryptedReplica",
    ),
    replicaAad: parseCloudflareHostedControlBrowserVaultReplicaAad(
      record.replicaAad,
      "Cloudflare browser vault session replicaAad",
    ),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Cloudflare browser vault session replicaKeyEnvelope",
    ),
    replicaRef,
    state,
  };
}

function parseCloudflareHostedControlBrowserVaultReplicaAad(
  value: unknown,
  label: string,
): CloudflareHostedControlBrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireString(record.purpose, `${label}.purpose`);
  const schema = requireString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica.v1") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.v1.`);
  }

  return {
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    objectKey: requireString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function requireHostedExecutionBaseUrl(
  value: string,
  options: Pick<CloudflareHostedControlClientOptions, "allowHttpHosts" | "allowHttpLocalhost">,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, options);

  if (!normalized) {
    throw new TypeError("Hosted execution baseUrl must be configured.");
  }

  return normalized;
}

function createHostedExecutionBearerAuthorizationHeaderProvider(
  getBearerToken: (() => Promise<string>) | undefined,
): () => Promise<string> {
  if (!getBearerToken) {
    throw new TypeError("Hosted execution getBearerToken must be configured.");
  }

  return async () => {
    const rawToken = (await getBearerToken()).trim();
    const token = rawToken.startsWith("Bearer ")
      ? rawToken.slice("Bearer ".length).trim()
      : rawToken;

    if (!token) {
      throw new TypeError("Hosted execution bearer token must be configured.");
    }

    return `Bearer ${token}`;
  };
}

async function requestHostedExecutionAuthorizedJson<TResponse>(input: {
  baseUrl: string;
  boundUserId?: string;
  fetchImpl: typeof fetch;
  getAuthorizationHeader: () => Promise<string>;
  label: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: string;
    headers?: HeadersInit;
    method: "GET" | "POST";
    search?: string | null;
  };
  timeoutMs: number | undefined;
}): Promise<TResponse> {
  const url = new URL(input.path.replace(/^\/+/, ""), `${input.baseUrl}/`);

  if (input.request.search) {
    url.search = input.request.search;
  }

  const headers = new Headers(input.request.headers);
  headers.set("authorization", await input.getAuthorizationHeader());

  if (input.boundUserId) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);
  }

  const response = await input.fetchImpl(url.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers,
    method: input.request.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Hosted execution ${input.label} failed with HTTP ${response.status}.`);
  }

  return input.parse(await response.json());
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
