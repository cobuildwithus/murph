import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "../src/builders.js";
import {
  buildHostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload,
  resolveHostedExecutionDispatchPayloadStorage,
  resolveHostedExecutionOutboxPayloadEventId,
  resolveHostedExecutionOutboxPayloadUserId,
} from "../src/outbox-payload.js";
const occurredAt = "2026-04-04T00:00:00.000Z";

function createInlineDispatch() {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: "member-activated-inline",
    memberId: "user-inline",
    occurredAt,
  });
}

function createReferenceDispatch() {
  return buildHostedExecutionGatewayMessageSendDispatch({
    eventId: "gateway-reference",
    occurredAt,
    sessionKey: "session-reference",
    text: "hello",
    userId: "user-reference",
  });
}

describe("resolveHostedExecutionDispatchPayloadStorage", () => {
  it("uses canonical storage for hosted events", () => {
    expect(
      resolveHostedExecutionDispatchPayloadStorage(
        buildHostedExecutionMemberActivatedDispatch({
          eventId: "member-activated-1",
          memberId: "user_123",
          occurredAt,
        }),
        "auto",
      ),
    ).toBe("inline");

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
            ownerUserId: "member_sender",
            shareId: "share_123",
          },
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
    ).toBe("reference");
  });

  it("keeps synthetic cron events inline", () => {
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
  });

  it("buildHostedExecutionOutboxPayload follows the canonical auto policy", () => {
    expect(
      buildHostedExecutionOutboxPayload(
        buildHostedExecutionMemberActivatedDispatch({
          eventId: "member-activated-2",
          memberId: "user_123",
          occurredAt,
        }),
      ).storage,
    ).toBe("inline");

    expect(
      buildHostedExecutionOutboxPayload(
        buildHostedExecutionVaultShareAcceptedDispatch({
          eventId: "share-accepted-2",
          memberId: "user_123",
          occurredAt,
          share: {
            ownerUserId: "member_sender",
            shareId: "share_456",
          },
        }),
      ).storage,
    ).toBe("inline");

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
        {
          stagedPayloadId: "staged-device-sync-2",
        },
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
        {
          stagedPayloadId: "staged-gateway-2",
        },
      ).storage,
    ).toBe("reference");
  });

  it("validates reference payload dispatches before building refs", () => {
    const invalidReferenceDispatch = {
      event: {
        kind: "gateway.message.send",
        sessionKey: "session-invalid",
        text: "hello",
        userId: "user-invalid",
      },
      occurredAt,
    };

    expect(() => buildHostedExecutionOutboxPayload(
      invalidReferenceDispatch as never,
      {
        stagedPayloadId: "staged-invalid-reference",
        storage: "reference",
      },
    )).toThrow("Hosted execution dispatch request eventId");
  });

  it("rejects forcing inline storage for reference-only gateway sends", () => {
    expect(() => buildHostedExecutionOutboxPayload(
      buildHostedExecutionGatewayMessageSendDispatch({
        eventId: "gateway-3",
        occurredAt,
        sessionKey: "session_789",
        text: "do not persist me inline",
        userId: "user_123",
      }),
      {
        storage: "inline",
      },
    )).toThrow("Hosted execution gateway.message.send outbox payloads must use reference storage.");
  });

  it("rejects non-canonical stored payload shapes for gateway sends and cron ticks", () => {
    expect(readHostedExecutionOutboxPayload({
      dispatchRef: {
        eventId: "share-legacy-1",
        eventKind: "vault.share.accepted",
        occurredAt,
        userId: "user_123",
      },
      stagedPayloadId: "staged-share-legacy-1",
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatch: buildHostedExecutionGatewayMessageSendDispatch({
        eventId: "gateway-4",
        occurredAt,
        sessionKey: "session_000",
        text: "still private",
        userId: "user_123",
      }),
      unexpected: true,
      storage: "inline",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatchRef: {
        eventId: "cron-2",
        eventKind: "assistant.cron.tick",
        occurredAt,
        userId: "user_123",
      },
      storage: "reference",
    })).toBeNull();

    expect(readHostedExecutionOutboxPayload({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "user_123",
        },
        eventId: "cron-3",
        occurredAt,
      },
      dispatchRef: {
        eventId: "gateway-5",
        eventKind: "gateway.message.send",
        occurredAt,
        userId: "user_123",
      },
      storage: "reference",
    })).toBeNull();
  });

  it("round-trips valid inline payloads", () => {
    const payload = buildHostedExecutionOutboxPayload(createInlineDispatch(), {
      storage: "inline",
    });

    expect(readHostedExecutionOutboxPayload(payload)).toEqual(payload);
  });

  it("round-trips valid reference payloads", () => {
    const payload = buildHostedExecutionOutboxPayload(createReferenceDispatch(), {
      stagedPayloadId: "staged-reference-roundtrip",
      storage: "reference",
    });

    expect(readHostedExecutionOutboxPayload(payload)).toEqual(payload);
  });

  it("returns null instead of throwing for malformed inline payloads", () => {
    expect(readHostedExecutionOutboxPayload({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "user-inline",
        },
        occurredAt,
      },
      storage: "inline",
    })).toBeNull();
  });

  it("resolves event and user identity for inline and reference payloads", () => {
    const inlinePayload = buildHostedExecutionOutboxPayload(
      buildHostedExecutionMemberActivatedDispatch({
        eventId: "member-activated-3",
        memberId: "user-inline",
        occurredAt,
      }),
    );
    const referencePayload = buildHostedExecutionOutboxPayload(
      buildHostedExecutionGatewayMessageSendDispatch({
        eventId: "gateway-6",
        occurredAt,
        sessionKey: "session-identity",
        text: "hello",
        userId: "user-reference",
      }),
      {
        stagedPayloadId: "staged-gateway-identity",
        storage: "reference",
      },
    );

    expect(resolveHostedExecutionOutboxPayloadUserId(inlinePayload)).toBe("user-inline");
    expect(resolveHostedExecutionOutboxPayloadEventId(inlinePayload)).toBe("member-activated-3");
    expect(resolveHostedExecutionOutboxPayloadUserId(referencePayload)).toBe("user-reference");
    expect(resolveHostedExecutionOutboxPayloadEventId(referencePayload)).toBe("gateway-6");
  });

  it("publishes focused subpath exports for boundary-owned helpers", async () => {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(packageJson.exports).toMatchObject({
      "./bundles": expect.any(Object),
      "./dispatch-ref": expect.any(Object),
      "./outbox-payload": expect.any(Object),
      "./side-effects": expect.any(Object),
    });
  });
});
