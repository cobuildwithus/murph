import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { createHostedEmailLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  bindHostedMemberLinqEmailHandleTx,
  lookupHostedMemberIdentityByLinqEmailHandle,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  finalizeHostedMemberActivationLinqRouteTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  planHostedOnboardingLinqWebhook,
  resolveHostedLinqDirectPreparationMemberId,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import { POST } from "../app/api/groups/start/recover/route";

const boundaries = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  openToken: vi.fn(),
}));
vi.mock("@/src/lib/prisma", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/prisma")>(),
  getPrisma: boundaries.getPrisma,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: async (request: Request) => ({
    member: { id: request.headers.get("x-test-member"), suspendedAt: null },
  }),
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: () => undefined,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-group-setup", () => ({
  openHostedLinqGroupEmailRecoveryToken: boundaries.openToken,
}));
// Only external crypto preparation is replaced. Identity, routing, contact
// locks, transactions, uniqueness, and route promotion use real PostgreSQL.
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  prepareHostedDomainRootForWeb: async () => ({ rootKeyId: "synthetic-control-root" }),
  revalidatePreparedHostedDomainRootForWebTx: async () => undefined,
  provisionActiveHostedDomainRootEnvelopeForUserOnly: async () => undefined,
}));
vi.mock("@/src/lib/hosted-mailbox/encryption", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-mailbox/encryption")>(),
  prewarmHostedMailboxPayloadActiveRoot: async () => undefined,
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Recovery proof requires an explicit loopback PostgreSQL database.");
  }
}

