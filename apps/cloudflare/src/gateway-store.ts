import {
  diffGatewayProjectionSnapshots,
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  readGatewayMessagesFromSnapshot,
  gatewayListOpenPermissionsInputSchema,
  gatewayEventSchema,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayProjectionSnapshotSchema,
  gatewayRespondToPermissionInputSchema,
  sameGatewayConversationSession,
  type GatewayEvent,
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
} from "murph/gateway-core";

import type { DurableObjectStateLike } from "./user-runner/types.js";

const GATEWAY_EVENT_RETENTION = 512;
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
    const previous = await this.readSnapshot();
    if (previous && previous.generatedAt.localeCompare(parsed.generatedAt) > 0) {
      return;
    }
    const emissions = diffGatewayProjectionSnapshots(previous, parsed);
    const nextCursor = await this.readNextCursor();
    let cursor = nextCursor;
    const nextEvents = [...await this.readEvents()];

    for (const emission of emissions) {
      cursor += 1;
      nextEvents.push({
        schema: "murph.gateway-event.v1",
        cursor,
        ...emission,
      });
    }

    if (nextEvents.length > GATEWAY_EVENT_RETENTION) {
      nextEvents.splice(0, nextEvents.length - GATEWAY_EVENT_RETENTION);
    }

    await Promise.all([
      this.state.storage.put(GATEWAY_SNAPSHOT_KEY, parsed),
      this.state.storage.put(GATEWAY_EVENTS_KEY, nextEvents),
      this.state.storage.put(GATEWAY_NEXT_CURSOR_KEY, cursor),
    ]);
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
    gatewayRespondToPermissionInputSchema.parse(input);
    return null;
  }

  async pollEvents(
    input?: GatewayPollEventsInput,
  ): Promise<GatewayPollEventsResult> {
    const parsed = gatewayPollEventsInputSchema.parse(input ?? {});
    const events = (await this.readEvents())
      .filter((event) => event.cursor > parsed.cursor)
      .filter((event) => parsed.kinds.length === 0 || parsed.kinds.includes(event.kind))
      .filter(
        (event) =>
          parsed.sessionKey === null ||
          (event.sessionKey !== null && sameGatewayConversationSession(event.sessionKey, parsed.sessionKey)),
      )
      .slice(0, parsed.limit);

    return gatewayPollEventsResultSchema.parse({
      events,
      nextCursor: events[events.length - 1]?.cursor ?? (await this.readNextCursor()),
      live: true,
    });
  }

  private async readOrCreateSnapshot(): Promise<GatewayProjectionSnapshot> {
    return (await this.readSnapshot()) ?? createEmptyGatewaySnapshot();
  }

  private async readSnapshot(): Promise<GatewayProjectionSnapshot | null> {
    const value = await this.state.storage.get<GatewayProjectionSnapshot>(GATEWAY_SNAPSHOT_KEY);
    return value ? gatewayProjectionSnapshotSchema.parse(value) : null;
  }

  private async readEvents(): Promise<GatewayEvent[]> {
    return ((await this.state.storage.get<GatewayEvent[]>(GATEWAY_EVENTS_KEY)) ?? []).map((event) =>
      gatewayEventSchema.parse(event),
    );
  }

  private async readNextCursor(): Promise<number> {
    const value = await this.state.storage.get<number>(GATEWAY_NEXT_CURSOR_KEY);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
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
