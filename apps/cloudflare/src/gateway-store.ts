import {
  applyGatewayProjectionSnapshotToEventLog,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  fetchGatewayAttachmentsFromSnapshot,
  gatewayEventSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayPermissionRequestSchema,
  gatewayPollEventsInputSchema,
  gatewayProjectionSnapshotSchema,
  gatewayRespondToPermissionInputSchema,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  pollGatewayEventLogState,
  readGatewayMessagesFromSnapshot,
  type GatewayEvent,
  type GatewayEventLogState,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
  type GatewayRespondToPermissionInput,
} from "@murphai/gateway-core";

import { buildHostedStorageAad } from "./crypto-context.js";
import {
  decryptHostedBundle,
  encryptHostedBundle,
  type HostedCipherEnvelope,
} from "./crypto.js";
import type { DurableObjectStateLike } from "./user-runner/types.js";

const GATEWAY_STATE_SCHEMA = "murph.hosted-gateway-state.v1";
const GATEWAY_STATE_STORAGE_KEY = "gateway.state";
const GATEWAY_STATE_STORAGE_AAD = buildHostedStorageAad({
  key: GATEWAY_STATE_STORAGE_KEY,
  purpose: "gateway-store",
  record: "state",
});
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

interface GatewayPermissionResolutionOverride {
  note: string | null;
  requestId: string;
  resolvedAt: string;
  status: Exclude<GatewayPermissionRequest["status"], "open">;
}

interface StoredGatewayStateRecord {
  baseSnapshot: GatewayProjectionSnapshot | null;
  events: GatewayEvent[];
  nextCursor: number;
  permissionOverrides: GatewayPermissionResolutionOverride[];
  schema: typeof GATEWAY_STATE_SCHEMA;
}

interface StoredGatewayState {
  baseSnapshot: GatewayProjectionSnapshot | null;
  events: GatewayEvent[];
  nextCursor: number;
  permissionOverrides: GatewayPermissionResolutionOverride[];
  snapshot: GatewayProjectionSnapshot | null;
}

interface HostedGatewayProjectionStoreCrypto {
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}

