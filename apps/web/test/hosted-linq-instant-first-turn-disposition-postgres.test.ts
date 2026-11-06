import { createHash, randomUUID } from "node:crypto";
import type { Response as OpenAiResponse } from "openai/resources/responses/responses";
import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { sealHostedUserSecureBoxString } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  hasConflictingHostedLinqInstantFirstTurnForChatTx,
  hasUnresolvedHostedLinqProviderDispatchForChatTx,
  HOSTED_LINQ_INSTANT_FIRST_TURN_REJECTED_FAILURE_CODE,
  markHostedLinqDeliverySendFailedTx,
  recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx,
  resolveHostedLinqInstantFirstTurnRuntimeEgressDispositionTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  abandonHostedLinqInstantFirstTurn,
  claimHostedLinqInstantFirstTurn,
  completeHostedLinqInstantFirstTurn,
  type HostedLinqInstantFirstTurnGeneration,
} from "@/src/lib/hosted-onboarding/linq-instant-first-turn";
import { buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import { createPrismaClient } from "@/src/lib/prisma";

const provider = vi.hoisted(() => ({ send: vi.fn<typeof import("@/src/lib/hosted-onboarding/linq-client").sendHostedLinqChatMessage>() }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  sendHostedLinqChatMessage: provider.send,
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("First-turn proof requires an explicitly selected local test database.");
  }
}
const retry = { code: "HOSTED_LINQ_INSTANT_FIRST_TURN_RETRY", retryable: true };
const rejected = () => hostedOnboardingError({ code: "SYNTHETIC_REJECTION", details: { failureStage: "http", status: 403 }, httpStatus: 403, message: "Synthetic rejection", retryable: false });

async function withFixture(run: (f: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const f = await seed();
  try { await run(f); } finally {
    vi.useRealTimers();
    await f.prisma.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: f.chatKey } });
    await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    await f.prisma.$disconnect();
  }
}
async function seed() {
  provider.send.mockReset();
  const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
  const nonce = randomUUID();
  const memberId = `first-turn-member-${nonce}`;
  const chatId = `first-turn-chat-${nonce}`;
  const eventId = `first-turn-event-${nonce}`;
  const phone = "+15550000001";
  const chatKey = createHostedLinqChatLookupKey(chatId)!;
  const idempotencyKey = `linq-instant-first-turn-v1-${createHash("sha256").update(eventId).digest("hex").slice(0, 32)}`;
  await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  await prisma.hostedMemberRouting.create({ data: { memberId,
    ...await buildHostedMemberRoutingPrivateColumns({ memberId, linqChatId: chatId,
      linqRecipientPhone: phone, pendingLinqChatId: null, pendingLinqRecipientPhone: null,
      telegramThreadId: null, telegramUserId: null, prisma }),
  } });
  const request = { eventId, participantContactKind: "phone" as const, partTypes: ["text"], service: "imessage" as const, text: "How can I build a walking habit?", textWasTruncated: false };
  const claimInput = { linqChatId: chatId, prisma, request };
  const abandon = (expectedAttemptedAt: Date | null) => abandonHostedLinqInstantFirstTurn({
    expectedAttemptedAt, eventId, linqChatId: chatId, prisma, reason: "synthetic-fallback",
  });
  const read = () => prisma.hostedLinqDelivery.findFirstOrThrow({ where: { linqChatLookupKey: chatKey } });
  const egress = () => resolveHostedLinqInstantFirstTurnRuntimeEgressDispositionTx({ eventId, linqChatId: chatId, prisma });
  const message = "Start with a short walk after breakfast.";
  const completeInput = { prisma, inboundMessageId: `inbound-${nonce}`,
    participantContact: { kind: "phone" as const, lookupKey: createHostedPhoneLookupKey(phone)!, value: phone },
    recipientPhoneNumber: phone, service: "iMessage", wakeHandoff: {
      eventId, linqChatId: chatId, mailboxItemId: `inbound-${nonce}`, source: "linq" as const,
      userId: memberId, wakeMailboxCheckpoint: { lane: "conversation" as const, laneSeq: "1" },
    },
  };
  const reply = (attemptedAt: Date): HostedLinqInstantFirstTurnGeneration => ({
    kind: "reply", attemptedAt, message, usage: { requestedModel: "synthetic-model", response: {
      id: `synthetic-response-${nonce}`, model: "synthetic-model", object: "response",
      created_at: 0, output_text: message, output: [], error: null,
      incomplete_details: null, instructions: null, metadata: null,
      parallel_tool_calls: false, temperature: null, tool_choice: "none", tools: [], top_p: null,
    } satisfies OpenAiResponse },
  });
  const sealed = async (data: Prisma.HostedLinqDeliveryUncheckedUpdateInput = {}) => {
    const claim = await claimHostedLinqDeliveryProviderDispatchTx({ idempotencyKey, linqChatId: chatId, prisma,
      source: "hosted_web_instant_first_turn", sourceRef: eventId, status: "attempted", targetKind: "thread", template: "instant_first_turn_v1" });
    if (!claim.id) throw new Error("Synthetic claim must create a row.");
    const payloadCiphertext = await sealHostedUserSecureBoxString({ aad: { field: "payload_ciphertext", purpose: "hosted-linq-delivery-payload", rowId: idempotencyKey, table: "hosted_linq_delivery" }, lane: "hosted-member-private-field", scope: "hosted-linq-delivery-payload:instant-first-turn", userId: memberId, value: message, prisma });
    await prisma.hostedLinqDelivery.update({ where: { id: claim.id }, data: { status: "failed", failedAt: new Date(), payloadCiphertext, payloadOwnerMemberId: memberId, payloadSchema: "murph.hosted-linq-delivery-payload.instant-first-turn.v1", ...data } });
  };
  provider.send.mockResolvedValue({ chatId, messageId: `outbound-${nonce}` });
  return { prisma, memberId, chatId, chatKey, eventId, idempotencyKey, claimInput, abandon, read, egress, sealed, message, completeInput, reply };
}

