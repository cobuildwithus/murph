import { describe, expect, it } from "vitest";

import { createHostedMemberPrivateStateStore } from "../src/member-private-state-store.js";
import { hostedMemberPrivateStateObjectKey } from "../src/storage-paths.js";

import { createTestRootKey, MemoryEncryptedR2Bucket } from "./test-helpers";

const ROOT_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 11));
const ROOT_KEY_ID = "urk:test";

describe("createHostedMemberPrivateStateStore", () => {
  it("keeps member private state isolated to the owning user root-key domain", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const ownerStore = createHostedMemberPrivateStateStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      userId: "member_owner",
    });
    const otherStore = createHostedMemberPrivateStateStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      userId: "member_other",
    });

    await ownerStore.writeState({
      linqChatId: "chat_123",
      memberId: "member_owner",
      privyUserId: "did:privy:123",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: "0xabc",
    });

    await expect(ownerStore.readState()).resolves.toEqual({
      linqChatId: "chat_123",
      memberId: "member_owner",
      privyUserId: "did:privy:123",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: "0xabc",
    });
    await expect(otherStore.readState()).resolves.toBeNull();
  });

  it("requires a rewrite before member private state survives platform root-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(9);
    const nextKey = createTestRootKey(10);
    const oldStore = createHostedMemberPrivateStateStore({
      bucket,
      key: oldKey,
      keyId: "old",
      userId: "member_owner",
    });
    const rotatedStore = createHostedMemberPrivateStateStore({
      bucket,
      key: nextKey,
      keyId: "next",
      keysById: { next: nextKey, old: oldKey },
      userId: "member_owner",
    });

    await oldStore.writeState({
      linqChatId: null,
      memberId: "member_owner",
      privyUserId: "did:privy:123",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    });

    await expect(oldStore.readState()).resolves.toMatchObject({
      memberId: "member_owner",
      privyUserId: "did:privy:123",
    });
    await expect(rotatedStore.readState()).resolves.toBeNull();
  });

  it("deletes only the authoritative member-private-state object key", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedMemberPrivateStateStore({
      bucket,
      key: ROOT_KEY,
      keyId: ROOT_KEY_ID,
      userId: "member_owner",
    });
    const objectKey = await hostedMemberPrivateStateObjectKey(ROOT_KEY, "member_owner");

    await store.writeState({
      linqChatId: null,
      memberId: "member_owner",
      privyUserId: "did:privy:123",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    });
    await store.deleteState();

    expect(bucket.deleted).toEqual([objectKey]);
    await expect(store.readState()).resolves.toBeNull();
  });
});
