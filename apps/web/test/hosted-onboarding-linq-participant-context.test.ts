import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedLinqThreadRouteParticipantContextTx: vi.fn(),
  hasHostedMemberActivationProof: vi.fn(),
  lookupHostedGroupParticipantMemberByHandle: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedOwnerAddressBookAdvisoryNames: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-routing/thread-route-store")
  >("@/src/lib/hosted-routing/thread-route-store");
  return {
    ...actual,
    appendHostedLinqThreadRouteParticipantContextTx:
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
  };
});

vi.mock("@/src/lib/hosted-address-book/projection", () => ({
  readHostedOwnerAddressBookAdvisoryNames:
    mocks.readHostedOwnerAddressBookAdvisoryNames,
}));

vi.mock("@/src/lib/hosted-groups/participant-member", () => ({
  lookupHostedGroupParticipantMemberByHandle:
    mocks.lookupHostedGroupParticipantMemberByHandle,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  hasHostedMemberActivationProof: mocks.hasHostedMemberActivationProof,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

import type {
  HostedLinqParticipantChangedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  stageHostedLinqGroupParticipantContextTx,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq-participant-context";
import type {
  HostedThreadRouteSnapshot,
} from "@/src/lib/hosted-routing/thread-route-store";

describe("stageHostedLinqGroupParticipantContextTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedLinqThreadRouteParticipantContextTx.mockResolvedValue(
      "appended",
    );
    mocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue(null);
    mocks.hasHostedMemberActivationProof.mockResolvedValue(false);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 1,
      contactMatchCount: 0,
      names: new Map<string, string>(),
      outcome: "no_contact_match",
      requestedHandleCount: 1,
    });
  });

  it("stages an added handle with the owner's unverified contact label", async () => {
    const prisma = createPrismaStub();
    mocks.readHostedOwnerAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 1,
      contactMatchCount: 1,
      names: new Map([["+15551234567", "Taylor R."]]),
      outcome: "matched",
      requestedHandleCount: 1,
    });

    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent("participant.added", "+15551234567"),
      prisma,
      route: buildActiveRoute(),
    })).resolves.toBe(true);

    expect(mocks.readHostedOwnerAddressBookAdvisoryNames).toHaveBeenCalledWith({
      containerMemberId: "member_group_runtime",
      phoneHandles: ["+15551234567"],
      prisma,
    });
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).toHaveBeenCalledWith({
      containerMemberId: "member_group_runtime",
      excludedAccountLookupKeys: expect.arrayContaining([
        expect.stringMatching(/^hbidx:phone:/u),
      ]),
      prisma: expect.any(Object),
      text: "Participant +15551234567 (unverified owner contact label: Taylor R.) was added to the group.",
      threadId: "chat_group",
    });
  });

  it("stages a removed email handle without consulting the phone projection", async () => {
    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent(
        "participant.removed",
        "person@example.test",
      ),
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(true);

    expect(
      mocks.readHostedOwnerAddressBookAdvisoryNames,
    ).not.toHaveBeenCalled();
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      text: "Participant person@example.test was removed from the group.",
      threadId: "chat_group",
    }));
  });

  it("does not expose an owner label for a participant with active Murph identity", async () => {
    mocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue({
      core: { id: "member_participant" },
    });
    mocks.hasHostedMemberActivationProof.mockResolvedValue(true);

    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent("participant.added", "+15551234567"),
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(true);

    expect(
      mocks.readHostedOwnerAddressBookAdvisoryNames,
    ).not.toHaveBeenCalled();
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      text: "Participant +15551234567 was added to the group.",
    }));
  });

  it("keeps the handle-only context when identity resolution is unavailable", async () => {
    mocks.lookupHostedGroupParticipantMemberByHandle.mockRejectedValue(
      new Error("lookup unavailable"),
    );

    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent("participant.removed", "+15551234567"),
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(true);

    expect(
      mocks.readHostedOwnerAddressBookAdvisoryNames,
    ).not.toHaveBeenCalled();
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      text: "Participant +15551234567 was removed from the group.",
    }));
  });

  it("skips invalid or inactive route context and absorbs staging failure", async () => {
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(false);

    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent("participant.added", "+15551234567"),
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(false);
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).not.toHaveBeenCalled();

    mocks.appendHostedLinqThreadRouteParticipantContextTx.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(stageHostedLinqGroupParticipantContextTx({
      event: buildParticipantEvent("participant.removed", "+15551234567"),
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(false);
  });

  it("does not stage Murph's own line as a participant", async () => {
    const event = buildParticipantEvent("participant.added", "+15551234567");
    event.data.participant.is_me = true;

    await expect(stageHostedLinqGroupParticipantContextTx({
      event,
      prisma: createPrismaStub(),
      route: buildActiveRoute(),
    })).resolves.toBe(false);

    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(
      mocks.appendHostedLinqThreadRouteParticipantContextTx,
    ).not.toHaveBeenCalled();
  });
});

function buildParticipantEvent(
  eventType: HostedLinqParticipantChangedEvent["event_type"],
  handle: string,
): HostedLinqParticipantChangedEvent {
  const base = {
    api_version: "v3",
    created_at: "2026-07-29T01:00:00.000Z",
    event_id: `evt_${eventType.replace(".", "_")}`,
    participant: { handle, service: "iMessage" },
  };
  return eventType === "participant.added"
    ? {
        ...base,
        data: {
          chat_id: "chat_group",
          participant: base.participant,
        },
        event_type: "participant.added",
      }
    : {
        ...base,
        data: {
          chat_id: "chat_group",
          participant: base.participant,
        },
        event_type: "participant.removed",
      };
}

function buildActiveRoute(): HostedThreadRouteSnapshot {
  const now = new Date("2026-07-29T01:00:00.000Z");
  return {
    channel: "linq",
    container: {
      billingStatus: HostedBillingStatus.not_started,
      createdAt: now,
      id: "member_group_runtime",
      suspendedAt: null,
      updatedAt: now,
    },
    containerMemberId: "member_group_runtime",
    owner: {
      accountGroupMemberships: [],
      billingStatus: HostedBillingStatus.active,
      createdAt: now,
      id: "member_owner",
      suspendedAt: null,
      updatedAt: now,
    },
  };
}

function createPrismaStub(): Prisma.TransactionClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
  } as never;
}
