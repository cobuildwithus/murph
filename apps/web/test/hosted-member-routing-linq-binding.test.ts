import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import { upsertHostedMemberHomeLinqBindingTx } from "../src/lib/hosted-onboarding/hosted-member-routing-linq";

const mocks = vi.hoisted(() => ({ encrypt: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/member-private-codecs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/hosted-onboarding/member-private-codecs")>(),
  buildHostedMemberRoutingPrivateColumns: mocks.encrypt,
}));

const assignedAt = new Date("2026-08-01T00:00:00.000Z");
const participant = { kind: "phone" as const, lookupKey: "stored-participant" };
function createFixture() {
  const routing = {
    linqChatIdEncrypted: "sealed-chat",
    linqChatLookupKey: createHostedLinqChatLookupKey("synthetic-chat"),
    linqHomeLineAssignedAt: assignedAt,
    linqParticipantContactKind: participant.kind as string | null,
    linqParticipantContactLookupKey: participant.lookupKey as string | null,
    linqRecipientPhoneEncrypted: "sealed-recipient" as string | null,
    linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000000"),
    pendingLinqChatIdEncrypted: null as string | null,
    pendingLinqChatLookupKey: null as string | null,
    pendingLinqParticipantContactEncrypted: null as string | null,
    pendingLinqParticipantContactKind: null as string | null,
    pendingLinqParticipantContactLookupKey: null as string | null,
    pendingLinqParticipantContactObservedAt: null as Date | null,
    pendingLinqRecipientPhoneEncrypted: null as string | null,
    pendingLinqRecipientPhoneLookupKey: null as string | null,
  };
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    hostedMemberRouting: {
      findUnique: vi.fn().mockResolvedValue(routing),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue(routing),
    },
    hostedThreadRoute: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const bind = (overrides: Partial<Parameters<typeof upsertHostedMemberHomeLinqBindingTx>[0]> = {}) =>
    upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      homeLineAssignedAt: new Date(assignedAt),
      linqChatId: "synthetic-chat",
      memberId: "synthetic-member",
      participantContact: { kind: "email", lookupKey: "new-observed-participant" },
      prisma: prisma as never,
      recipientPhone: "+15550000000",
      ...overrides,
    });
  return { bind, prisma, routing };
}

beforeEach(() => {
  mocks.encrypt.mockReset().mockResolvedValue({
    linqChatIdEncrypted: "new-sealed-chat",
    linqRecipientPhoneEncrypted: "new-sealed-recipient",
  });
});

describe("established Linq home binding", () => {
  it("keeps the stored participant and ciphertext without rewriting an unchanged route", async () => {
    const { bind, prisma } = createFixture();
    await expect(bind()).resolves.toEqual(participant);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.findFirst).toHaveBeenCalledOnce();
    expect(prisma.hostedMemberRouting.findFirst).toHaveBeenCalledOnce();
    expect(prisma.hostedMemberRouting.updateMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["pending chat ciphertext", { pendingLinqChatIdEncrypted: "stale-ciphertext" }],
    ["pending chat lookup", { pendingLinqChatLookupKey: "stale-lookup" }],
    ["pending participant ciphertext", { pendingLinqParticipantContactEncrypted: "stale-ciphertext" }],
    ["pending participant kind", { pendingLinqParticipantContactKind: "phone" }],
    ["pending participant lookup", { pendingLinqParticipantContactLookupKey: "stale-lookup" }],
    ["pending observation", { pendingLinqParticipantContactObservedAt: assignedAt }],
    ["pending recipient ciphertext", { pendingLinqRecipientPhoneEncrypted: "stale-ciphertext" }],
    ["pending recipient lookup", { pendingLinqRecipientPhoneLookupKey: "stale-lookup" }],
    ["retained chat lookup version", { linqChatLookupKey: "retained-chat-key" }],
    ["retained recipient lookup version", { linqRecipientPhoneLookupKey: "retained-phone-key" }],
    ["missing ciphertext", { linqChatIdEncrypted: "" }],
    ["missing participant", { linqParticipantContactKind: null, linqParticipantContactLookupKey: null }],
  ])("still writes for %s", async (_name, change) => {
    const { bind, prisma, routing } = createFixture();
    Object.assign(routing, change);
    await bind();
    expect(mocks.encrypt).toHaveBeenCalledOnce();
    expect(prisma.hostedMemberRouting.upsert).toHaveBeenCalledOnce();
  });

  it("preserves pending fields when clearing was not requested", async () => {
    const { bind, prisma, routing } = createFixture();
    routing.pendingLinqChatIdEncrypted = "pending-ciphertext";
    await bind({ clearPending: false, homeLineAssignedAt: null });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
  });

  it("writes a changed assignment timestamp and recipient", async () => {
    const { bind, prisma } = createFixture();
    const nextAssignedAt = new Date("2026-08-02T00:00:00.000Z");
    await bind({ homeLineAssignedAt: nextAssignedAt, recipientPhone: "+15550000001" });
    expect(prisma.hostedMemberRouting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        linqHomeLineAssignedAt: nextAssignedAt,
        linqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550000001"),
        linqParticipantContactLookupKey: participant.lookupKey,
      }),
    }));
  });

  it.each(["thread", "home"])("retains the competing %s owner fence", async (owner) => {
    const { bind, prisma } = createFixture();
    if (owner === "thread") {
      prisma.hostedThreadRoute.findFirst.mockResolvedValue({ containerMemberId: "other-owner" });
    } else {
      prisma.hostedMemberRouting.findFirst.mockResolvedValue({ memberId: "other-owner" });
    }
    await expect(bind()).rejects.toMatchObject({
      code: owner === "thread" ? "HOSTED_LINQ_CHAT_THREAD_ROUTE_CONFLICT" : "HOSTED_LINQ_CHAT_HOME_ROUTE_CONFLICT",
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
  });
});
