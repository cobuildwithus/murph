import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "../src/builders";
import {
  buildHostedExecutionOutboxPayload,
  resolveHostedExecutionDispatchPayloadStorage,
} from "../src/outbox-payload";

const occurredAt = "2026-04-04T00:00:00.000Z";

describe("resolveHostedExecutionDispatchPayloadStorage", () => {
  it("uses reference storage for reconstructable hosted events", () => {
    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionMemberActivatedDispatch({
          eventId: "member-activated-1",
          memberId: "user_123",
          occurredAt,
        }),
        "auto",
      ),
    ).toBe("reference");

    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionDeviceSyncWakeDispatch({
          connectionId: "conn_123",
          eventId: "device-sync-1",
          occurredAt,
          provider: "oura",
          reason: "webhook_hint",
          userId: "user_123",
        }),
        "auto",
      ),
    ).toBe("reference");

    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionVaultShareAcceptedDispatch({
          eventId: "share-accepted-1",
          memberId: "user_123",
          occurredAt,
          share: {
            shareId: "share_123",
          },
        }),
        "auto",
      ),
    ).toBe("reference");
  });

  it("keeps synthetic or non-reconstructable events inline", () => {
    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionAssistantCronTickDispatch({
          eventId: "cron-1",
          occurredAt,
          reason: "alarm",
          userId: "user_123",
        }),
        "auto",
      ),
    ).toBe("inline");

    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionGatewayMessageSendDispatch({
          eventId: "gateway-1",
          occurredAt,
          sessionKey: "session_123",
          text: "hello",
          userId: "user_123",
        }),
        "auto",
      ),
    ).toBe("inline");
  });

  it("buildHostedExecutionOutboxPayload follows the canonical auto policy", () => {
    expect(
      buildHostedExecutionOutboxPayload(
        buildHostedExecutionDeviceSyncWakeDispatch({
          connectionId: "conn_123",
          eventId: "device-sync-2",
          occurredAt,
          provider: "whoop",
          reason: "connected",
          userId: "user_123",
        }),
      ).storage,
    ).toBe("reference");

    expect(
      buildHostedExecutionOutboxPayload(
        buildHostedExecutionGatewayMessageSendDispatch({
          eventId: "gateway-2",
          occurredAt,
          sessionKey: "session_456",
          text: "hello again",
          userId: "user_123",
        }),
      ).storage,
    ).toBe("inline");
  });
});