export class HostedGatewayProjectionStore {
  private stateLock: Promise<void> | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly crypto: HostedGatewayProjectionStoreCrypto,
  ) {}

  async applySnapshot(snapshot: GatewayProjectionSnapshot | null): Promise<void> {
    if (!snapshot) {
      return;
    }

    const parsed = gatewayProjectionSnapshotSchema.parse(snapshot);
    await this.withStateLock(async () => {
      const current = await this.readStoredState();
      if (
        current.baseSnapshot &&
        current.baseSnapshot.generatedAt.localeCompare(parsed.generatedAt) > 0
      ) {
        return;
      }

      const nextOverrides = pruneGatewayPermissionOverrides(
        current.permissionOverrides,
        parsed,
      );
      const currentState: GatewayEventLogState = {
        events: current.events,
        nextCursor: current.nextCursor,
        snapshot: current.snapshot,
      };
      const nextState = applyGatewayProjectionSnapshotToEventLog(
        currentState,
        mergeGatewayPermissionOverrides(parsed, nextOverrides) ?? parsed,
        DEFAULT_GATEWAY_EVENT_RETENTION,
      );
      const baseSnapshotChanged = !sameStructuredValue(current.baseSnapshot, parsed);
      const overridesChanged = !sameStructuredValue(current.permissionOverrides, nextOverrides);

      if (nextState === currentState && !baseSnapshotChanged && !overridesChanged) {
        return;
      }

      await this.writeStoredState({
        baseSnapshot: parsed,
        events: nextState.events,
        nextCursor: nextState.nextCursor,
        permissionOverrides: nextOverrides,
      });
    });
  }

  async listConversations(
    input?: GatewayListConversationsInput,
  ): Promise<GatewayListConversationsResult> {
    return listGatewayConversationsFromSnapshot(await this.readOrCreateSnapshot(), input);
  }

  async getConversation(
    input: GatewayGetConversationInput,
  ) {
    return getGatewayConversationFromSnapshot(await this.readOrCreateSnapshot(), input);
  }

  async readMessages(
    input: GatewayReadMessagesInput,
  ): Promise<GatewayReadMessagesResult> {
    return readGatewayMessagesFromSnapshot(await this.readOrCreateSnapshot(), input);
  }

  async fetchAttachments(
    input: GatewayFetchAttachmentsInput,
  ) {
    return fetchGatewayAttachmentsFromSnapshot(await this.readOrCreateSnapshot(), input);
  }

  async listOpenPermissions(
    input?: {
      sessionKey?: string | null;
    },
  ): Promise<GatewayPermissionRequest[]> {
    const parsed = gatewayListOpenPermissionsInputSchema.parse(input ?? {});
    return listGatewayOpenPermissionsFromSnapshot(await this.readOrCreateSnapshot(), parsed);
  }

  async respondToPermission(
    input: GatewayRespondToPermissionInput,
  ): Promise<GatewayPermissionRequest | null> {
    const parsed = gatewayRespondToPermissionInputSchema.parse(input);
    return this.withStateLock(async () => {
      const current = await this.readStoredState();
      const snapshot = current.snapshot ?? createEmptyGatewaySnapshot();
      const index = snapshot.permissions.findIndex(
        (permission) => permission.requestId === parsed.requestId,
      );
      if (index < 0) {
        return null;
      }

      const existing = snapshot.permissions[index]!;
      const nextStatus = parsed.decision === "approve" ? "approved" : "denied";
      const nextNote = parsed.note ?? null;
      if (
        existing.status === nextStatus
        && existing.note === nextNote
        && existing.resolvedAt
      ) {
        return existing;
      }

      const updated = gatewayPermissionRequestSchema.parse({
        ...existing,
        note: nextNote,
        resolvedAt: new Date().toISOString(),
        status: nextStatus,
      });
      const nextOverrides = upsertGatewayPermissionOverride(current.permissionOverrides, updated);
      const currentState: GatewayEventLogState = {
        events: current.events,
        nextCursor: current.nextCursor,
        snapshot: current.snapshot,
      };
      const nextState = applyGatewayProjectionSnapshotToEventLog(
        currentState,
        mergeGatewayPermissionOverrides(current.baseSnapshot, nextOverrides)
          ?? createEmptyGatewaySnapshot(),
        DEFAULT_GATEWAY_EVENT_RETENTION,
      );

      if (
        nextState !== currentState
        || !sameStructuredValue(current.permissionOverrides, nextOverrides)
      ) {
        await this.writeStoredState({
          baseSnapshot: current.baseSnapshot,
          events: nextState.events,
          nextCursor: nextState.nextCursor,
          permissionOverrides: nextOverrides,
        });
      }

      return updated;
    });
  }

  async pollEvents(
    input?: GatewayPollEventsInput,
  ): Promise<GatewayPollEventsResult> {
    gatewayPollEventsInputSchema.parse(input ?? {});
    return pollGatewayEventLogState(await this.readState(), input);
  }

  private async readOrCreateSnapshot(): Promise<GatewayProjectionSnapshot> {
    return (await this.readState()).snapshot ?? createEmptyGatewaySnapshot();
  }

  private async readState(): Promise<GatewayEventLogState> {
    const state = await this.readStoredState();
    return {
      events: state.events,
      nextCursor: state.nextCursor,
      snapshot: state.snapshot,
    };
  }

  private async readStoredState(): Promise<StoredGatewayState> {
    const envelope = await this.state.storage.get<HostedCipherEnvelope>(GATEWAY_STATE_STORAGE_KEY);

    if (!envelope) {
      return {
        baseSnapshot: null,
        events: [],
        nextCursor: 0,
        permissionOverrides: [],
        snapshot: null,
      };
    }

    const plaintext = await decryptHostedBundle({
      aad: GATEWAY_STATE_STORAGE_AAD,
      envelope,
      expectedKeyId: this.crypto.keyId,
      key: this.crypto.key,
      keysById: this.crypto.keysById,
      scope: "gateway-store",
    });
    const record = parseStoredGatewayStateRecord(
      JSON.parse(utf8Decoder.decode(plaintext)) as unknown,
    );
    const normalizedOverrides = readGatewayPermissionOverrides(record.permissionOverrides);

    return {
      baseSnapshot: record.baseSnapshot,
      events: record.events,
      nextCursor: record.nextCursor,
      permissionOverrides: normalizedOverrides,
      snapshot: mergeGatewayPermissionOverrides(record.baseSnapshot, normalizedOverrides),
    };
  }

  private async writeStoredState(state: {
    baseSnapshot: GatewayProjectionSnapshot | null;
    events: GatewayEvent[];
    nextCursor: number;
    permissionOverrides: GatewayPermissionResolutionOverride[];
  }): Promise<void> {
    const envelope = await encryptHostedBundle({
      aad: GATEWAY_STATE_STORAGE_AAD,
      key: this.crypto.key,
      keyId: this.crypto.keyId,
      plaintext: utf8Encoder.encode(JSON.stringify({
        baseSnapshot: state.baseSnapshot,
        events: state.events,
        nextCursor: state.nextCursor,
        permissionOverrides: state.permissionOverrides,
        schema: GATEWAY_STATE_SCHEMA,
      } satisfies StoredGatewayStateRecord)),
      scope: "gateway-store",
    });

    await this.state.storage.put(GATEWAY_STATE_STORAGE_KEY, envelope);
  }

  private async withStateLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.stateLock ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.stateLock = chain;
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.stateLock === chain) {
        this.stateLock = null;
      }
    }
  }
}

