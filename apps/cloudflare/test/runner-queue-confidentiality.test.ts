import { describe, expect, it } from "vitest";

import {
  createHostedDispatchPayloadStore,
  resolveHostedRunnerDispatchPayloadStorage,
} from "../src/dispatch-payload-store.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

describe("hosted dispatch payload store confidentiality", () => {
  it("externalizes gateway message text into an encrypted opaque blob", async () => {
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
    expect(payloadJson).not.toContain("super secret gateway message");
    expect(payloadJson).not.toContain("session-secret");
    expect([...bucket.objects.keys()]).toHaveLength(1);
    const storedKey = [...bucket.objects.keys()][0] ?? "";
    expect(storedKey).not.toContain(dispatch.event.userId);
    expect(storedKey).not.toContain(dispatch.eventId);
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
        botUserId: "bot-1",
        telegramUpdate: {
          message: {
            text: "private telegram text",
          },
        },
      },
      eventId: "evt_telegram_1",
      occurredAt: "2026-04-03T00:02:00.000Z",
    } as const;

    const linqPayloadJson = await store.writeStoredDispatch(linqDispatch);
    const telegramPayloadJson = await store.writeStoredDispatch(telegramDispatch);

    expect(linqPayloadJson).not.toContain("private linq body");
    expect(linqPayloadJson).not.toContain("phone-lookup");
    expect(telegramPayloadJson).not.toContain("private telegram text");
    expect(telegramPayloadJson).not.toContain("telegramUpdate");
    expect(await store.readStoredDispatch(linqPayloadJson)).toEqual(linqDispatch);
    expect(await store.readStoredDispatch(telegramPayloadJson)).toEqual(telegramDispatch);
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
        kind: "gateway.message.send",
        userId: "user_rotated_123",
        clientRequestId: "client-rotated",
        replyToMessageId: null,
        sessionKey: "session-rotated",
        text: "rotated gateway payload",
      },
      eventId: "evt_gateway_rotated",
      occurredAt: "2026-04-03T00:04:00.000Z",
    } as const;

    const payloadJson = await legacyStore.writeStoredDispatch(dispatch);

    await expect(rotatedStore.readStoredDispatch(payloadJson)).resolves.toEqual(dispatch);
    await rotatedStore.deleteStoredDispatchPayload(payloadJson);

    expect(bucket.deleted).toHaveLength(2);
  });

  it("keeps non-sensitive email dispatches inline", async () => {
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

    expect(resolveHostedRunnerDispatchPayloadStorage(dispatch)).toBe("inline");
    expect(payloadJson).toContain("rawMessageKey");
    expect(bucket.objects.size).toBe(0);
    expect(await store.readStoredDispatch(payloadJson)).toEqual(dispatch);
  });
});
