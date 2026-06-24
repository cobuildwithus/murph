import {
  applyGatewayProjectionSnapshotToEventLog,
  compareGatewayTimestampsAscending,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  fetchGatewayAttachmentsFromSnapshot,
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

import {
  mergeGatewayPermissionOverrides,
  pruneGatewayPermissionOverrides,
  sameGatewayPermissionResolutionOverrides,
  upsertGatewayPermissionOverride,
  type GatewayPermissionResolutionOverride,
} from "./gateway-projection-cache-permissions.js";
import { withSerializedLock } from "./serialized-lock.js";
import { sameStructuredJsonValue } from "./structured-json.js";

// Gateway projection state is a transient DO-local cache. Durable truth still
// comes from committed runtime snapshots, not a separate Cloudflare-owned record.
interface GatewayProjectionCacheState {
  baseSnapshot: GatewayProjectionSnapshot | null;
  events: GatewayEvent[];
  nextCursor: number;
  permissionOverrides: GatewayPermissionResolutionOverride[];
  projectedSnapshot: GatewayProjectionSnapshot | null;
}

export class HostedGatewayProjectionCache {
  private cacheState: GatewayProjectionCacheState = {
    baseSnapshot: null,
    events: [],
    nextCursor: 0,
    permissionOverrides: [],
    projectedSnapshot: null,
  };
  private stateLock: Promise<void> | null = null;

  async applySnapshot(snapshot: GatewayProjectionSnapshot | null): Promise<void> {
    if (!snapshot) {
      return;
    }

    const parsed = gatewayProjectionSnapshotSchema.parse(snapshot);
    await this.withStateLock(async () => {
      const current = await this.readCacheState();
      if (
        current.baseSnapshot &&
        compareGatewayTimestampsAscending(current.baseSnapshot.generatedAt, parsed.generatedAt) > 0
      ) {
        return;
      }

      const nextOverrides = pruneGatewayPermissionOverrides(
        current.permissionOverrides,
        parsed,
      );
      const currentState = toGatewayEventLogState(current);
      const nextState = applyGatewayProjectionSnapshotToEventLog(
        currentState,
        mergeGatewayPermissionOverrides(parsed, nextOverrides) ?? parsed,
        DEFAULT_GATEWAY_EVENT_RETENTION,
      );
      const baseSnapshotChanged = !sameStructuredJsonValue(current.baseSnapshot, parsed);
      const overridesChanged = !sameGatewayPermissionResolutionOverrides(
        current.permissionOverrides,
        nextOverrides,
      );

      if (nextState === currentState && !baseSnapshotChanged && !overridesChanged) {
        return;
      }

      await this.writeCacheState({
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
      const current = await this.readCacheState();
      const snapshot = current.projectedSnapshot ?? createEmptyGatewaySnapshot();
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
      const currentState = toGatewayEventLogState(current);
      const nextState = applyGatewayProjectionSnapshotToEventLog(
        currentState,
        mergeGatewayPermissionOverrides(current.baseSnapshot, nextOverrides)
          ?? createEmptyGatewaySnapshot(),
        DEFAULT_GATEWAY_EVENT_RETENTION,
      );

      if (
        nextState !== currentState
        || !sameGatewayPermissionResolutionOverrides(current.permissionOverrides, nextOverrides)
      ) {
        await this.writeCacheState({
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
    return toGatewayEventLogState(await this.readCacheState());
  }

  private async readCacheState(): Promise<GatewayProjectionCacheState> {
    return this.cacheState;
  }

  private async writeCacheState(state: {
    baseSnapshot: GatewayProjectionSnapshot | null;
    events: GatewayEvent[];
    nextCursor: number;
    permissionOverrides: GatewayPermissionResolutionOverride[];
  }): Promise<void> {
    this.cacheState = {
      baseSnapshot: state.baseSnapshot,
      events: state.events,
      nextCursor: state.nextCursor,
      permissionOverrides: state.permissionOverrides,
      projectedSnapshot: mergeGatewayPermissionOverrides(
        state.baseSnapshot,
        state.permissionOverrides,
      ),
    };
  }

  private async withStateLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.stateLock,
        set: (value) => {
          this.stateLock = value;
        },
      },
      run,
    );
  }
}

function toGatewayEventLogState(state: GatewayProjectionCacheState): GatewayEventLogState {
  return {
    events: state.events,
    nextCursor: state.nextCursor,
    snapshot: state.projectedSnapshot,
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
