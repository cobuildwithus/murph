import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  getPrisma: vi.fn(),
  hostedMember: {
    findUnique: vi.fn(),
  },
  hostedMemberIdentity: {
    findUnique: vi.fn(),
  },
  hostedMemberRouting: {
    findUnique: vi.fn(),
  },
  listHostedLinqAssignableHomeLines: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-routing-store");
  return {
    ...actual,
    acquireHostedMemberHomeLinqRecipientAssignmentLockTx:
      mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
    countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince:
      mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
    countHostedMemberHomeLinqBindingsByRecipientPhone:
      mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
    readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
    upsertHostedMemberHomeLinqRecipientPhoneTx:
      mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-line-store")
  >("@/src/lib/hosted-onboarding/linq-line-store");
  return {
    ...actual,
    listHostedLinqAssignableHomeLines: mocks.listHostedLinqAssignableHomeLines,
  };
});

import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import type { HostedMemberRoutingStateSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import type { HostedLinqAssignableHomeLine } from "@/src/lib/hosted-onboarding/linq-line-store";

type LinqRehomeRouteModule = typeof import("../app/api/ops/linq-rehome/route");
type LinqRehomeServiceModule = typeof import("../src/lib/hosted-ops/linq-line-rehome");

let route: LinqRehomeRouteModule;
let service: LinqRehomeServiceModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const NOW = new Date("2026-07-06T15:45:30.000Z");
const MEMBER_ID = "member_123";
const MEMBER_PHONE_LOOKUP_KEY = createHostedPhoneLookupKey("+15550109999");
const LINE_A = buildLine("+15550100001");
const LINE_B = buildLine("+15550100002");

if (!MEMBER_PHONE_LOOKUP_KEY) {
  throw new Error("Expected hosted phone lookup key for test member.");
}

const transactionClient = {
  hostedMember: mocks.hostedMember,
  hostedMemberIdentity: mocks.hostedMemberIdentity,
  hostedMemberRouting: mocks.hostedMemberRouting,
};

const prisma = {
  $transaction: vi.fn(async (
    callback: (tx: typeof transactionClient) => Promise<unknown>,
  ) => callback(transactionClient)),
  hostedMember: mocks.hostedMember,
  hostedMemberIdentity: mocks.hostedMemberIdentity,
  hostedMemberRouting: mocks.hostedMemberRouting,
};

let consoleInfoSpy: {
  mock: {
    calls: unknown[][];
  };
  mockRestore(): void;
};

describe("hosted Linq line rehome ops", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/linq-rehome/route");
    service = await import("../src/lib/hosted-ops/linq-line-rehome");
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    prisma.$transaction.mockImplementation(async (
      callback: (tx: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient));
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.hostedMemberIdentity.findUnique.mockResolvedValue({
      phoneLookupKey: MEMBER_PHONE_LOOKUP_KEY,
    });
    mocks.hostedMember.findUnique.mockResolvedValue({
      id: MEMBER_ID,
      suspendedAt: null,
    });
    mocks.hostedMemberRouting.findUnique.mockResolvedValue({
      linqLastInboundAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildRouting({
      linqChatId: "chat_home_a",
      linqHomeLineAssignedAt: new Date("2026-07-01T11:00:00.000Z"),
      linqRecipientPhone: LINE_A.phoneNumber,
      linqRecipientPhoneLookupKey: LINE_A.phoneNumberLookupKey,
    }));
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([LINE_A, LINE_B]);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(new Map());
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockResolvedValue(undefined);
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    vi.useRealTimers();
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  it("reads an overview with authority, line hints, lookup keys, and active counts only", async () => {
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        [LINE_A.phoneNumber, 7],
        [LINE_B.phoneNumber, 2],
      ]),
    );

    const overview = await service.readHostedLinqLineRehomeOverview({
      memberId: MEMBER_ID,
    });

    expect(overview).toMatchObject({
      assignableTargetLines: [
        {
          activeMemberCount: 7,
          phoneNumberHint: "*** 0001",
          phoneNumberLookupKey: LINE_A.phoneNumberLookupKey,
        },
        {
          activeMemberCount: 2,
          phoneNumberHint: "*** 0002",
          phoneNumberLookupKey: LINE_B.phoneNumberLookupKey,
        },
      ],
      currentRouting: {
        authorityKind: "home",
        currentLinePhoneHint: "*** 0001",
        homeChatBound: true,
        linqHomeLineAssignedAt: "2026-07-01T11:00:00.000Z",
        linqLastInboundAt: "2026-07-01T12:00:00.000Z",
        linqRecipientPhoneLookupKey: LINE_A.phoneNumberLookupKey,
      },
      member: {
        id: MEMBER_ID,
        suspendedAt: null,
      },
    });
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledWith({
      now: NOW,
      prisma,
      recipientPhones: [LINE_A.phoneNumber, LINE_B.phoneNumber],
    });
    expect(JSON.stringify(overview)).not.toContain(LINE_A.phoneNumber);
    expect(JSON.stringify(overview)).not.toContain(LINE_B.phoneNumber);
  });

  it("rehomes a bound home chat to a bare target line through the existing write primitive", async () => {
    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).resolves.toEqual({
      clearedHomeChat: true,
      clearedPendingRoute: false,
      fromLineHint: "*** 0001",
      toLineHint: "*** 0002",
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx)
      .toHaveBeenCalledWith({ prisma: transactionClient });
    expect(mocks.hostedMemberIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        memberId: MEMBER_ID,
      },
      select: {
        phoneLookupKey: true,
      },
    });
    expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).toHaveBeenCalledWith({
      excludedMemberId: MEMBER_ID,
      now: NOW,
      prisma: transactionClient,
      recipientPhones: [LINE_B.phoneNumber],
    });
    expect(mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince).toHaveBeenCalledWith({
      prisma: transactionClient,
      recipientPhones: [LINE_B.phoneNumber],
      since: new Date("2026-07-06T00:00:00.000Z"),
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      homeLineAssignedAt: NOW,
      memberId: MEMBER_ID,
      prisma: transactionClient,
      recipientPhone: LINE_B.phoneNumber,
    });
  });

  it("rejects members without a phone identity before locking or routing writes", async () => {
    mocks.hostedMemberIdentity.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_MEMBER_PHONE_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("rejects members with null phone lookup identity before locking or routing writes", async () => {
    mocks.hostedMemberIdentity.findUnique.mockResolvedValueOnce({
      phoneLookupKey: null,
    });

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_MEMBER_PHONE_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).not.toHaveBeenCalled();
    expect(mocks.listHostedLinqAssignableHomeLines).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("clears pending Linq route state when rehoming", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(buildRouting({
      hasPendingLinqRouteState: true,
      linqHomeLineAssignedAt: new Date("2026-07-01T11:00:00.000Z"),
      linqRecipientPhone: LINE_A.phoneNumber,
      linqRecipientPhoneLookupKey: LINE_A.phoneNumberLookupKey,
      pendingLinqChatId: "chat_pending",
      pendingLinqRecipientPhone: LINE_A.phoneNumber,
    }));

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).resolves.toMatchObject({
      clearedHomeChat: false,
      clearedPendingRoute: true,
      fromLineHint: "*** 0001",
      toLineHint: "*** 0002",
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith(
      expect.objectContaining({
        clearPending: true,
        recipientPhone: LINE_B.phoneNumber,
      }),
    );
  });

  it("allows members with no existing Linq route to become bare on the target", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).resolves.toEqual({
      clearedHomeChat: false,
      clearedPendingRoute: false,
      fromLineHint: null,
      toLineHint: "*** 0002",
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith(
      expect.objectContaining({
        clearPending: true,
        recipientPhone: LINE_B.phoneNumber,
      }),
    );
  });

  it("rejects a target that is not in the assignable line pool", async () => {
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([LINE_A]);

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_TARGET_NOT_ASSIGNABLE",
      httpStatus: 400,
    });

    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("rejects already-on-target routes using target phone lookup-key candidates", async () => {
    const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
      `v1:${Buffer.alloc(32, 0).toString("base64")}`,
      `v2:${Buffer.alloc(32, 1).toString("base64")}`,
    ].join(",");
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";

    try {
      const rotatedLineB = buildLine(LINE_B.phoneNumber);
      const [currentLookupKey, legacyLookupKey] =
        createHostedPhoneLookupKeyReadCandidates(rotatedLineB.phoneNumber);

      if (!currentLookupKey || !legacyLookupKey) {
        throw new Error("Expected current and legacy lookup keys for rotated test keyring.");
      }

      expect(rotatedLineB.phoneNumberLookupKey).toBe(currentLookupKey);
      mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([rotatedLineB]);
      mocks.readHostedMemberRoutingState.mockResolvedValue(buildRouting({
        linqRecipientPhone: LINE_B.phoneNumber,
        linqRecipientPhoneLookupKey: legacyLookupKey,
      }));

      await expect(
        service.rehomeHostedMemberLinqHomeLine({
          memberId: MEMBER_ID,
          targetLineLookupKey: rotatedLineB.phoneNumberLookupKey,
        }),
      ).rejects.toMatchObject({
        code: "HOSTED_LINQ_REHOME_ALREADY_ON_TARGET",
        httpStatus: 409,
      });

      expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
      expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    } finally {
      restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
      restoreEnvValue(
        "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
        previousCurrentVersion,
      );
    }
  });

  for (const [label, linqRecipientPhoneLookupKey] of [
    ["null lookup key", null],
    ["stale lookup key", LINE_A.phoneNumberLookupKey],
  ] as const) {
    it(`rejects already-on-target routes by normalized phone with ${label}`, async () => {
      mocks.readHostedMemberRoutingState.mockResolvedValue(buildRouting({
        linqRecipientPhone: "1 (555) 010-0002",
        linqRecipientPhoneLookupKey,
      }));

      await expect(
        service.rehomeHostedMemberLinqHomeLine({
          memberId: MEMBER_ID,
          targetLineLookupKey: LINE_B.phoneNumberLookupKey,
        }),
      ).rejects.toMatchObject({
        code: "HOSTED_LINQ_REHOME_ALREADY_ON_TARGET",
        httpStatus: 409,
      });

      expect(mocks.countHostedMemberHomeLinqBindingsByRecipientPhone).not.toHaveBeenCalled();
      expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    });
  }

  it("rejects a target at active-member capacity", async () => {
    const cappedLine = buildLine("+15550100003", {
      activeMemberLimit: 1,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([cappedLine]);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([[cappedLine.phoneNumber, 1]]),
    );

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: cappedLine.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_TARGET_AT_CAPACITY",
      httpStatus: 409,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("rejects a target at daily new-conversation capacity", async () => {
    const cappedLine = buildLine("+15550100004", {
      maxNewConversationsPerDay: 1,
    });
    mocks.listHostedLinqAssignableHomeLines.mockResolvedValue([cappedLine]);
    mocks.countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince.mockResolvedValue(
      new Map([[cappedLine.phoneNumber, 1]]),
    );

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: cappedLine.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_TARGET_AT_CAPACITY",
      httpStatus: 409,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("rejects unknown and suspended members before route writes", async () => {
    mocks.hostedMember.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: "member_missing",
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_MEMBER_NOT_FOUND",
      httpStatus: 404,
    });

    mocks.hostedMember.findUnique.mockResolvedValueOnce({
      id: MEMBER_ID,
      suspendedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    await expect(
      service.rehomeHostedMemberLinqHomeLine({
        memberId: MEMBER_ID,
        targetLineLookupKey: LINE_B.phoneNumberLookupKey,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_REHOME_MEMBER_SUSPENDED",
      httpStatus: 409,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("gates GET and POST through hosted ops access with 404 semantics", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_other" },
    });

    const getResponse = await route.GET(
      new Request(`https://join.example.test/api/ops/linq-rehome?memberId=${MEMBER_ID}`),
    );
    const postResponse = await route.POST(
      new Request("https://join.example.test/api/ops/linq-rehome", {
        body: JSON.stringify({
          memberId: MEMBER_ID,
          targetLineLookupKey: LINE_B.phoneNumberLookupKey,
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(mocks.hostedMember.findUnique).not.toHaveBeenCalled();
    await expect(getResponse.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
    await expect(postResponse.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });

  it("rejects missing memberId and targetLineLookupKey request fields before mutation", async () => {
    const missingMember = await route.GET(
      new Request("https://join.example.test/api/ops/linq-rehome"),
    );
    expect(missingMember.status).toBe(400);
    await expect(missingMember.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_REHOME_MEMBER_ID_REQUIRED",
      },
    });

    const missingTarget = await route.POST(
      new Request("https://join.example.test/api/ops/linq-rehome", {
        body: JSON.stringify({
          memberId: MEMBER_ID,
          targetLineLookupKey: " ",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(missingTarget.status).toBe(400);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    await expect(missingTarget.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_REHOME_TARGET_LOOKUP_KEY_REQUIRED",
      },
    });
  });

  it("returns route payloads with hints and lookup keys but no raw phone numbers", async () => {
    const getResponse = await route.GET(
      new Request(`https://join.example.test/api/ops/linq-rehome?memberId=${MEMBER_ID}`),
    );
    const postResponse = await route.POST(
      new Request("https://join.example.test/api/ops/linq-rehome", {
        body: JSON.stringify({
          memberId: MEMBER_ID,
          targetLineLookupKey: LINE_B.phoneNumberLookupKey,
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST" }),
    );

    const getPayload = await getResponse.json();
    const postPayload = await postResponse.json();
    expect(getPayload.assignableTargetLines[1]).toMatchObject({
      phoneNumberHint: "*** 0002",
      phoneNumberLookupKey: LINE_B.phoneNumberLookupKey,
    });
    expect(postPayload).toEqual({
      clearedHomeChat: true,
      clearedPendingRoute: false,
      fromLineHint: "*** 0001",
      toLineHint: "*** 0002",
    });
    expect(consoleInfoSpy).toHaveBeenCalledWith("Hosted ops Linq rehome completed.", {
      fromLineHint: "*** 0001",
      operatorMemberId: "member_ops",
      targetMemberId: MEMBER_ID,
      timestamp: NOW.toISOString(),
      toLineHint: "*** 0002",
    });
    const serialized = JSON.stringify({ getPayload, postPayload });
    expect(serialized).not.toContain(LINE_A.phoneNumber);
    expect(serialized).not.toContain(LINE_B.phoneNumber);
    const serializedLog = JSON.stringify(consoleInfoSpy.mock.calls);
    expect(serializedLog).not.toContain(LINE_A.phoneNumber);
    expect(serializedLog).not.toContain(LINE_B.phoneNumber);
    expect(serializedLog).not.toContain(LINE_A.phoneNumberLookupKey);
    expect(serializedLog).not.toContain(LINE_B.phoneNumberLookupKey);
  });
});

function buildLine(
  phoneNumber: string,
  overrides: Partial<{
    activeMemberLimit: number | null;
    assignmentWeight: number;
    maxNewConversationsPerDay: number | null;
  }> = {},
): HostedLinqAssignableHomeLine {
  const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!phoneNumberLookupKey) {
    throw new Error("Expected hosted phone lookup key for test line.");
  }

  return {
    activeMemberLimit: overrides.activeMemberLimit ?? null,
    assignmentWeight: overrides.assignmentWeight ?? 100,
    maxNewConversationsPerDay: overrides.maxNewConversationsPerDay ?? null,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey,
  };
}

function buildRouting(
  overrides: Partial<HostedMemberRoutingStateSnapshot> = {},
): HostedMemberRoutingStateSnapshot {
  return {
    hasPendingLinqRouteState: false,
    linqChatId: null,
    linqChatLookupKey: null,
    linqHomeLineAssignedAt: null,
    linqRecipientPhone: null,
    linqRecipientPhoneLookupKey: null,
    memberId: MEMBER_ID,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    replyAliasLookupKey: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
    ...overrides,
  };
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