function parseStoredGatewayStateRecord(value: unknown): StoredGatewayStateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("gateway.state storage is invalid.");
  }

  const record = value as Record<string, unknown>;
  if (record.schema !== GATEWAY_STATE_SCHEMA) {
    throw new TypeError("gateway.state storage schema is invalid.");
  }

  const baseSnapshotValue = record.baseSnapshot;
  const eventsValue = record.events;
  const permissionOverridesValue = record.permissionOverrides;
  const nextCursorValue = record.nextCursor;

  return {
    baseSnapshot:
      baseSnapshotValue === null || baseSnapshotValue === undefined
        ? null
        : gatewayProjectionSnapshotSchema.parse(baseSnapshotValue),
    events: Array.isArray(eventsValue)
      ? eventsValue.map((event) => gatewayEventSchema.parse(event))
      : [],
    nextCursor:
      typeof nextCursorValue === "number" && Number.isFinite(nextCursorValue) && nextCursorValue >= 0
        ? nextCursorValue
        : 0,
    permissionOverrides: readGatewayPermissionOverrides(permissionOverridesValue),
    schema: GATEWAY_STATE_SCHEMA,
  };
}

function createEmptyGatewaySnapshot(): GatewayProjectionSnapshot {
  return {
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: new Date().toISOString(),
    conversations: [],
    messages: [],
    permissions: [],
  };
}

function mergeGatewayPermissionOverrides(
  snapshot: GatewayProjectionSnapshot | null,
  overrides: readonly GatewayPermissionResolutionOverride[],
): GatewayProjectionSnapshot | null {
  if (!snapshot || overrides.length === 0) {
    return snapshot;
  }

  const overridesByRequestId = new Map(overrides.map((override) => [override.requestId, override]));
  let changed = false;
  let generatedAt = snapshot.generatedAt;
  const permissions = snapshot.permissions.map((permission) => {
    const override = overridesByRequestId.get(permission.requestId);
    if (!override) {
      return permission;
    }

    if (override.resolvedAt.localeCompare(generatedAt) > 0) {
      generatedAt = override.resolvedAt;
    }

    const merged = gatewayPermissionRequestSchema.parse({
      ...permission,
      note: override.note,
      resolvedAt: override.resolvedAt,
      status: override.status,
    });
    if (!sameStructuredValue(permission, merged)) {
      changed = true;
    }
    return merged;
  });

  if (!changed && generatedAt === snapshot.generatedAt) {
    return snapshot;
  }

  return gatewayProjectionSnapshotSchema.parse({
    ...snapshot,
    generatedAt,
    permissions,
  });
}

function readGatewayPermissionOverrides(
  value: unknown,
): GatewayPermissionResolutionOverride[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError("gateway.state storage is invalid.");
  }

  return value.map((entry): GatewayPermissionResolutionOverride => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.requestId !== "string" || record.requestId.length === 0) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    const status = record.status;
    if (
      status !== "approved"
      && status !== "denied"
      && status !== "expired"
    ) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    if (typeof record.resolvedAt !== "string" || Number.isNaN(Date.parse(record.resolvedAt))) {
      throw new TypeError("gateway.state storage is invalid.");
    }

    if (record.note !== null && record.note !== undefined && typeof record.note !== "string") {
      throw new TypeError("gateway.state storage is invalid.");
    }

    return {
      note: typeof record.note === "string" && record.note.length > 0 ? record.note : null,
      requestId: record.requestId,
      resolvedAt: record.resolvedAt,
      status,
    };
  }).sort((left, right) => left.requestId.localeCompare(right.requestId));
}

function pruneGatewayPermissionOverrides(
  overrides: readonly GatewayPermissionResolutionOverride[],
  snapshot: GatewayProjectionSnapshot,
): GatewayPermissionResolutionOverride[] {
  if (overrides.length === 0) {
    return [];
  }

  const requestIds = new Set(snapshot.permissions.map((permission) => permission.requestId));
  return overrides.filter((override) => requestIds.has(override.requestId));
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function upsertGatewayPermissionOverride(
  overrides: readonly GatewayPermissionResolutionOverride[],
  permission: GatewayPermissionRequest,
): GatewayPermissionResolutionOverride[] {
  const status = permission.status;
  if (status === "open") {
    throw new TypeError("Gateway permission overrides must not store open permissions.");
  }

  const nextOverrides = overrides.filter((override) => override.requestId !== permission.requestId);
  nextOverrides.push({
    note: permission.note,
    requestId: permission.requestId,
    resolvedAt: permission.resolvedAt ?? new Date().toISOString(),
    status,
  });

  return nextOverrides.sort((left, right) => left.requestId.localeCompare(right.requestId));
}
