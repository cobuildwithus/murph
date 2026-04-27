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
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunnerNudgeResult,
  parseHostedRunnerStatusResponse,
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import { normalizeHostedExecutionBaseUrl } from "@murphai/hosted-execution/env";

import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
  buildCloudflareHostedControlBrowserVaultSessionPath,
  buildCloudflareHostedControlUserRunnerNudgePath,
  buildCloudflareHostedControlUserStatusPath,
} from "./routes.ts";
import { requireCloudflareHostedControlUserId } from "./user-id.ts";

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
  getRunnerStatus(userId: string): Promise<HostedRunnerStatusResponse>;
  nudgeUserRunner(userId: string): Promise<HostedRunnerNudgeResult>;
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
      const userId = requireCloudflareHostedControlUserId(input.userId);
      const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(input.browserPublicKeyJwk);
      const replicaRef = parseHostedBrowserVaultReplicaRef(
        input.replicaRef,
        "Cloudflare browser vault session request replicaRef",
      );

      if (!replicaRef) {
        throw new TypeError("Cloudflare browser vault session request replicaRef must not be null.");
      }

      const body = JSON.stringify({
        browserPublicKeyJwk,
        replicaRef,
      });

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "browser vault session",
        parse: (value) =>
          parseCloudflareHostedControlBrowserVaultSession(value, {
            replicaRef,
            userId,
          }),
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
        if (
          isHostedExecutionHttpError(
            error,
            404,
            CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
          )
        ) {
          throw new Error(BROWSER_VAULT_REPLICA_NOT_FOUND_ERROR_MESSAGE);
        }

        throw error;
      });
    },
    getRunnerStatus(userId) {
      const expectedUserId = requireCloudflareHostedControlUserId(userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runner status",
        parse: (value) => parseHostedRunnerStatusForExpectedUser(value, expectedUserId),
        path: buildCloudflareHostedControlUserStatusPath(expectedUserId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    nudgeUserRunner(userId) {
      const expectedUserId = requireCloudflareHostedControlUserId(userId);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: expectedUserId,
        fetchImpl,
        getAuthorizationHeader,
        label: "runner nudge",
        parse: parseHostedRunnerNudgeResult,
        path: buildCloudflareHostedControlUserRunnerNudgePath(expectedUserId),
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

class HostedExecutionHttpResponseError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(input: {
    code: string | undefined;
    label: string;
    status: number;
  }) {
    super(`Hosted execution ${input.label} failed with HTTP ${input.status}.`);
    this.name = "HostedExecutionHttpResponseError";
    this.code = input.code;
    this.status = input.status;
  }
}

function isHostedExecutionHttpError(
  error: unknown,
  status: number,
  code?: string,
): error is HostedExecutionHttpResponseError {
  return error instanceof HostedExecutionHttpResponseError &&
    error.status === status &&
    (code === undefined || error.code === code);
}

function parseCloudflareHostedControlBrowserVaultSession(
  value: unknown,
  expected: {
    replicaRef: HostedBrowserVaultReplicaRef;
    userId: string;
  },
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

  assertHostedBrowserVaultReplicaRefMatches(
    replicaRef,
    expected.replicaRef,
    "Cloudflare browser vault session replicaRef",
  );

  const encryptedReplica = parseHostedCipherEnvelope(
    record.encryptedReplica,
    "Cloudflare browser vault session encryptedReplica",
  );
  const replicaAad = parseCloudflareHostedControlBrowserVaultReplicaAad(
    record.replicaAad,
    "Cloudflare browser vault session replicaAad",
  );
  const replicaKeyEnvelope = parseHostedBrowserSessionKeyEnvelope(
    record.replicaKeyEnvelope,
    "Cloudflare browser vault session replicaKeyEnvelope",
  );

  assertMatchingString(
    encryptedReplica.keyId,
    expected.replicaRef.keyId,
    "Cloudflare browser vault session encryptedReplica.keyId",
    "the requested replicaRef.keyId",
  );
  assertMatchingString(
    encryptedReplica.scope,
    "browser-vault-replica",
    "Cloudflare browser vault session encryptedReplica.scope",
    "the browser-vault-replica storage scope",
  );
  assertMatchingString(
    replicaAad.userId,
    expected.userId,
    "Cloudflare browser vault session replicaAad.userId",
    "the requested userId",
  );
  assertMatchingString(
    replicaAad.objectKey,
    expected.replicaRef.objectKey,
    "Cloudflare browser vault session replicaAad.objectKey",
    "the requested replicaRef.objectKey",
  );
  assertMatchingString(
    replicaAad.dataVersion,
    expected.replicaRef.dataVersion,
    "Cloudflare browser vault session replicaAad.dataVersion",
    "the requested replicaRef.dataVersion",
  );
  assertMatchingString(
    replicaAad.sourceBundleHash,
    expected.replicaRef.sourceBundleHash,
    "Cloudflare browser vault session replicaAad.sourceBundleHash",
    "the requested replicaRef.sourceBundleHash",
  );
  assertMatchingString(
    replicaKeyEnvelope.userId,
    expected.userId,
    "Cloudflare browser vault session replicaKeyEnvelope.userId",
    "the requested userId",
  );
  assertMatchingString(
    replicaKeyEnvelope.keyId,
    expected.replicaRef.keyId,
    "Cloudflare browser vault session replicaKeyEnvelope.keyId",
    "the requested replicaRef.keyId",
  );

  if (replicaKeyEnvelope.recipients.length === 0) {
    throw new TypeError("Cloudflare browser vault session replicaKeyEnvelope.recipients must not be empty.");
  }

  for (const [index, recipient] of replicaKeyEnvelope.recipients.entries()) {
    assertMatchingString(
      recipient.keyId,
      expected.replicaRef.keyId,
      `Cloudflare browser vault session replicaKeyEnvelope.recipients[${index}].keyId`,
      "the requested replicaRef.keyId",
    );
  }

  return {
    encryptedReplica,
    replicaAad,
    replicaKeyEnvelope,
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

function parseHostedRunnerStatusForExpectedUser(
  value: unknown,
  expectedUserId: string,
): HostedRunnerStatusResponse {
  const status = parseHostedRunnerStatusResponse(value);

  assertMatchingString(
    status.userId,
    expectedUserId,
    "Hosted runner status userId",
    "the requested userId",
  );

  if (status.workspace) {
    assertMatchingString(
      status.workspace.userId,
      expectedUserId,
      "Hosted runner status workspace.userId",
      "the requested userId",
    );
  }

  return status;
}

function assertHostedBrowserVaultReplicaRefMatches(
  actual: HostedBrowserVaultReplicaRef,
  expected: HostedBrowserVaultReplicaRef,
  label: string,
): void {
  assertMatchingNumber(
    actual.byteLength,
    expected.byteLength,
    `${label}.byteLength`,
    "the requested replicaRef.byteLength",
  );
  assertMatchingString(
    actual.dataVersion,
    expected.dataVersion,
    `${label}.dataVersion`,
    "the requested replicaRef.dataVersion",
  );
  assertMatchingString(
    actual.generatedAt,
    expected.generatedAt,
    `${label}.generatedAt`,
    "the requested replicaRef.generatedAt",
  );
  assertMatchingString(
    actual.keyId,
    expected.keyId,
    `${label}.keyId`,
    "the requested replicaRef.keyId",
  );
  assertMatchingString(
    actual.objectKey,
    expected.objectKey,
    `${label}.objectKey`,
    "the requested replicaRef.objectKey",
  );
  assertMatchingString(
    actual.sourceBundleHash,
    expected.sourceBundleHash,
    `${label}.sourceBundleHash`,
    "the requested replicaRef.sourceBundleHash",
  );
}

function assertMatchingNumber(
  actual: number,
  expected: number,
  label: string,
  expectedLabel: string,
): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
}

function assertMatchingString(
  actual: string,
  expected: string,
  label: string,
  expectedLabel: string,
): void {
  if (actual !== expected) {
    throw new TypeError(`${label} must match ${expectedLabel}.`);
  }
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

  if (input.boundUserId !== undefined) {
    headers.set(
      HOSTED_EXECUTION_USER_ID_HEADER,
      requireCloudflareHostedControlUserId(input.boundUserId),
    );
  }

  const response = await input.fetchImpl(url.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers,
    method: input.request.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new HostedExecutionHttpResponseError({
      code: await readHostedExecutionStructuredErrorCode(response),
      label: input.label,
      status: response.status,
    });
  }

  return input.parse(await response.json());
}

async function readHostedExecutionStructuredErrorCode(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
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
