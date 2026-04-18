import { describe, expect, it } from "vitest";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "@murphai/hosted-execution";

import {
  createHostedDispatchPayloadStore,
} from "../src/dispatch-payload-store.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";

describe("hosted dispatch payload store confidentiality", () => {
  it("stores only opaque staged refs for gateway message sends", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(),
      keyId: "k-current",
    });
    const dispatch = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_gateway_1",
      linqEvent: {
        body: "super secret gateway message",
      },
      linqMessageId: "linq-1",
      occurredAt: "2026-04-03T00:00:00.000Z",
      phoneLookupKey: "phone-secret",
      userId: "user_live_123",
    });

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expectOpaqueStrings([JSON.stringify(payloadRef)], ["super secret gateway message", "phone-secret"]);
    expect([...bucket.objects.keys()]).toHaveLength(1);
    expect(await store.readDispatchPayload(payloadRef)).toEqual(dispatch);

    await store.deleteDispatchPayload(payloadRef);
    expect(bucket.deleted).toHaveLength(1);
  });

  it("stores opaque staged refs for provider webhook payloads", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(19),
      keyId: "k-current",
    });
    const linqDispatch = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_1",
      linqEvent: {
        body: "private linq body",
        nested: {
          senderPhone: "+15555555555",
        },
      },
      occurredAt: "2026-04-03T00:01:00.000Z",
      phoneLookupKey: "phone-lookup",
      userId: "user_live_456",
    });
    const telegramDispatch = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_telegram_1",
      occurredAt: "2026-04-03T00:02:00.000Z",
      telegramMessage: {
        messageId: "123",
        schema: "murph.hosted-telegram-message.v1",
        text: "private telegram text",
        threadId: "thread_123",
      },
      userId: "user_live_789",
    });

    const linqPayloadRef = await store.writeDispatchPayload(linqDispatch);
    const telegramPayloadRef = await store.writeDispatchPayload(telegramDispatch);

    expectOpaqueStrings(
      [JSON.stringify(linqPayloadRef), JSON.stringify(telegramPayloadRef)],
      ["private linq body", "phone-lookup", "private telegram text", "telegramMessage"],
    );
    expect(await store.readDispatchPayload(linqPayloadRef)).toEqual(linqDispatch);
    expect(await store.readDispatchPayload(telegramPayloadRef)).toEqual(telegramDispatch);
  });

  it("stores opaque staged refs for hosted share acceptance dispatches", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(17),
      keyId: "k-current",
    });
    const dispatch = buildHostedExecutionVaultShareAcceptedWake({
      eventId: "evt_share_1",
      memberId: "user_live_share",
      occurredAt: "2026-04-03T00:04:00.000Z",
      share: {
        ownerUserId: "user_share_owner",
        shareId: "hshare_123",
      },
    });

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expect(JSON.stringify(payloadRef)).not.toContain("hshare_123");
    expect(await store.readDispatchPayload(payloadRef)).toEqual(dispatch);
  });

  it("stores opaque staged refs for device-sync wake hints", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(21),
      keyId: "k-current",
    });
    const dispatch = buildHostedExecutionDeviceSyncWake({
      connectionId: "conn_123",
      eventId: "evt_wake_1",
      hint: {
        eventType: "sleep.updated",
        traceId: "trace_123",
      },
      occurredAt: "2026-04-03T00:05:00.000Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user_live_sync",
    });

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expectOpaqueStrings([JSON.stringify(payloadRef)], ["sleep.updated", "trace_123"]);
    expect(await store.readDispatchPayload(payloadRef)).toEqual(dispatch);
  });

  it("reads and deletes referenced payload blobs across key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const previousKey = createTestRootKey(29);
    const currentKey = createTestRootKey(31);
    const legacyStore = createHostedDispatchPayloadStore({
      bucket,
      key: previousKey,
      keyId: "k-previous",
    });
    const rotatedStore = createHostedDispatchPayloadStore({
      bucket,
      key: currentKey,
      keyId: "k-current",
      keysById: {
        "k-current": currentKey,
        "k-previous": previousKey,
      },
    });
    const dispatch = buildHostedExecutionDeviceSyncWake({
      connectionId: "conn_rotated",
      eventId: "evt_rotated",
      hint: {
        traceId: "trace_rotated",
      },
      occurredAt: "2026-04-03T00:04:00.000Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user_rotated_123",
    });

    const payloadRef = await legacyStore.writeDispatchPayload(dispatch);

    await expect(rotatedStore.readDispatchPayload(payloadRef)).resolves.toEqual(dispatch);
    await rotatedStore.deleteDispatchPayload(payloadRef);

    expect(bucket.deleted).toHaveLength(1);
  });

  it("treats unknown staged payload ids as absent", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(37),
      keyId: "k-current",
    });

    await expect(store.readDispatchPayload({
      stagedPayloadId: "transient/dispatch-payloads/missing",
    })).resolves.toBeNull();
  });

  it("stores opaque staged refs for hosted email dispatches", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(23),
      keyId: "k-current",
    });
    const dispatch = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email_1",
      identityId: "identity_1",
      occurredAt: "2026-04-03T00:03:00.000Z",
      rawMessageKey: "raw_message_1",
      selfAddress: "murph@example.com",
      userId: "user_live_email",
    });

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expectOpaqueStrings([JSON.stringify(payloadRef)], ["rawMessageKey"]);
    expect(bucket.objects.size).toBe(1);
    expect(await store.readDispatchPayload(payloadRef)).toEqual(dispatch);
  });
});
