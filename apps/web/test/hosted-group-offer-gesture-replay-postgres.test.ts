import { generateKeyPairSync, randomInt, randomUUID } from "node:crypto";

import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { buildTelegramThreadId } from "@murphai/messaging-ingress/telegram-webhook";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptHostedGroupOfferAffirmation } from "@/src/lib/hosted-groups/group-offer-affirmation";
import { leaveHostedGroupMemberTx } from "@/src/lib/hosted-groups/group-store";
import {
  recordHostedGroupDisclosurePermissionTx,
  revokeHostedGroupDisclosureGrantForMemberTx,
} from "@/src/lib/hosted-groups/group-disclosure-store";
import { handleHostedTelegramGroupOfferCallback } from "@/src/lib/hosted-groups/telegram-offer-callback";
import { handleHostedGroupJoinOfferReaction } from "@/src/lib/hosted-groups/join-offer-reaction";
import {
  createHostedGroupOfferMessageLookupKey,
  createHostedGroupOfferMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-groups/offer-message-binding";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { upsertHostedMemberTelegramRoutingBindingTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedMemberIdentityPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import { removeHostedMemberLinkedAccountProjectionTx } from "@/src/lib/hosted-onboarding/linked-account-removal";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { createHostedLinqProviderEventLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import {
  HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA,
  HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA,
} from "@/src/lib/hosted-onboarding/telegram-client";
import { createPrismaClient } from "@/src/lib/prisma";

const provider = vi.hoisted(() => ({ answer: vi.fn(), signal: vi.fn().mockResolvedValue(undefined), send: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/telegram-client", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/telegram-client")>(),
  answerHostedTelegramCallbackQueryBestEffort: provider.answer,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-orchestration/signal-runtime")>(),
  signalHostedMailboxAppendRuntime: provider.signal,
}));
vi.mock("@/src/lib/hosted-onboarding/linq", async (original) => {
  const actual = await original<typeof import("@/src/lib/hosted-onboarding/linq")>();
  return { ...actual, sendHostedLinqChatMessage: provider.send,
    verifyAndParseHostedLinqWebhookRequest: (input: { rawBody: string }) => actual.parseHostedLinqWebhookEvent(input.rawBody),
  };
});

vi.mock("@/src/lib/hosted-crypto/env", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/env")
  >();
  const {
    createHostedAuthorityVerifyKeyring,
    createHostedRecipientPublicKeyring,
  } = await vi.importActual<typeof import("@murphai/runtime-state")>(
    "@murphai/runtime-state",
  );
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName =
    "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  const cloudflareAutomationRecipientKeyId = "test-automation-key";
  const cloudflareAutomationPublicKeyring = createHostedRecipientPublicKeyring({
    activePublicJwk: automationKey.publicKey,
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: cloudflareAutomationRecipientKeyId,
  });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    NODE_ENV: "test",
  });

  return {
    ...actual,
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName,
      authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({
        activeKeyVersionName: authoritySignKeyVersionName,
        activePublicKeyPem: authorityKey.publicKey,
      }),
      cloudflareAutomationPublicJwk: automationKey.publicKey,
      cloudflareAutomationPublicKeyring,
      cloudflareAutomationRecipientKeyId,
      env: "test",
      gcpKms,
      recoveryPublicJwk: null,
      recoveryRecipientKeyId: null,
      teeRuntimeAttestedPolicyId: null,
      teeRuntimePublicJwk: null,
      teeRuntimeRecipientKeyId: null,
      webWrapKmsKeyName:
        "projects/example/locations/global/keyRings/hosted/cryptoKeys/group-reply-recovery",
    }),
  };
});


const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgres = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgres) {
  const url = new URL(databaseUrl);
  const hosts = url.searchParams.getAll("host");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || hosts.length > 1
    || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hosts[0] || url.hostname)) {
    throw new Error("Group gesture proofs require a loopback DATABASE_URL.");
  }
}
const txOptions = { maxWait: 10_000, timeout: 20_000 };
const postedAt = new Date("2026-07-01T12:00:00.000Z");
type OfferKind = "join" | "disclosure";
type HandleKind = "phone" | "email";
type Fixture = Awaited<ReturnType<typeof createFixture>>;

