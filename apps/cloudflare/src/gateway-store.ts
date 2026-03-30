import {
  applyGatewayProjectionSnapshotToEventLog,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  readGatewayMessagesFromSnapshot,
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsInputSchema,
  pollGatewayEventLogState,
  gatewayProjectionSnapshotSchema,
  gatewayPermissionRequestSchema,
  gatewayRespondToPermissionInputSchema,
  type GatewayFetchAttachmentsInput,
  type GatewayEvent,
  type GatewayEventLogState,
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
} from "murph/gateway-core";

import type { DurableObjectStateLike } from "./user-runner/types.js";

const GATEWAY_EVENTS_KEY = "gateway.events";
const GATEWAY_NEXT_CURSOR_KEY = "gateway.next-cursor";
const GATEWAY_SNAPSHOT_KEY = "gateway.snapshot";

export class HostedGatewayProjectionStore {
  constructor(private readonly state: DurableObjectStateLike) {}

  async applySnapshot(snapshot: GatewayProjectionSnapshot | null): Promise<void> {
    if (!snapshot) {
      return;
    }

    const parsed = gatewayProjectionSnapshotSchema.parse(snapshot);
    const current = await this.readState();
    if (
      current.snapshot &&
      current.snapshot.generatedAt.localeCompare(parsed.generatedAt) > 0
    ) {
      return;
    }
    await this.writeState(
      applyGatewayProjectionSnapshotToEventLog(
        current,
        parsed,
        DEFAULT_GATEWAY_EVENT_RETENTION,
      ),
    );
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
    const snapshot = await this.readOrCreateSnapshot();
    const index = snapshot.permissions.findIndex(
      (permission) => permission.requestId === parsed.requestId,
    );
    if (index < 0) {
      return null;
    }

    const existing = snapshot.permissions[index]!;
    const nextStatus = parsed.decision === "approve" ? "approved" : "denied";
    const updated = gatewayPermissionRequestSchema.parse({
      ...existing,
      status: nextStatus,
      resolvedAt: new Date().toISOString(),
      note: parsed.note ?? null,
    });
    const nextSnapshot = gatewayProjectionSnapshotSchema.parse({
      ...snapshot,
      generatedAt: new Date().toISOString(),
      permissions: snapshot.permissions.map((permission, permissionIndex) =>
        permissionIndex === index ? updated : permission,
      ),
    });

    await this.writeState(
      applyGatewayProjectionSnapshotToEventLog(
        await this.readState(),
        nextSnapshot,
        DEFAULT_GATEWAY_EVENT_RETENTION,
      ),
    );
    return updated;
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
    const snapshot = await this.state.storage.get<GatewayProjectionSnapshot>(GATEWAY_SNAPSHOT_KEY);
    const events = (await this.state.storage.get<GatewayEvent[]>(GATEWAY_EVENTS_KEY)) ?? [];
    const nextCursor = (await this.state.storage.get<number>(GATEWAY_NEXT_CURSOR_KEY)) ?? 0;

    return {
      events,
      nextCursor: typeof nextCursor === "number" && Number.isFinite(nextCursor) && nextCursor >= 0
        ? nextCursor
        : 0,
      snapshot: snapshot ? gatewayProjectionSnapshotSchema.parse(snapshot) : null,
    };
  }

  private async writeState(state: GatewayEventLogState): Promise<void> {
    await Promise.all([
      this.state.storage.put(GATEWAY_SNAPSHOT_KEY, state.snapshot),
      this.state.storage.put(GATEWAY_EVENTS_KEY, state.events),
      this.state.storage.put(GATEWAY_NEXT_CURSOR_KEY, state.nextCursor),
    ]);
  }
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
