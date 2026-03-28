import type {
  DeviceSyncAccountStatus,
  PublicDeviceSyncAccount,
} from "@murph/device-syncd";
import type {
  HostedExecutionDeviceSyncJobHint,
  HostedExecutionDeviceSyncWakeEvent,
} from "@murph/hosted-execution";

interface HostedDeviceSyncControlPlaneConfig {
  baseUrl: string;
  token: string;
}

export interface HostedDeviceSyncRuntimeTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
}

export interface HostedDeviceSyncRuntimeConnectionSnapshot {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedDeviceSyncRuntimeSnapshotResponse {
  connections: HostedDeviceSyncRuntimeConnectionSnapshot[];
  generatedAt: string;
  userId: string;
}

export interface HostedDeviceSyncRuntimeConnectionUpdate {
  accessTokenExpiresAt?: string | null;
  clearError?: boolean;
  connectionId: string;
  displayName?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastWebhookAt?: string | null;
  metadata?: Record<string, unknown>;
  nextReconcileAt?: string | null;
  observedTokenVersion?: number | null;
  scopes?: string[];
  status?: DeviceSyncAccountStatus;
  tokenBundle?: HostedDeviceSyncRuntimeTokenBundle | null;
}

export async function fetchHostedDeviceSyncRuntimeSnapshot(input: {
  connectionId?: string | null;
  env: Readonly<Record<string, string>>;
  provider?: string | null;
  userId: string;
}): Promise<HostedDeviceSyncRuntimeSnapshotResponse | null> {
  const config = resolveHostedDeviceSyncControlPlaneConfig(input.env);

  if (!config) {
    return null;
  }

  const response = await fetch(new URL("/api/internal/device-sync/runtime/snapshot", config.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      userId: input.userId,
    }),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(buildHostedDeviceSyncControlPlaneErrorMessage(response.status, payload, "snapshot"));
  }

  return parseHostedDeviceSyncRuntimeSnapshotResponse(payload);
}

export async function applyHostedDeviceSyncRuntimeUpdates(input: {
  env: Readonly<Record<string, string>>;
  occurredAt?: string | null;
  updates: HostedDeviceSyncRuntimeConnectionUpdate[];
  userId: string;
}): Promise<void> {
  const config = resolveHostedDeviceSyncControlPlaneConfig(input.env);

  if (!config || input.updates.length === 0) {
    return;
  }

  const response = await fetch(new URL("/api/internal/device-sync/runtime/apply", config.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      updates: input.updates,
      userId: input.userId,
    }),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(buildHostedDeviceSyncControlPlaneErrorMessage(response.status, payload, "apply"));
  }
}

export function resolveHostedDeviceSyncWakeContext(
  event: HostedExecutionDeviceSyncWakeEvent,
): {
  connectionId: string | null;
  hint: HostedExecutionDeviceSyncWakeEvent["hint"];
  provider: string | null;
} {
  return {
    connectionId: event.connectionId ?? null,
    hint: event.hint ?? null,
    provider: event.provider ?? null,
  };
}

export function normalizeHostedDeviceSyncJobHints(
  value: HostedExecutionDeviceSyncWakeEvent["hint"],
): HostedExecutionDeviceSyncJobHint[] {
  return Array.isArray(value?.jobs)
    ? value.jobs.map((job) => ({
        kind: job.kind,
        ...(job.availableAt ? { availableAt: job.availableAt } : {}),
        ...(job.dedupeKey !== undefined ? { dedupeKey: job.dedupeKey ?? null } : {}),
        ...(typeof job.maxAttempts === "number" ? { maxAttempts: job.maxAttempts } : {}),
        ...(job.payload ? { payload: { ...job.payload } } : {}),
        ...(typeof job.priority === "number" ? { priority: job.priority } : {}),
      }))
    : [];
}