beforeEach(() => {
  provider.answer.mockReset();
  provider.signal.mockClear();
  provider.send.mockReset();
});

describe.skipIf(!runPostgres)("group offer gesture PostgreSQL replay boundaries", () => {
  it.each([false, true])("Telegram join replay stays spent after leave (fresh rejoin: %s)", async (rejoin) => {
    await withFixture({}, async (f) => {
      const callback = f.callback("join", "original");
      expect(await f.tap(callback)).toEqual({ handled: true, reason: "accepted-telegram-group-join" });
      expect(await f.memberships()).toHaveLength(1);
      expect(await f.shares()).toHaveLength(2);
      expect(await f.shares()).toEqual(expect.arrayContaining([
        expect.objectContaining({ projectionKind: "sleep-duration-days.v0" }),
      ]));
      await f.leave();
      expect(await f.memberships()).toHaveLength(0);
      expect(await f.shares()).toHaveLength(0);
      if (rejoin) {
        expect((await f.tap(f.callback("join", "fresh"))).handled).toBe(true);
      }
      const before = { memberships: await f.memberships(), shares: await f.shares() };
      provider.answer.mockClear();
      const replay = await f.tap(callback);
      expect.soft(replay).toEqual({ handled: false, reason: "replayed-telegram-group-offer" });
      expect.soft(await f.memberships()).toEqual(before.memberships);
      expect.soft(await f.shares()).toEqual(before.shares);
      expect.soft(provider.answer.mock.calls.map(([input]) => input.text)).toEqual([null]);
      expect(await f.receipts()).toHaveLength(rejoin ? 2 : 1);
      if (!rejoin) {
        expect((await f.tap(f.callback("join", "fresh"))).handled).toBe(true);
        expect(await f.memberships()).toHaveLength(1);
        expect(await f.shares()).toHaveLength(2);
        expect(await f.shares()).toEqual(expect.arrayContaining([
          expect.objectContaining({ projectionKind: "sleep-duration-days.v0" }),
        ]));
      }
    });
  });

  it("receipts disclosure no-ops, prevents regrant after revocation, and permits a new tap", async () => {
    await withFixture({ kind: "disclosure" }, async (f) => {
      expect((await f.tap(f.callback("disclosure", "t1"))).handled).toBe(true);
      const [grant] = await f.grants();
      const t2 = f.callback("disclosure", "t2");
      expect((await f.tap(t2)).handled).toBe(true);
      expect(await f.grants()).toEqual([grant]);
      await f.prisma.$transaction((tx) => revokeHostedGroupDisclosureGrantForMemberTx({
        grantId: grant.id, memberId: f.memberId, now: new Date(), tx,
      }), txOptions);
      expect(await f.grants()).toHaveLength(0);
      const replay = await f.tap(t2);
      expect.soft(replay).toEqual({ handled: false, reason: "replayed-telegram-group-offer" });
      expect.soft(await f.grants()).toHaveLength(0);
      expect(await f.receipts()).toHaveLength(2);
      expect((await f.tap(f.callback("disclosure", "t3"))).handled).toBe(true);
      expect(await f.grants()).toHaveLength(1);
      expect(await f.receipts()).toHaveLength(3);
    });
  });

  it("two Linq webhook deliveries past the outer marker cannot rejoin across leave", async () => {
    await withFixture({ channel: "linq" }, async (f) => {
      const firstBarrier = createSqlLockBarrier();
      const secondBarrier = createSqlLockBarrier();
      const firstClient = withPrismaTransactionSqlLockBarrier({ prisma: f.prisma, barrier: firstBarrier, matches: isHostedGroupRowLockQuery });
      const secondClient = withPrismaTransactionSqlLockBarrier({ prisma: f.contender, barrier: secondBarrier, matches: isHostedGroupRowLockQuery, before: true });
      const run = (prisma: PrismaClient) => handleHostedOnboardingLinqWebhook({
        rawBody: f.rawEvent, signature: "test", timestamp: null, prisma,
        scheduleAfterResponse: () => undefined,
      });
      const first = run(firstClient);
      let second: ReturnType<typeof run> | undefined;
      try {
        await Promise.race([firstBarrier.locked, first.then(() => { throw new Error("First handler did not reach the group lock."); })]);
        second = run(secondClient);
        await Promise.race([secondBarrier.locked, second.then(() => { throw new Error("Second handler did not pass the outer marker."); })]);
        firstBarrier.release();
        expect(await first).toMatchObject({ reason: "accepted-linq-group-join-offer-reaction" });
        expect(await f.memberships()).toHaveLength(1);
        expect(await f.shares()).toHaveLength(2);
        expect(await f.shares()).toEqual(expect.arrayContaining([
          expect.objectContaining({ projectionKind: "sleep-duration-days.v0" }),
        ]));
        await f.leave();
        const mailboxBefore = await f.mailbox();
        secondBarrier.release();
        // Both decisions must be terminal at the webhook, never staged group runtime work.
        expect(await second).toMatchObject({ reason: "accepted-linq-group-join-offer-reaction" });
        expect.soft(await f.memberships()).toHaveLength(0);
        expect.soft(await f.shares()).toHaveLength(0);
        expect.soft(await f.mailbox()).toEqual(mailboxBefore);
        expect(await f.receipts()).toHaveLength(1);
        expect(await f.marker()).not.toBeNull();
      } finally {
        firstBarrier.release();
        secondBarrier.release();
        await Promise.allSettled([first, ...(second ? [second] : [])]);
      }
    });
  });

  it.each(["join", "disclosure"] as const)("%s rollback leaves the gesture unseen", async (kind) => {
    await withFixture({ kind }, async (f) => {
      const onAcceptedTx = vi.fn();
      const result = await acceptHostedGroupOfferAffirmation({
        ...f.affirmation(kind), onAcceptedTx,
        assertActorStillBound: async () => {
          throw hostedOnboardingError({
            code: "HOSTED_GROUP_RUNTIME_UNSUPPORTED", httpStatus: 409, retryable: false,
            message: "Synthetic identity change.",
          });
        },
      });
      expect(result).toEqual({ status: "ignored", reason: "no_offer_match" });
      expect(onAcceptedTx).not.toHaveBeenCalled();
      expect(await f.shares()).toHaveLength(0);
      expect(await f.grants()).toHaveLength(0);
      expect(await f.memberships()).toHaveLength(kind === "disclosure" ? 1 : 0);
      expect(await f.receipts()).toHaveLength(0);
      expect(await acceptHostedGroupOfferAffirmation(f.affirmation(kind))).toEqual({ status: "accepted", kind });
      expect(await f.receipts()).toHaveLength(1);
      const assertActorStillBound = vi.fn();
      const deferPostCommit = vi.fn();
      expect(await acceptHostedGroupOfferAffirmation({
        ...f.affirmation(kind), assertActorStillBound, onAcceptedTx, deferPostCommit,
      })).toEqual({ status: "replayed" });
      expect(assertActorStillBound).not.toHaveBeenCalled();
      expect(onAcceptedTx).not.toHaveBeenCalled();
      expect(deferPostCommit).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["join", "phone"], ["join", "email"], ["disclosure", "phone"], ["disclosure", "email"],
  ] as const)("Linq %s rejects a %s unlinked after actor resolution", async (kind, handle) => {
    await withFixture({ channel: "linq", kind, handle }, async (f) => {
      await f.ingest();
      const barrier = createSqlLockBarrier();
      const prisma = withPrismaTransactionSqlLockBarrier({ prisma: f.prisma, barrier, matches: isHostedGroupRowLockQuery });
      const run = handleHostedGroupJoinOfferReaction({ event: f.event, prisma });
      try {
        await Promise.race([barrier.locked, run.then(() => { throw new Error("Handler did not reach the group lock."); })]);
        await f.unlink();
        barrier.release();
        expect.soft(await run).toEqual({ status: "ignored", reason: "no_offer_match" });
        expect.soft(await f.memberships()).toHaveLength(kind === "disclosure" ? 1 : 0);
        expect.soft(await f.shares()).toHaveLength(0);
        expect.soft(await f.grants()).toHaveLength(0);
        expect.soft(await f.marker()).toBeNull();
        expect.soft(await f.mailbox()).toEqual([]);
        expect(await f.receipts()).toHaveLength(0);
      } finally {
        barrier.release();
        await Promise.allSettled([run]);
      }
    });
  });

  it.each([
    ["join", "phone"], ["join", "email"], ["disclosure", "phone"], ["disclosure", "email"],
  ] as const)("Linq %s accepts a bound %s and a later unlink preserves the grant", async (kind, handle) => {
    await withFixture({ channel: "linq", kind, handle }, async (f) => {
      await f.ingest();
      expect(await handleHostedGroupJoinOfferReaction({ event: f.event, prisma: f.prisma })).toEqual({ status: "accepted", reason: "accepted" });
      const memberships = await f.memberships();
      const shares = await f.shares();
      const grants = await f.grants();
      expect(memberships).toHaveLength(1);
      expect(kind === "join" ? shares : grants).toHaveLength(kind === "join" ? 2 : 1);
      await f.unlink();
      expect(await f.memberships()).toEqual(memberships);
      expect(await f.shares()).toEqual(shares);
      expect(await f.grants()).toEqual(grants);
      expect(await f.marker()).not.toBeNull();
      expect(await f.mailbox()).not.toEqual([]);
      expect(await f.receipts()).toHaveLength(1);
    });
  });

  it.each(["not_group_member", "not_found", "wrong_thread", "revoked_offer", "missing_consent"] as const)("%s does not spend the gesture", async (outcome) => {
    const kind = ["not_group_member", "not_found", "wrong_thread"].includes(outcome) ? "disclosure" : "join";
    await withFixture({ kind }, async (f) => {
      const input = f.affirmation(kind);
      if (outcome === "not_group_member") await f.leave();
      if (outcome === "not_found") input.messageLookupKeyReadCandidates = ["missing"];
      if (outcome === "wrong_thread") input.threadIdentityLookupKeyReadCandidates = ["wrong"];
      if (outcome === "revoked_offer") await f.prisma.hostedGroupJoinOffer.updateMany({ where: { groupId: f.groupId }, data: { revokedAt: new Date() } });
      if (outcome === "missing_consent") await f.prisma.hostedConsentGrant.deleteMany({ where: { memberId: f.memberId } });
      expect(await acceptHostedGroupOfferAffirmation(input)).toMatchObject({ status: "ignored" });
      expect(await f.shares()).toHaveLength(0);
      expect(await f.grants()).toHaveLength(0);
      expect(await f.receipts()).toHaveLength(0);
    });
  });

  it("keeps a legacy disclosure gesture from granting a different current member", async () => {
    await withFixture({ kind: "disclosure" }, async (f) => {
      const callback = f.callback("disclosure", "legacy");
      expect((await f.tap(callback)).handled).toBe(true);
      const grants = await f.grants();
      // Model a grant written before gesture receipts existed.
      await f.prisma.hostedGroupOfferGestureReceipt.deleteMany({ where: { groupId: f.groupId } });
      await f.prisma.$transaction(async (tx) => {
        await removeHostedMemberLinkedAccountProjectionTx({
          expectedIdentity: String(callback.from.id), memberId: f.memberId,
          method: "telegram", prisma: tx,
        });
        await upsertHostedMemberTelegramRoutingBindingTx({
          memberId: f.ownerMemberId, telegramUserId: String(callback.from.id), prisma: tx,
        });
        await tx.hostedGroupMember.create({ data: {
          id: `legacy_relinked_${randomUUID()}`, groupId: f.groupId,
          memberId: f.ownerMemberId, joinedAt: postedAt,
        } });
      }, txOptions);
      expect(await f.tap(callback)).toMatchObject({ handled: false, reason: "skipped-telegram-group-offer:no_offer_match" });
      expect(await f.grants()).toEqual(grants);
      expect(await f.prisma.hostedGroupDisclosureGrant.count({ where: {
        membership: { memberId: f.ownerMemberId, groupId: f.groupId },
      } })).toBe(0);
      // The legacy grant already spent this gesture, so a receipt is accurate.
      expect(await f.receipts()).toHaveLength(1);
      expect(await f.tap(callback)).toEqual({ handled: false, reason: "replayed-telegram-group-offer" });
    });
  });

  it("retains receipts after tapper deletion and cascades them with the group", async () => {
    await withFixture({}, async (f) => {
      expect((await f.tap(f.callback("join", "delete"))).handled).toBe(true);
      await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
      expect(await f.receipts()).toHaveLength(1);
      await f.prisma.hostedGroup.delete({ where: { id: f.groupId } });
      expect(await f.receipts()).toHaveLength(0);
    });
  });
});

async function createFixture(input: { channel?: "linq" | "telegram"; kind?: OfferKind; handle?: HandleKind }) {
  const channel = input.channel ?? "telegram";
  const kind = input.kind ?? "join";
  const handleKind = input.handle ?? "phone";
  const suffix = randomUUID();
  const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
  const contender = createPrismaClient({ databaseUrl, poolMax: 2 });
  const memberId = `gesture_member_${suffix}`;
  const ownerMemberId = `gesture_owner_${suffix}`;
  const runtimeMemberId = `gesture_runtime_${suffix}`;
  const groupId = `gesture_group_${suffix}`;
  const joinCode = `gesture_join_${suffix}`;
  const telegramUserId = String(randomInt(1_000_000, 9_000_000));
  const message = {
    chat: { id: -randomInt(1_000_000_000, 2_000_000_000), type: "supergroup" },
    message_id: randomInt(1_000_000, 9_000_000),
  } as const;
  const chatId = channel === "telegram" ? String(message.chat.id) : `gesture_chat_${suffix}`;
  const threadId = channel === "telegram" ? buildTelegramThreadId(message) : chatId;
  const messageId = channel === "telegram" ? String(message.message_id) : `gesture_message_${suffix}`;
  const binding = channel === "telegram" ? { channel, chatId, messageId } : { channel, messageId };
  const messageLookupKey = createHostedGroupOfferMessageLookupKey(binding)!;
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({ channel, threadId })!;
  const handle = handleKind === "email" ? `gesture-${suffix}@example.test` : `+1202${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  await prisma.hostedMember.createMany({
    data: [memberId, ownerMemberId, runtimeMemberId].map((id) => ({
      id, billingStatus: HostedBillingStatus.active,
    })),
  });
  await prisma.hostedThreadContainer.create({ data: { memberId: runtimeMemberId, ownerMemberId } });
  await prisma.hostedGroup.create({ data: {
    id: groupId, displayName: "Gesture proof", ownerMemberId, runtimeMemberId,
    joinCode, joinCodeCreatedAt: postedAt,
  } });
  await prisma.hostedThreadRoute.create({ data: {
    channel, containerMemberId: runtimeMemberId, pendingParticipantAddition: false,
    threadIdentityLookupKey, threadLookupKey: `gesture_thread_${suffix}`,
  } });
  await prisma.hostedConsentGrant.createMany({
    data: ["launch.legal", "launch.health-data"].map((scope) => ({
      memberId, scope, source: "test", status: "granted", documentVersionsJson: {}, grantedAt: postedAt,
    })),
  });
  await prisma.$transaction(async (tx) => {
    if (channel === "telegram") {
      await upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId, prisma: tx });
    } else if (handleKind === "email") {
      await upsertHostedMemberEmailAuthorization({ memberId, prisma: tx, verifiedEmail: { address: handle, verifiedAt: postedAt } });
    } else {
      await tx.hostedMemberIdentity.create({ data: {
        ...await buildHostedMemberIdentityPrivateColumns({ memberId, phoneNumber: handle, prisma: tx,
          signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null }),
        memberId, phoneLookupKey: createHostedPhoneLookupKey(handle), phoneNumberVerifiedAt: postedAt,
      } });
    }
    if (kind === "disclosure") {
      await tx.hostedGroupMember.create({ data: { id: `gesture_membership_${suffix}`, groupId, memberId, joinedAt: postedAt } });
      await recordHostedGroupDisclosurePermissionTx({
        groupId, message: binding, originAssistantInputId: `gesture_input_${suffix}`,
        permissionText: "Share the selected synthetic note with this group.", postedAt, tx,
      });
    } else {
      await tx.hostedGroupJoinOffer.create({ data: {
        id: `gesture_offer_${suffix}`, groupId, messageLookupKey, postedAt,
        projectionKindsJson: ["sleep-duration-days.v0"],
      } });
    }
  }, txOptions);
  const eventId = `gesture_event_${suffix}`;
  const rawEvent = JSON.stringify({
    api_version: "v3", created_at: new Date().toISOString(),
    data: { chat_id: chatId, from_handle: { handle, service: "iMessage" }, is_from_me: false,
      message_id: messageId, reacted_at: new Date().toISOString(), reaction_type: kind === "disclosure" ? "like" : "love" },
    event_id: eventId, event_type: "reaction.added", trace_id: `trace_${suffix}`, webhook_version: "2026-02-03",
  });
  const event = parseHostedLinqProviderEvent({ event: JSON.parse(rawEvent) });
  if (!event) throw new Error("Expected synthetic Linq reaction.");
  const eventLookupKey = createHostedLinqProviderEventLookupKey(eventId);
  const callback = (offerKind: OfferKind, tapId: string) => ({
    data: offerKind === "join" ? HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA : HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA,
    from: { id: Number(telegramUserId), is_bot: false }, id: `${suffix}_${tapId}`, message,
  });
  const affirmation = (offerKind: OfferKind): Parameters<typeof acceptHostedGroupOfferAffirmation>[0] => ({
    affirmationEventId: eventId, channel, kinds: [offerKind], memberId, now: new Date(), prisma,
    deferPostCommit: () => undefined,
    messageLookupKeyReadCandidates: createHostedGroupOfferMessageLookupKeyReadCandidates(binding),
    threadIdentityLookupKeyReadCandidates: createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel, threadId }),
  });
  return {
    prisma, contender, memberId, ownerMemberId, runtimeMemberId, groupId, event, eventLookupKey, rawEvent, callback, affirmation,
    tap: (callbackQuery: ReturnType<typeof callback>) => handleHostedTelegramGroupOfferCallback({ callbackQuery, prisma, scheduleAfterResponse: () => undefined }),
    leave: () => prisma.$transaction((tx) => leaveHostedGroupMemberTx({ memberId, joinCode, now: new Date(), tx }), txOptions),
    unlink: () => contender.$transaction((tx) => removeHostedMemberLinkedAccountProjectionTx({ expectedIdentity: handle, memberId, method: handleKind, prisma: tx }), txOptions),
    ingest: () => prisma.$transaction((tx) => ingestHostedLinqProviderEventTx({ event, prisma: tx }), txOptions),
    memberships: () => prisma.hostedGroupMember.findMany({ where: { memberId, groupId } }),
    shares: () => prisma.hostedVaultShare.findMany({ where: { grantorMemberId: memberId, destinationMemberId: runtimeMemberId, status: "granted", revokedAt: null } }),
    grants: () => prisma.hostedGroupDisclosureGrant.findMany({ where: { membership: { memberId, groupId }, revokedAt: null } }),
    receipts: () => prisma.$queryRaw<Array<{ id: string; group_id: string }>>`
      SELECT id, group_id FROM hosted_group_offer_gesture_receipt
      WHERE group_id = ${groupId} ORDER BY id
    `,
    mailbox: () => prisma.hostedMailboxItem.findMany({ where: { userId: runtimeMemberId }, select: { id: true, dedupeKey: true }, orderBy: { id: "asc" } }),
    marker: async () => (await prisma.hostedLinqProviderEvent.findUniqueOrThrow({ where: { eventId: eventLookupKey }, select: { groupJoinOfferHandledAt: true } })).groupJoinOfferHandledAt,
  };
}

async function withFixture(input: Parameters<typeof createFixture>[0], run: (f: Fixture) => Promise<void>) {
  const f = await createFixture(input);
  try {
    await run(f);
  } finally {
    await f.prisma.hostedLinqProviderEvent.deleteMany({ where: { eventId: f.eventLookupKey } });
    await f.prisma.hostedGroup.deleteMany({ where: { id: f.groupId } });
    await f.prisma.hostedThreadContainer.deleteMany({ where: { memberId: f.runtimeMemberId } });
    await f.prisma.hostedMember.deleteMany({ where: { id: { in: [f.memberId, f.ownerMemberId, f.runtimeMemberId] } } });
    await Promise.all([f.prisma.$disconnect(), f.contender.$disconnect()]);
  }
}

type SqlLockBarrier = {
  locked: Promise<void>;
  release: () => void;
  reportLocked: () => void;
  waitUntilReleased: Promise<void>;
};

function createSqlLockBarrier(expectedLockCount = 1): SqlLockBarrier {
  let reportLocked = (): void => undefined;
  let release = (): void => undefined;
  let reportedLockCount = 0;
  const locked = new Promise<void>((resolve) => {
    reportLocked = () => {
      reportedLockCount += 1;
      if (reportedLockCount >= expectedLockCount) {
        resolve();
      }
    };
  });
  const waitUntilReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    locked,
    release,
    reportLocked,
    waitUntilReleased,
  };
}

function withSqlLockBarrierTx(input: {
  barrier: SqlLockBarrier;
  matches: (sql: string) => boolean;
  before?: boolean;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  let paused = false;
  return new Proxy(input.tx, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "$queryRaw" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const sql = readTaggedSql(args[0]);
        const result = input.before ? undefined : await Reflect.apply(value, target, args);
        if (!paused && input.matches(sql)) {
          paused = true;
          input.barrier.reportLocked();
          await input.barrier.waitUntilReleased;
        }
        return input.before ? Reflect.apply(value, target, args) : result;
      };
    },
  });
}

function withPrismaTransactionSqlLockBarrier(input: {
  barrier: SqlLockBarrier;
  matches: (sql: string) => boolean;
  before?: boolean;
  prisma: PrismaClient;
}): PrismaClient {
  return new Proxy(input.prisma, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "$transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        const [transactionInput, ...rest] = args;
        if (typeof transactionInput !== "function") {
          return Reflect.apply(value, target, args);
        }
        const callback = transactionInput as (
          tx: Prisma.TransactionClient,
        ) => unknown;
        return Reflect.apply(value, target, [
          (tx: Prisma.TransactionClient) => callback(withSqlLockBarrierTx({
            barrier: input.barrier,
            matches: input.matches,
            before: input.before,
            tx,
          })),
          ...rest,
        ]);
      };
    },
  });
}

function isHostedGroupRowLockQuery(sql: string): boolean {
  const normalized = sql.toLowerCase();
  return normalized.includes('from "hosted_group"')
    && normalized.includes("for update");
}

function readTaggedSql(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.filter((part): part is string => typeof part === "string").join(" ");
}