describe.skipIf(!enabled)("first-turn disposition with PostgreSQL", () => {
  it("B1: a losing request cannot abandon another request's sealed resume", async () => withFixture(async (f) => {
    await f.sealed();
    const a = await claimHostedLinqInstantFirstTurn(f.claimInput);
    expect(a.kind).toBe("resume");
    await expect(claimHostedLinqInstantFirstTurn(f.claimInput)).rejects.toMatchObject(retry);
    const before = await f.read();
    await expect(f.abandon(null)).rejects.toMatchObject(retry);
    expect(await f.read()).toEqual(before);
    expect(await f.egress()).toBe("defer");
    if (a.kind !== "resume") throw new Error("Expected resume");
    expect(await completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: a })).toMatchObject({ kind: "accepted" });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ message: f.message, idempotencyKey: f.idempotencyKey }));
    expect((await f.read()).skippedAt).toBeNull();
    expect(await f.egress()).toBe("already_answered");
  }));

  it("N5: a resumed rejection preserves the earlier ambiguous obligation", async () => withFixture(async (f) => {
    const initial = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (initial.kind !== "generate") throw new Error("Expected generation");
    provider.send.mockRejectedValueOnce(new Error("Synthetic response lost"));
    await expect(completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: f.reply(initial.attemptedAt) })).rejects.toMatchObject(retry);
    const before = await f.read();
    expect(before).toMatchObject({ status: "failed", acceptedAt: null });
    expect(before.payloadCiphertext).not.toBeNull();
    const a = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (a.kind !== "resume") throw new Error("Expected resume");
    provider.send.mockRejectedValueOnce(rejected());
    await expect(completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: a })).rejects.toMatchObject(retry);
    expect((await f.read()).payloadCiphertext).toBe(before.payloadCiphertext);
    expect(await f.egress()).toBe("defer");
    const next = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (next.kind !== "resume") throw new Error("Expected resume");
    await expect(completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: next })).resolves.toMatchObject({ kind: "accepted" });
    expect(await f.read()).toMatchObject({ status: "accepted", payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null });
    expect(provider.send).toHaveBeenCalledTimes(3);
    for (const [call] of provider.send.mock.calls) expect(call).toMatchObject({ idempotencyKey: f.idempotencyKey, message: f.message });
    expect(await f.egress()).toBe("already_answered");
  }));


  it.each([
    { label: "absent", status: null, egress: "available", conflict: false, unresolved: false, claim: "generate" },
    { label: "reserved", status: "attempted", egress: "defer", conflict: true, unresolved: true, claim: "generate" },
    ...["attempted", "provider_dispatch_started", "failed"].map(status => ({ label: `sealed ${status}`, status, sealed: true, egress: "defer", conflict: true, unresolved: true, claim: "resume" })),
    ...["accepted", "delivered"].map(status => ({ label: status, status, egress: "already_answered", conflict: false, unresolved: false, claim: "completed" })),
    ...["acceptedAt", "deliveredAt", "lastReceiptAt", "messageLookupKey"].map(correlation => ({ label: `correlated failed ${correlation}`, status: "failed", correlation, sealed: true, egress: "already_answered", conflict: false, unresolved: false, claim: "completed" })),
    { label: "skipped empty", status: "skipped", egress: "available", conflict: false, unresolved: false, claim: "unavailable" },
    { label: "certified failed empty", status: "failed", certified: true, egress: "available", conflict: false, unresolved: false, claim: "unavailable" },
    { label: "skipped sealed", status: "skipped", sealed: true, egress: "defer", conflict: false, unresolved: false, claim: "retry" },
    { label: "uncertified failed empty", status: "failed", egress: "defer", conflict: false, unresolved: false, claim: "retry" },
    { label: "partial tuple", status: "attempted", partial: true, egress: "defer", conflict: true, unresolved: true, claim: "retry" },
    { label: "started empty", status: "provider_dispatch_started", egress: "defer", conflict: false, unresolved: true, claim: "retry" },
    { label: "unknown", status: "unknown", egress: "defer", conflict: false, unresolved: false, claim: "retry" },
  ])("reads and claims $label consistently", async (row) => withFixture(async (f) => {
    if (row.status) {
      await f.sealed();
      const current = await f.read();
      const old = new Date(Date.now() - 1_200_000);
      const data: Prisma.HostedLinqDeliveryUncheckedUpdateInput = {
        status: row.status, attemptedAt: old, failedAt: row.status === "failed" ? old : null,
        skippedAt: row.status === "skipped" ? old : null,
        failureCode: "certified" in row ? HOSTED_LINQ_INSTANT_FIRST_TURN_REJECTED_FAILURE_CODE : null,
        ...("sealed" in row ? {} : { payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null }),
        ...("partial" in row ? { payloadOwnerMemberId: f.memberId } : {}),
      };
      if ("correlation" in row) {
        if (row.correlation === "messageLookupKey") data.messageLookupKey = "synthetic-correlation";
        else if (row.correlation === "acceptedAt") data.acceptedAt = old;
        else if (row.correlation === "deliveredAt") data.deliveredAt = old;
        else data.lastReceiptAt = old;
      }
      await f.prisma.hostedLinqDelivery.update({ where: { id: current.id }, data });
    } else {
      await f.abandon(null);
      expect(await dispatch(f, new Date())).toEqual({ claimed: false, id: null });
      expect(await f.prisma.hostedLinqDelivery.count({ where: { linqChatLookupKey: f.chatKey } })).toBe(0);
    }
    expect(await f.egress()).toBe(row.egress);
    expect(await hasConflictingHostedLinqInstantFirstTurnForChatTx({ eventId: `another-${f.eventId}`, linqChatId: f.chatId, prisma: f.prisma })).toBe(row.conflict);
    expect(await hasUnresolvedHostedLinqProviderDispatchForChatTx({ linqChatId: f.chatId, prisma: f.prisma })).toBe(row.unresolved);
    if (row.claim === "retry") await expect(claimHostedLinqInstantFirstTurn(f.claimInput)).rejects.toMatchObject(retry);
    else expect((await claimHostedLinqInstantFirstTurn(f.claimInput)).kind).toBe(row.claim);
    expect(provider.send).not.toHaveBeenCalled();
  }));

  it("abandons only an owned or stale empty reservation", async () => withFixture(async (f) => {
    const claim = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (claim.kind !== "generate") throw new Error("Expected generation");
    const before = await f.read();
    await expect(f.abandon(null)).rejects.toMatchObject(retry);
    expect(await f.read()).toEqual(before);
    await f.abandon(claim.attemptedAt);
    expect(await f.read()).toMatchObject({ status: "skipped", payloadCiphertext: null });
    expect(await f.egress()).toBe("available");
    expect((await claimHostedLinqInstantFirstTurn(f.claimInput)).kind).toBe("unavailable");
    await f.prisma.hostedLinqDelivery.update({ where: { id: before.id }, data: { status: "attempted", skippedAt: null, attemptedAt: new Date(Date.now() - 1_200_000) } });
    await f.abandon(null);
    const skipped = await f.read();
    expect(skipped.status).toBe("skipped");
    expect(skipped.attemptedAt).toEqual(skipped.skippedAt);
  }));

  it("certifies only an initial definitive rejection", async () => withFixture(async (f) => {
    const claim = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (claim.kind !== "generate") throw new Error("Expected generation");
    provider.send.mockRejectedValueOnce(rejected());
    await expect(completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: f.reply(claim.attemptedAt) })).resolves.toEqual({ kind: "fallback" });
    expect(await f.read()).toMatchObject({ status: "failed", payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null, failureCode: HOSTED_LINQ_INSTANT_FIRST_TURN_REJECTED_FAILURE_CODE });
    expect(HOSTED_LINQ_INSTANT_FIRST_TURN_REJECTED_FAILURE_CODE.length).toBeLessThanOrEqual(128);
    expect(await f.egress()).toBe("available");
  }));

  it.each(["rejection", "ambiguous", "positive"])("late %s cannot overwrite a newer attempt's negative evidence", async (outcome) => withFixture(async (f) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (a.kind !== "generate") throw new Error("Expected generation");
    const entered = deferred();
    const finish = deferred();
    provider.send.mockImplementationOnce(async () => {
      entered.resolve(); await finish.promise;
      if (outcome === "rejection") throw rejected();
      if (outcome === "ambiguous") throw new Error("Synthetic timeout");
      return { chatId: f.chatId, messageId: `late-positive-${f.eventId}` };
    });
    const pending = completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: f.reply(a.attemptedAt) });
    const settled = pending.then(value => ({ value }), error => ({ error }));
    try {
      await Promise.race([entered.promise, pending]);
      vi.setSystemTime(new Date(Date.now() + 1_200_000));
      const b = await claimHostedLinqInstantFirstTurn(f.claimInput);
      if (b.kind !== "resume") throw new Error("Expected resume");
      const dispatched = await dispatch(f, b.attemptedAt);
      expect(dispatched.claimed).toBe(true);
      const before = await f.read();
      finish.resolve();
      const result = await settled;
      if (outcome === "positive") {
        expect(result).toMatchObject({ value: { kind: "accepted" } });
        expect(await f.egress()).toBe("already_answered");
      } else {
        expect(result).toMatchObject({ error: retry });
        expect(await f.read()).toEqual(before);
      }
    } finally { finish.resolve(); await settled; }
  }));

  it("advances attempt versions within one millisecond and rejects an old negative", async () => withFixture(async (f) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await f.sealed();
    const a = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (a.kind !== "resume") throw new Error("Expected resume");
    const first = await dispatch(f, a.attemptedAt);
    expect(first.attemptedAt!.getTime()).toBeGreaterThan(a.attemptedAt.getTime());
    await markHostedLinqDeliverySendFailedTx({ expectedAttemptedAt: first.attemptedAt!, idempotencyKey: f.idempotencyKey, prisma: f.prisma, failureCode: "synthetic-timeout" });
    const b = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (b.kind !== "resume") throw new Error("Expected resume");
    expect(b.attemptedAt.getTime()).toBeGreaterThan(first.attemptedAt!.getTime());
    const second = await dispatch(f, b.attemptedAt);
    expect(second.attemptedAt!.getTime()).toBeGreaterThan(b.attemptedAt.getTime());
    const before = await f.read();
    expect(await recordHostedLinqInstantFirstTurnFirstDispatchRejectionTx({ expectedAttemptedAt: first.attemptedAt!, idempotencyKey: f.idempotencyKey, prisma: f.prisma })).toBe(false);
    await markHostedLinqDeliverySendFailedTx({ expectedAttemptedAt: first.attemptedAt!, idempotencyKey: f.idempotencyKey, prisma: f.prisma, failureCode: "old-negative" });
    expect(await f.read()).toEqual(before);
  }));

  it("stale reservation takeover rejects the old owner's dispatch and abandonment", async () => withFixture(async (f) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await claimHostedLinqInstantFirstTurn(f.claimInput);
    if (a.kind !== "generate") throw new Error("Expected generation");
    vi.setSystemTime(new Date(Date.now() + 1_200_000));
    const b = await claimHostedLinqInstantFirstTurn(f.claimInput);
    expect(b.kind).toBe("generate");
    const before = await f.read();
    await expect(completeHostedLinqInstantFirstTurn({ ...f.completeInput, generation: f.reply(a.attemptedAt) })).rejects.toMatchObject(retry);
    await expect(f.abandon(a.attemptedAt)).rejects.toMatchObject(retry);
    expect(await f.read()).toEqual(before);
    expect(provider.send).not.toHaveBeenCalled();
  }));

  it.each(["skipped-sealed", "failed-empty"])("holds legacy %s only for its exact event", async (kind) => withFixture(async (f) => {
    await f.sealed(kind === "skipped-sealed"
      ? { status: "skipped", skippedAt: new Date(), failedAt: null }
      : { payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null });
    const before = await f.read();
    await expect(claimHostedLinqInstantFirstTurn(f.claimInput)).rejects.toMatchObject(retry);
    await expect(f.abandon(null)).rejects.toMatchObject(retry);
    expect(await f.read()).toEqual(before);
    expect(await f.egress()).toBe("defer");
    expect(provider.send).not.toHaveBeenCalled();
    const next = await claimHostedLinqInstantFirstTurn({ ...f.claimInput, request: { ...f.claimInput.request, eventId: `next-${f.eventId}` } });
    expect(next.kind).toBe("generate");
  }));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function dispatch(f: Awaited<ReturnType<typeof seed>>, expectedAttemptedAt: Date) {
  return claimHostedLinqDeliveryProviderDispatchTx({ expectedAttemptedAt, idempotencyKey: f.idempotencyKey,
    linqChatId: f.chatId, prisma: f.prisma, source: "hosted_web_instant_first_turn", sourceRef: f.eventId,
    status: "provider_dispatch_started", targetKind: "thread", template: "instant_first_turn_v1" });
}
