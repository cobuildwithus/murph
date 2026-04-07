import { describe, expect, it } from "vitest";
import type { SharePack } from "@murphai/contracts";

import {
  createHostedDispatchPayloadStore,
  resolveHostedRunnerDispatchPayloadStorage,
} from "../src/dispatch-payload-store.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";
import { expectOpaqueStrings } from "./object-key-assertions";

const SHARE_PACK: SharePack = {
  createdAt: "2026-04-06T00:00:00.000Z",
  entities: [
    {
      kind: "food",
      payload: {
        kind: "smoothie",
        status: "active",
        title: "Overnight oats",
      },
      ref: "food.oats",
    },
  ],
  schemaVersion: "murph.share-pack.v1",
  title: "Breakfast staples",
};

describe("hosted dispatch payload store confidentiality", () => {
  it("externalizes gateway message sends instead of persisting session text inline", async () => {
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

    const payloadJson = await store.writeStoredDispatch(dispatch);

    expect(resolveHostedRunnerDispatchPayloadStorage(dispatch)).toBe("reference");
    expectOpaqueStrings([payloadJson], ["super secret gateway message", "session-secret"]);
    expect([...bucket.objects.keys()]).toHaveLength(1);
    expect(await store.readStoredDispatch(payloadJson)).toEqual(dispatch);

    await store.deleteStoredDispatchPayload(payloadJson);
    expect(bucket.deleted).toHaveLength(1);
  });

  it("externalizes provider webhook payloads instead of persisting them inline", async () => {
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

    const linqPayloadJson = await store.writeStoredDispatch(linqDispatch);
    const telegramPayloadJson = await store.writeStoredDispatch(telegramDispatch);

    expectOpaqueStrings(
      [linqPayloadJson, telegramPayloadJson],
      ["private linq body", "phone-lookup", "private telegram text", "telegramMessage"],
    );
    expect(await store.readStoredDispatch(linqPayloadJson)).toEqual(linqDispatch);
    expect(await store.readStoredDispatch(telegramPayloadJson)).toEqual(telegramDispatch);
  });

  it("keeps hosted share acceptance inline without persisting the opaque pack", async () => {
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

    const payloadJson = await store.writeStoredDispatch(dispatch);

    expect(resolveHostedRunnerDispatchPayloadStorage(dispatch)).toBe("inline");
    expect(JSON.stringify(payloadJson)).not.toContain(SHARE_PACK.title);
    expect(await store.readStoredDispatch(payloadJson)).toEqual(dispatch);
  });

  it("externalizes device-sync wake hints instead of persisting them inline", async () => {
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

    const payloadJson = await store.writeStoredDispatch(dispatch);

    expect(resolveHostedRunnerDispatchPayloadStorage(dispatch)).toBe("reference");
    expectOpaqueStrings([payloadJson], ["sleep.updated", "trace_123"]);
    expect(await store.readStoredDispatch(payloadJson)).toEqual(dispatch);
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

    const payloadJson = await legacyStore.writeStoredDispatch(dispatch);

    await expect(rotatedStore.readStoredDispatch(payloadJson)).resolves.toEqual(dispatch);
    await rotatedStore.deleteStoredDispatchPayload(payloadJson);

    expect(bucket.deleted).toHaveLength(1);
  });

  it("rejects legacy raw dispatch payload JSON instead of reinterpreting it", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedDispatchPayloadStore({
      bucket,
      key: createTestRootKey(37),
      keyId: "k-current",
    });

    await expect(store.readStoredDispatch(JSON.stringify({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "legacy_user",
      },
      eventId: "evt_legacy_raw",
      occurredAt: "2026-04-03T00:06:00.000Z",
    }))).rejects.toThrow("Hosted dispatch payload envelope is invalid.");
  });

  it("externalizes hosted email dispatch refs instead of persisting them inline", async () => {
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

    const payloadJson = await store.writeStoredDispatch(dispatch);

    expect(resolveHostedRunnerDispatchPayloadStorage(dispatch)).toBe("reference");
    expectOpaqueStrings([payloadJson], ["rawMessageKey"]);
    expect(bucket.objects.size).toBe(1);
    expect(await store.readStoredDispatch(payloadJson)).toEqual(dispatch);
  });
});