function resolveHostedDeviceSyncControlPlaneConfig(
  env: Readonly<Record<string, string>>,
): HostedDeviceSyncControlPlaneConfig | null {
  const token = env.HOSTED_EXECUTION_INTERNAL_TOKEN ?? env.HOSTED_EXECUTION_CONTROL_TOKEN ?? null;
  const baseUrl = normalizeOptionalBaseUrl(
    env.HOSTED_DEVICE_SYNC_CONTROL_BASE_URL ?? env.HOSTED_ONBOARDING_PUBLIC_BASE_URL ?? null,
  );

  if (!token || !baseUrl) {
    return null;
  }

  return {
    baseUrl,
    token,
  };
}

function parseHostedDeviceSyncRuntimeSnapshotResponse(
  value: unknown,
): HostedDeviceSyncRuntimeSnapshotResponse {
  const record = requireObject(value, "Hosted device-sync runtime snapshot response");

  return {
    connections: requireArray(
      record.connections,
      "Hosted device-sync runtime snapshot response connections",
    ).map((entry, index) => parseHostedDeviceSyncRuntimeConnectionSnapshot(entry, index)),
    generatedAt: requireString(
      record.generatedAt,
      "Hosted device-sync runtime snapshot response generatedAt",
    ),
    userId: requireString(record.userId, "Hosted device-sync runtime snapshot response userId"),
  };
}

function parseHostedDeviceSyncRuntimeConnectionSnapshot(
  value: unknown,
  index: number,
): HostedDeviceSyncRuntimeConnectionSnapshot {
  const record = requireObject(
    value,
    `Hosted device-sync runtime snapshot response connections[${index}]`,
  );

  return {
    connection: parsePublicDeviceSyncAccount(
      record.connection,
      `Hosted device-sync runtime snapshot response connections[${index}].connection`,
    ),
    tokenBundle: parseHostedDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `Hosted device-sync runtime snapshot response connections[${index}].tokenBundle`,
    ),
  };
}

function parseHostedDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedDeviceSyncRuntimeTokenBundle | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableString(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requireNumber(record.tokenVersion, `${label}.tokenVersion`),
  };
}

function parsePublicDeviceSyncAccount(value: unknown, label: string): PublicDeviceSyncAccount {
  const record = requireObject(value, label);

  return {
    id: requireString(record.id, `${label}.id`),
    provider: requireString(record.provider, `${label}.provider`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    displayName: readNullableString(record.displayName, `${label}.displayName`),
    status: parseDeviceSyncStatus(record.status, `${label}.status`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    accessTokenExpiresAt: readNullableString(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    metadata: requireObject(record.metadata, `${label}.metadata`),
    connectedAt: requireString(record.connectedAt, `${label}.connectedAt`),
    lastWebhookAt: readNullableString(record.lastWebhookAt, `${label}.lastWebhookAt`),
    lastSyncStartedAt: readNullableString(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastSyncCompletedAt: readNullableString(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableString(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastErrorCode: readNullableString(record.lastErrorCode, `${label}.lastErrorCode`),
    lastErrorMessage: readNullableString(record.lastErrorMessage, `${label}.lastErrorMessage`),
    nextReconcileAt: readNullableString(record.nextReconcileAt, `${label}.nextReconcileAt`),
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    updatedAt: requireString(record.updatedAt, `${label}.updatedAt`),
  };
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) as unknown : null;
}

function buildHostedDeviceSyncControlPlaneErrorMessage(
  status: number,
  payload: unknown,
  action: "apply" | "snapshot",
): string {
  const errorPayload = extractErrorPayload(payload);
  const message = errorPayload?.message ?? JSON.stringify(payload);
  return `Hosted device-sync runtime ${action} failed with HTTP ${status}: ${message}`;
}

function extractErrorPayload(value: unknown): { code?: string; message?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!record.error || typeof record.error !== "object" || Array.isArray(record.error)) {
    return null;
  }

  const error = record.error as Record<string, unknown>;
  return {
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(typeof error.message === "string" ? { message: error.message } : {}),
  };
}

function normalizeOptionalBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function parseDeviceSyncStatus(value: unknown, label: string): DeviceSyncAccountStatus {
  const status = requireString(value, label);

  if (status === "active" || status === "reauthorization_required" || status === "disconnected") {
    return status;
  }

  throw new TypeError(`${label} must be an active, reauthorization_required, or disconnected status.`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}