describe.skipIf(!enabled)("Linq recovery identity PostgreSQL composition", () => {
  let prisma: PrismaClient;
  const memberIds: string[] = [];

  beforeEach(() => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
    boundaries.getPrisma.mockReturnValue(prisma);
    setHostedSecureBoxStringTestCodecForTests({
      encrypt: ({ value }) => value,
      decrypt: ({ value }) => value,
    });
  });
  afterEach(async () => {
    await prisma.hostedMember.deleteMany({ where: { id: { in: memberIds.splice(0) } } });
    await prisma.$disconnect();
    setHostedSecureBoxStringTestCodecForTests(null);
  });

  async function createMember() {
    const member = await prisma.hostedMember.create({ data: {
      id: `recovery_${randomUUID()}`, identity: { create: {} },
    } });
    memberIds.push(member.id);
    return member.id;
  }

  function recovery() {
    const contact = createHostedLinqParticipantContact({
      kind: "email", value: `recovery-${randomUUID()}@example.test`,
    });
    if (!contact) throw new Error("Expected synthetic email contact.");
    const result = {
      chatId: `group_${randomUUID()}`, observedAt: new Date(),
      participantContact: contact, recipientPhone: "+15550001234",
    };
    boundaries.openToken.mockReturnValue(result);
    return result;
  }

  function recover(memberId: string) {
    return POST(new Request("https://murph.example/api/groups/start/recover", {
      method: "POST", body: JSON.stringify({ token: "synthetic-recovery-token" }),
      headers: { "content-type": "application/json", "x-test-member": memberId },
    }));
  }

  it("rejects recovery by a different account and preserves both accounts", async () => {
    const owner = await createMember();
    const other = await createMember();
    const input = recovery();
    await prisma.$transaction(tx => bindHostedMemberLinqEmailHandleTx({
      emailAddress: input.participantContact.value,
      lookupKey: input.participantContact.lookupKey, memberId: owner, prisma: tx,
    }));
    expect((await recover(other)).status).toBe(409);
    expect(await prisma.hostedMemberRouting.count({ where: { memberId: other } })).toBe(0);
    expect(await prisma.hostedMemberIdentity.findUnique({ where: { memberId: other } }))
      .toMatchObject({ linqEmailHandleLookupKey: null, linqEmailHandleEncrypted: null });
    expect(await lookupHostedMemberIdentityByLinqEmailHandle({
      emailAddress: input.participantContact.value, prisma, projection: "core",
    })).toMatchObject({ core: { id: owner } });
  });

  it("retains recovered identity and source through direct routing and activation", async () => {
    const memberId = await createMember();
    const input = recovery();
    expect((await recover(memberId)).status).toBe(200);
    expect((await recover(memberId)).status).toBe(200);
    const lookup = await lookupHostedMemberIdentityByLinqEmailHandle({
      emailAddress: input.participantContact.value, prisma, projection: "core",
    });
    expect(lookup).toMatchObject({ core: { id: memberId } });
    const directChatId = `direct_${randomUUID()}`;
    const event = {
      api_version: "2026-01-01", created_at: input.observedAt.toISOString(),
      event_id: `event_${randomUUID()}`, event_type: "message.received" as const,
      data: {
        chat: { id: directChatId, is_group: false }, chat_id: directChatId,
        from: input.participantContact.value, is_from_me: false,
        message: { id: `message_${randomUUID()}`, parts: [{ type: "text", value: "Hello" }] },
        recipient_phone: input.recipientPhone,
        sender_handle: { handle: input.participantContact.value, is_me: false, service: "iMessage" },
        service: "iMessage",
      },
    };
    expect(await resolveHostedLinqDirectPreparationMemberId({ event, prisma })).toBe(memberId);
    await prisma.$transaction(async tx => {
      await upsertHostedMemberPendingLinqBindingTx({
        linqChatId: directChatId, memberId, participantContact: input.participantContact,
        participantContactObservedAt: input.observedAt, prisma: tx,
        recipientPhone: input.recipientPhone,
      });
      await finalizeHostedMemberActivationLinqRouteTx({
        chatId: directChatId, kind: "pending", memberId,
        participantContact: input.participantContact, prisma: tx,
        recipientPhone: input.recipientPhone,
      });
    });
    expect(await prisma.hostedMemberRouting.findUnique({ where: { memberId } }))
      .toMatchObject({ pendingLinqParticipantContactEncrypted: null });
    expect(await prisma.hostedMemberIdentity.findUnique({ where: { memberId } }))
      .toMatchObject({
        linqEmailHandleLookupKey: input.participantContact.lookupKey,
        linqEmailHandleEncrypted: input.participantContact.value,
      });
    expect(await prisma.hostedMemberEmailAuthorization.count({ where: { memberId } })).toBe(0);
    expect(await resolveHostedLinqDirectPreparationMemberId({
      event: { ...event, data: { ...event.data, chat: { id: "new_direct_chat", is_group: false }, chat_id: "new_direct_chat" } },
      prisma,
    })).toBe(memberId);
  });

  it.each(["same member", "conflicting member"])("keeps recovered and verified email authorities separate: %s", async (ownership) => {
    const memberId = await createMember();
    const verifiedEmail = `verified-${randomUUID()}@example.test`;
    await prisma.hostedMember.update({ where: { id: memberId }, data: {
      billingStatus: "active",
      emailAuthorization: { create: {
        verifiedEmailAddressEncrypted: verifiedEmail,
        verifiedEmailLookupKey: createHostedEmailLookupKey(verifiedEmail),
        verifiedEmailVerifiedAt: new Date(),
      } },
    } });
    const input = recovery();
    expect((await recover(memberId)).status).toBe(200);
    const recoveredChatId = `direct_${randomUUID()}`;
    await prisma.$transaction(async tx => {
      await upsertHostedMemberPendingLinqBindingTx({
        linqChatId: recoveredChatId, memberId, participantContact: input.participantContact,
        participantContactObservedAt: input.observedAt, prisma: tx,
        recipientPhone: input.recipientPhone,
      });
      await finalizeHostedMemberActivationLinqRouteTx({
        chatId: recoveredChatId, kind: "pending", memberId,
        participantContact: input.participantContact, prisma: tx,
        recipientPhone: input.recipientPhone,
      });
    });
    const retainedIdentity = await prisma.hostedMemberIdentity.findUniqueOrThrow({
      where: { memberId },
    });
    if (ownership === "conflicting member") {
      const otherMemberId = await createMember();
      const contact = createHostedLinqParticipantContact({ kind: "email", value: verifiedEmail });
      if (!contact) throw new Error("Expected synthetic verified contact.");
      // Deliberately seed conflicting legacy owners; normal recovery rejects it.
      await prisma.$transaction(tx => bindHostedMemberLinqEmailHandleTx({
        emailAddress: verifiedEmail, lookupKey: contact.lookupKey,
        memberId: otherMemberId, prisma: tx,
      }));
    }
    const event = parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3", created_at: new Date().toISOString(),
      event_id: `event_${randomUUID()}`, event_type: "message.received",
      data: {
        chat: {
          id: `verified_direct_${randomUUID()}`, is_group: false,
          owner_handle: { handle: input.recipientPhone, is_me: true, service: "iMessage" },
        },
        id: `message_${randomUUID()}`, direction: "inbound", service: "iMessage",
        parts: [{ type: "text", value: "Can you help me plan my week?" }],
        sender_handle: { handle: verifiedEmail, service: "iMessage" },
      },
    }));
    const plan = () => prisma.$transaction(tx => planHostedOnboardingLinqWebhook({ event, prisma: tx }));
    if (ownership === "conflicting member") {
      const conflict = { code: "HOSTED_LINQ_EMAIL_HANDLE_IDENTITY_CONFLICT" };
      await expect(resolveHostedLinqDirectPreparationMemberId({ event, prisma })).rejects.toMatchObject(conflict);
      await expect(plan()).rejects.toMatchObject(conflict);
    } else {
      expect(await resolveHostedLinqDirectPreparationMemberId({ event, prisma })).toBe(memberId);
      expect((await plan()).response).toMatchObject({ ok: true, reason: "wake-appended-active-member" });
      expect((await plan()).response).toMatchObject({ ok: true, duplicate: true, reason: "duplicate-webhook-event" });
    }
    expect(await prisma.hostedMailboxItem.count({
      where: { userId: memberId, dedupeKey: event.event_id },
    })).toBe(ownership === "same member" ? 1 : 0);
    expect(await prisma.hostedMemberIdentity.findUnique({ where: { memberId } }))
      .toEqual(retainedIdentity);
    expect(await lookupHostedMemberIdentityByLinqEmailHandle({
      emailAddress: input.participantContact.value, prisma, projection: "core",
    })).toMatchObject({ core: { id: memberId } });
  });

  it("serializes two recovery claimants into one identity and one route", async () => {
    const first = await createMember();
    const second = await createMember();
    const input = recovery();
    const responses = await Promise.all([recover(first), recover(second)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const owner = await prisma.hostedMemberIdentity.findUnique({
      where: { linqEmailHandleLookupKey: input.participantContact.lookupKey },
    });
    const route = await prisma.hostedMemberRouting.findFirst({
      where: { pendingLinqParticipantContactLookupKey: input.participantContact.lookupKey },
    });
    expect(owner?.memberId).toBe(route?.memberId);
    expect(await prisma.hostedMemberRouting.count({ where: { memberId: { in: [first, second] } } })).toBe(1);
  });

  it("rolls back the identity if the routing owner rejects a conflicting pending contact", async () => {
    const existing = await createMember();
    const claimant = await createMember();
    const input = recovery();
    await prisma.$transaction(tx => upsertHostedMemberPendingLinqBindingTx({
      linqChatId: `other_${randomUUID()}`, memberId: existing,
      participantContact: input.participantContact, participantContactObservedAt: input.observedAt,
      prisma: tx, recipientPhone: input.recipientPhone,
    }));
    expect((await recover(claimant)).status).toBe(409);
    expect(await prisma.hostedMemberIdentity.findUnique({ where: { memberId: claimant } }))
      .toMatchObject({ linqEmailHandleLookupKey: null, linqEmailHandleEncrypted: null });
    expect(await prisma.hostedMemberRouting.count({ where: { memberId: claimant } })).toBe(0);
  });
});
