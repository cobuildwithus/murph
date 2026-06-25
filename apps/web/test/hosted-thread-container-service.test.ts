import { HostedBillingStatus, type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";

vi.mock("../src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-crypto/domain-root-store")>();
  return {
    ...actual,
    provisionHostedCryptoDomainRootsForUserTx: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-mailbox/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-mailbox/store")>();
  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: vi.fn(),
  };
});

vi.mock("../src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/hosted-onboarding/hosted-member-store")>();
  return {
    ...actual,
    createHostedMember: vi.fn(),
    readHostedMemberCoreState: vi.fn(),
  };
});

const cryptoStore = await import("../src/lib/hosted-crypto/domain-root-store");
const mailboxStore = await import("../src/lib/hosted-mailbox/store");
const memberStore = await import("../src/lib/hosted-onboarding/hosted-member-store");
const threadContainerService = await import("../src/lib/hosted-routing/thread-container-service");

function createPrismaMock() {
  const hostedThreadContainer = {
    create: vi.fn(),
  };
  const hostedThreadRoute = {
    create: vi.fn(),
    findUnique: vi.fn(),
  };

  return {
    hostedThreadContainer,
    hostedThreadRoute,
  } as unknown as Prisma.TransactionClient & {
    hostedThreadContainer: typeof hostedThreadContainer;
    hostedThreadRoute: typeof hostedThreadRoute;
  };
}

function mockActiveOwner(): void {
  vi.mocked(memberStore.readHostedMemberCoreState).mockResolvedValue({
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-06-24T00:00:00.000Z"),
    id: "member_owner_123",
    suspendedAt: null,
    updatedAt: new Date("2026-06-24T00:00:00.000Z"),
  });
}

describe("hosted thread container service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveOwner();
    vi.mocked(mailboxStore.appendHostedMailboxEnvelopeTx).mockImplementation(async ({ envelope }) => ({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        dedupeKey: envelope.eventId,
        id: "mailbox_activation_123",
      },
    } as Awaited<ReturnType<typeof mailboxStore.appendHostedMailboxEnvelopeTx>>));
  });

  it("creates the container, route, and activation wake atomically for a new external thread", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce(null);
    const threadLookupKey = createHostedExternalThreadLookupKey({
      channel: "linq",
      threadId: "chat_group_123",
    });

    const result = await threadContainerService.createHostedThreadContainerRuntimeTx({
      channel: "linq",
      createdByMemberId: "member_owner_123",
      memberId: "member_container_123",
      occurredAt: new Date("2026-06-24T12:00:00.000Z"),
      prisma,
      sourceEventId: "evt_create_123",
      threadId: "chat_group_123",
    });

    expect(result).toEqual({
      activationEventId: `member.activated:thread-container:linq:${threadLookupKey}:evt_create_123`,
      activationMailboxItemId: "mailbox_activation_123",
      containerMemberId: "member_container_123",
      created: true,
    });
    expect(memberStore.createHostedMember).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_container_123",
      prisma,
    });
    expect(cryptoStore.provisionHostedCryptoDomainRootsForUserTx).toHaveBeenCalledWith({
      reason: "hosted-thread-container.create",
      tx: prisma,
      userId: "member_container_123",
    });
    expect(prisma.hostedThreadContainer.create).toHaveBeenCalledWith({
      data: {
        memberId: "member_container_123",
        monthlyUsageLimitUsdMicros: 4_500_000n,
        ownerMemberId: "member_owner_123",
      },
    });
    expect(prisma.hostedThreadRoute.create).toHaveBeenCalledWith({
      data: {
        channel: "linq",
        containerMemberId: "member_container_123",
        threadLookupKey,
      },
    });
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: `member.activated:thread-container:linq:${threadLookupKey}:evt_create_123`,
        kind: "member.activated",
        userId: "member_container_123",
      }),
      tx: prisma,
    });
  });

  it("returns the existing owned container when the same external thread is retried", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce({
      container: {
        ownerMemberId: "member_owner_123",
      },
      containerMemberId: "member_container_existing",
    });

    await expect(
      threadContainerService.createHostedThreadContainerRuntimeTx({
        channel: "linq",
        createdByMemberId: "member_owner_123",
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        prisma,
        sourceEventId: "evt_create_123",
        threadId: "chat_group_123",
      }),
    ).resolves.toEqual({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: "member_container_existing",
      created: false,
    });

    expect(memberStore.createHostedMember).not.toHaveBeenCalled();
    expect(prisma.hostedThreadContainer.create).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute.create).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("derives a stable default container member id from the route identity", async () => {
    const firstPrisma = createPrismaMock();
    const secondPrisma = createPrismaMock();
    firstPrisma.hostedThreadRoute.findUnique.mockResolvedValueOnce(null);
    secondPrisma.hostedThreadRoute.findUnique.mockResolvedValueOnce(null);

    const first = await threadContainerService.createHostedThreadContainerRuntimeTx({
      channel: "linq",
      createdByMemberId: "member_owner_123",
      occurredAt: new Date("2026-06-24T12:00:00.000Z"),
      prisma: firstPrisma,
      sourceEventId: "evt_create_123",
      threadId: "chat_group_123",
    });
    const second = await threadContainerService.createHostedThreadContainerRuntimeTx({
      channel: "linq",
      createdByMemberId: "member_owner_123",
      occurredAt: new Date("2026-06-24T12:00:00.000Z"),
      prisma: secondPrisma,
      sourceEventId: "evt_create_123",
      threadId: "chat_group_123",
    });

    expect(first.containerMemberId).toMatch(/^hbtc_/u);
    expect(second.containerMemberId).toBe(first.containerMemberId);
    expect(first.activationEventId).toBe(second.activationEventId);
  });

  it("does not return a route owned by another hosted member", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce({
      container: {
        ownerMemberId: "member_other_123",
      },
      containerMemberId: "member_container_existing",
    });

    await expect(
      threadContainerService.createHostedThreadContainerRuntimeTx({
        channel: "linq",
        createdByMemberId: "member_owner_123",
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        prisma,
        sourceEventId: "evt_create_123",
        threadId: "chat_group_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
    });

    expect(memberStore.createHostedMember).not.toHaveBeenCalled();
    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("does not append activation if route creation fails", async () => {
    const prisma = createPrismaMock();
    prisma.hostedThreadRoute.findUnique.mockResolvedValueOnce(null);
    prisma.hostedThreadRoute.create.mockRejectedValueOnce(new Error("route failed"));

    await expect(
      threadContainerService.createHostedThreadContainerRuntimeTx({
        channel: "linq",
        createdByMemberId: "member_owner_123",
        memberId: "member_container_123",
        occurredAt: new Date("2026-06-24T12:00:00.000Z"),
        prisma,
        sourceEventId: "evt_create_123",
        threadId: "chat_group_123",
      }),
    ).rejects.toThrow("route failed");

    expect(mailboxStore.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
