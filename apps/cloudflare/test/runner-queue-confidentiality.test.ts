import { describe, expect, it } from "vitest";

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
    const dispatch = {
      event: {
        kind: "gateway.message.send",
        userId: "user_live_123",
        clientRequestId: "client-1",
        replyToMessageId: null,
        sessionKey: "session-secret",
        text: "super secret gateway message",
      },
      eventId: "evt_gateway_1",
      occurredAt: "2026-04-03T00:00:00.000Z",
    } as const;

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expectOpaqueStrings([JSON.stringify(payloadRef)], ["super secret gateway message", "session-secret"]);
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
    const linqDispatch = {
      event: {
        kind: "linq.message.received",
        userId: "user_live_456",
        linqEvent: {
          body: "private linq body",
          nested: {
            senderPhone: "+15555555555",
          },
        },
        phoneLookupKey: "phone-lookup",
      },
      eventId: "evt_linq_1",
      occurredAt: "2026-04-03T00:01:00.000Z",
    } as const;
    const telegramDispatch = {
      event: {
        kind: "telegram.message.received",
        userId: "user_live_789",
        telegramMessage: {
          messageId: "123",
          schema: "murph.hosted-telegram-message.v1",
          text: "private telegram text",
          threadId: "thread_123",
        },
      },
      eventId: "evt_telegram_1",
      occurredAt: "2026-04-03T00:02:00.000Z",
    } as const;

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
    const dispatch = {
      event: {
        kind: "vault.share.accepted",
        share: {
          ownerUserId: "user_share_owner",
          shareId: "hshare_123",
        },
        userId: "user_live_share",
      },
      eventId: "evt_share_1",
      occurredAt: "2026-04-03T00:04:00.000Z",
    } as const;

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
    const dispatch = {
      event: {
        kind: "device-sync.wake",
        connectionId: "conn_123",
        hint: {
          eventType: "sleep.updated",
          traceId: "trace_123",
        },
        provider: "oura",
        reason: "webhook_hint",
        userId: "user_live_sync",
      },
      eventId: "evt_wake_1",
      occurredAt: "2026-04-03T00:05:00.000Z",
    } as const;

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
    const dispatch = {
      event: {
        kind: "device-sync.wake",
        connectionId: "conn_rotated",
        hint: {
          traceId: "trace_rotated",
        },
        provider: "oura",
        reason: "webhook_hint",
        userId: "user_rotated_123",
      },
      eventId: "evt_rotated",
      occurredAt: "2026-04-03T00:04:00.000Z",
    } as const;

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
    const dispatch = {
      event: {
        kind: "email.message.received",
        userId: "user_live_email",
        identityId: "identity_1",
        rawMessageKey: "raw_message_1",
        selfAddress: "murph@example.com",
      },
      eventId: "evt_email_1",
      occurredAt: "2026-04-03T00:03:00.000Z",
    } as const;

    const payloadRef = await store.writeDispatchPayload(dispatch);

    expectOpaqueStrings([JSON.stringify(payloadRef)], ["rawMessageKey"]);
    expect(bucket.objects.size).toBe(1);
    expect(await store.readDispatchPayload(payloadRef)).toEqual(dispatch);
  });
});
