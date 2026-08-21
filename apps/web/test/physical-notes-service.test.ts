import type {
  HostedPhysicalNote,
  HostedPhysicalNoteRecovery,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhysicalNoteSendRequest,
} from "@murphai/hosted-execution/physical-notes";
import {
  createHostedPhysicalNoteRequestKey,
} from "@murphai/hosted-execution/physical-notes";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createLobPhysicalNoteRuntime,
  type LobPhysicalNoteCreateResult,
  type LobPhysicalNoteLookupResult,
  type LobPhysicalNoteRuntime,
} from "@/src/lib/physical-notes/lob-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertActiveAccess: vi.fn(),
  assertGroupOrigin: vi.fn(),
  getPrisma: vi.fn(),
  isThreadContainerDestination: vi.fn(),
  lockMember: vi.fn(),
  readActiveAccess: vi.fn(),
  readUsageGate: vi.fn(),
  recordUsage: vi.fn(),
  requireDestination: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/participant-action-authority", () => ({
  assertHostedGroupParticipantActionOriginHasOwnMurph:
    mocks.assertGroupOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveAccess,
  readActiveHostedMemberAccess: mocks.readActiveAccess,
}));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
  lockHostedMemberRow: mocks.lockMember,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination:
    mocks.isThreadContainerDestination,
  requireHostedAssistantNotificationDestination:
    mocks.requireDestination,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readUsageGate,
}));
vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: mocks.recordUsage,
}));

const MEMBER_ID = "member_physical_note";
const COST_USD_MICROS = 250_000n;
const COMPLIMENTARY_OFFER_CODE = "physical-note-v1";
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const DEFAULT_PERIOD_START = new Date(Date.now() - 60 * 60 * 1_000);
const DEFAULT_PERIOD_END = new Date(Date.now() + 60 * 60 * 1_000);

type PhysicalNoteWhere = Partial<Pick<
  HostedPhysicalNote,
  | "complimentaryOfferCode"
  | "failureReason"
  | "id"
  | "memberId"
  | "providerLetterId"
  | "requestKey"
  | "status"
>> & {
  OR?: readonly PhysicalNoteWhere[];
  createdAt?: { lte: Date };
};

type PhysicalNoteCreateData = Pick<
  HostedPhysicalNote,
  | "complimentaryOfferCode"
  | "id"
  | "memberId"
  | "pricingVersion"
  | "provider"
  | "providerCostUsdMicros"
  | "requestFingerprint"
  | "requestKey"
  | "status"
> & {
  failureReason?: HostedPhysicalNote["failureReason"];
};

type PhysicalNoteUpdateData = Partial<Pick<
  HostedPhysicalNote,
  | "acceptedAt"
  | "complimentaryOfferCode"
  | "failureReason"
  | "providerLetterId"
  | "status"
>>;

type PhysicalNoteRecoveryCreateData = Pick<
  HostedPhysicalNoteRecovery,
  "memberId" | "originAssistantInputId"
> & Partial<Pick<
  HostedPhysicalNoteRecovery,
  | "physicalNoteId"
  | "remainingUnresolved"
  | "resultStatus"
  | "retryAfter"
  | "settledUsageCostUsdMicros"
>>;

type PhysicalNoteRecoveryUpdateData = Partial<Pick<
  HostedPhysicalNoteRecovery,
  | "remainingUnresolved"
  | "resultStatus"
  | "retryAfter"
  | "settledUsageCostUsdMicros"
>>;

type PhysicalNoteRecoveryWhere = Partial<Pick<
  HostedPhysicalNoteRecovery,
  "memberId" | "originAssistantInputId" | "physicalNoteId" | "resultStatus"
>>;

interface PhysicalNoteStore {
  allRecoveries(): HostedPhysicalNoteRecovery[];
  allRows(): HostedPhysicalNote[];
  failNextRecoveryCompletion(): void;
  prisma: PrismaClient;
  queueFindFirstRowIds(...ids: string[]): void;
  setCreatedAt(id: string, createdAt: Date): void;
  setFailureReason(
    id: string,
    failureReason: HostedPhysicalNote["failureReason"],
  ): void;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("LOB_API_KEY", "test_physical_notes");
  vi.stubEnv("LOB_FROM_ADDRESS_ID", "adr_from_test");
  vi.stubEnv(
    "LOB_PHYSICAL_NOTE_COST_USD_MICROS",
    COST_USD_MICROS.toString(),
  );
  vi.stubEnv("LOB_PHYSICAL_NOTE_PRICING_VERSION", "lob-test-v1");

  mocks.assertActiveAccess.mockResolvedValue(undefined);
  mocks.assertGroupOrigin.mockResolvedValue(undefined);
  mocks.getPrisma.mockImplementation(() => {
    throw new Error("tests must pass an explicit physical-note store");
  });
  mocks.isThreadContainerDestination.mockReturnValue(false);
  mocks.lockMember.mockResolvedValue(undefined);
  mocks.readActiveAccess.mockResolvedValue(true);
  mocks.readUsageGate.mockResolvedValue({
    allowed: true,
    periodEnd: DEFAULT_PERIOD_END,
    periodStart: DEFAULT_PERIOD_START,
    remainingUsdMicros: 1_000_000n,
  });
  mocks.recordUsage.mockResolvedValue(undefined);
  mocks.requireDestination.mockResolvedValue({
    conversationShape: "direct-member",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createHostedPhysicalNote", () => {
  it("sends the first note as a complimentary note without touching usage", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_free" },
    ]);
    const request = buildRequest(1);

    const response = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
      signal: new AbortController().signal,
    });

    expect(response).toEqual({
      complimentary: true,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(store.allRows()).toEqual([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        id: response.physicalNoteId,
        providerLetterId: "ltr_free",
        status: "accepted",
      }),
    ]);
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
    expect(provider.create).toHaveBeenCalledWith({
      artworkUrl: request.artwork.url,
      idempotencyKey: response.physicalNoteId,
      noteId: response.physicalNoteId,
      recipient: request.recipient,
      signal: undefined,
    });
  });

  it("records subsequent accepted notes through the existing usage ledger", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_free" },
      { kind: "accepted", providerLetterId: "ltr_paid" },
    ]);

    await createHostedPhysicalNote({
      ...buildRequest(1),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const paidResponse = await createHostedPhysicalNote({
      ...buildRequest(2),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const paidReplay = await createHostedPhysicalNote({
      ...buildRequest(2),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(paidResponse).toEqual({
      complimentary: false,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(paidReplay).toEqual(paidResponse);
    expect(mocks.readUsageGate).toHaveBeenCalledOnce();
    const paidRow = store.allRows().find(
      (row) => row.id === paidResponse.physicalNoteId,
    );
    expect(paidRow).toBeDefined();
    expect(mocks.recordUsage).toHaveBeenCalledWith({
      accountAllowance: true,
      prisma: expect.anything(),
      trustedUserId: MEMBER_ID,
      usage: [
        expect.objectContaining({
          featureKey: "physical-note",
          occurredAt: paidRow?.createdAt.toISOString(),
          provider: "lob",
          providerRequestId: "ltr_paid",
          rawUsageJson: {
            providerCostUsdMicros: Number(COST_USD_MICROS),
            providerPricingVersion: "lob-test-v1",
          },
        }),
      ],
    });
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(paidRow).toMatchObject({
      complimentaryOfferCode: null,
      providerLetterId: "ltr_paid",
      status: "accepted",
    });
  });

  it("replays an accepted request without another provider send", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_replay" },
    ]);
    const request = buildRequest(3);

    const first = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    vi.stubEnv("LOB_API_KEY", "");
    const replay = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(replay).toEqual(first);
    expect(provider.create).toHaveBeenCalledOnce();
    expect(store.allRows()).toHaveLength(1);
  });

  it("fails closed without reserving a note when provider configuration is unavailable", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_unexpected" },
    ]);
    vi.stubEnv("LOB_API_KEY", "");

    await expect(createHostedPhysicalNote({
      ...buildRequest(30),
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      complimentary: false,
      costUsdMicros: "0",
      physicalNoteId: null,
      status: "unavailable",
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual([]);
  });

  it("rejects expiring artwork before reserving provider authority", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_unexpected" },
    ]);

    await expect(createHostedPhysicalNote({
      ...buildRequest(32),
      artwork: {
        ...buildRequest(32).artwork,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      prisma: store.prisma,
      runtime: provider.runtime,
    })).rejects.toThrow("Physical-note artwork URL expires too soon.");
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual([]);
  });

  it("does not create a group reservation when final participant authority is denied", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_unexpected" },
    ]);
    mocks.isThreadContainerDestination.mockReturnValue(true);
    mocks.requireDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        accountLookupKey: "group_account",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: "thread_physical_note",
      },
    });
    mocks.assertGroupOrigin
      .mockResolvedValueOnce(MEMBER_ID)
      .mockRejectedValueOnce(hostedOnboardingError({
        code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
        httpStatus: 403,
        message: "Current participant authority is required.",
        retryable: false,
      }));

    await expect(createHostedPhysicalNote({
      ...buildRequest(31),
      prisma: store.prisma,
      runtime: provider.runtime,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
      httpStatus: 403,
    });
    expect(mocks.assertGroupOrigin).toHaveBeenCalledTimes(2);
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual([]);
  });

  it("checks cancellation after final group authority and before reserving", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_unexpected" },
    ]);
    const controller = new AbortController();
    mocks.isThreadContainerDestination.mockReturnValue(true);
    mocks.requireDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        accountLookupKey: "group_account",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: "thread_physical_note",
      },
    });
    mocks.assertGroupOrigin
      .mockResolvedValueOnce(MEMBER_ID)
      .mockImplementationOnce(async () => {
        controller.abort();
        return MEMBER_ID;
      });

    await expect(createHostedPhysicalNote({
      ...buildRequest(33),
      prisma: store.prisma,
      runtime: provider.runtime,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual([]);
  });

  it("finishes dispatch when caller cancellation arrives after admission begins", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_unexpected" },
    ]);
    const controller = new AbortController();
    mocks.readActiveAccess.mockImplementationOnce(async () => {
      controller.abort();
      return true;
    });

    await expect(createHostedPhysicalNote({
      ...buildRequest(33),
      prisma: store.prisma,
      runtime: provider.runtime,
      signal: controller.signal,
    })).resolves.toMatchObject({
      complimentary: true,
      status: "accepted",
    });

    expect(provider.create).toHaveBeenCalledOnce();
    expect(store.allRows()).toEqual([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: "ltr_unexpected",
        status: "accepted",
      }),
    ]);
  });

  it("allows a group note through participant-backed access", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_group_participant" },
    ]);
    mocks.isThreadContainerDestination.mockReturnValue(true);
    mocks.requireDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        accountLookupKey: "group_account",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: "thread_physical_note",
      },
    });
    mocks.assertGroupOrigin.mockResolvedValue(MEMBER_ID);
    mocks.readActiveAccess.mockResolvedValue(true);
    mocks.assertActiveAccess.mockRejectedValue(
      new Error("owner-only access fallback should not run"),
    );

    await expect(createHostedPhysicalNote({
      ...buildRequest(32),
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({
      complimentary: true,
      status: "accepted",
    });

    expect(mocks.readActiveAccess).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
    });
    expect(mocks.assertActiveAccess).not.toHaveBeenCalled();
    expect(mocks.assertGroupOrigin).toHaveBeenCalledTimes(2);
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it("rejects reuse of a request key for different note content", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_collision" },
    ]);
    const request = buildRequest(4);

    await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    await expect(createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      recipient: {
        ...request.recipient,
        addressLine1: "456 Different Street",
      },
      runtime: provider.runtime,
    })).rejects.toThrow("Hosted physical-note request key collision.");
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it("releases the complimentary offer after a definite provider failure", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        {
          kind: "definite_failure",
          reason: "recipient_address",
          status: 422,
        },
        { kind: "accepted", providerLetterId: "ltr_retry" },
      ],
      [{ kind: "absent" }],
    );
    const failedRequest = buildRequest(5);

    const failed = await createHostedPhysicalNote({
      ...failedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const replay = await createHostedPhysicalNote({
      ...failedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setFailureReason(failed.physicalNoteId!, null);
    store.setCreatedAt(
      failed.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const legacyReplay = await createHostedPhysicalNote({
      ...failedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const retry = await createHostedPhysicalNote({
      ...buildRequest(6),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(failed).toMatchObject({
      failureReason: "recipient_address",
      status: "failed",
    });
    expect(replay).toEqual(failed);
    expect(legacyReplay).toMatchObject({
      failureReason: "unknown",
      status: "failed",
    });
    expect(retry).toEqual({
      complimentary: true,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(store.allRows().find(
      (row) => row.id === failed.physicalNoteId,
    )).toMatchObject({
      complimentaryOfferCode: null,
      failureReason: "unknown",
      status: "failed",
    });
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
  });

  it("keeps unresolved legacy failures pending and blocks later sends", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [{
        kind: "definite_failure",
        reason: "unknown",
        status: 422,
      }],
      [{ kind: "indeterminate" }],
    );
    const failedRequest = buildRequest(60);
    const failed = await createHostedPhysicalNote({
      ...failedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setFailureReason(failed.physicalNoteId!, null);
    provider.create.mockClear();

    const tooRecent = await createHostedPhysicalNote({
      ...failedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(tooRecent).toMatchObject({
      physicalNoteId: failed.physicalNoteId,
      status: "pending",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();

    const recentBlockedRequest = buildRequest(61);
    const recentBlocked = await createHostedPhysicalNote({
      ...recentBlockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(recentBlocked).toMatchObject({
      failureReason: "prior_note_unresolved",
      status: "failed",
    });
    expect(recentBlocked.physicalNoteId).not.toBe(failed.physicalNoteId);
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();
    const recentReplay = await createHostedPhysicalNote({
      ...recentBlockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(recentReplay).toEqual(recentBlocked);

    store.setCreatedAt(
      failed.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const blockedRequest = buildRequest(64);
    const indeterminate = await createHostedPhysicalNote({
      ...blockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(indeterminate).toMatchObject({
      failureReason: "prior_note_unresolved",
      status: "failed",
    });
    expect(indeterminate.physicalNoteId).not.toBe(failed.physicalNoteId);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        complimentaryOfferCode: null,
        failureReason: null,
        status: "failed",
      }),
      expect.objectContaining({
        failureReason: "prior_note_unresolved",
        id: indeterminate.physicalNoteId,
        requestKey: blockedRequest.requestKey,
        status: "failed",
      }),
      expect.objectContaining({
        failureReason: "prior_note_unresolved",
        id: recentBlocked.physicalNoteId,
        requestKey: recentBlockedRequest.requestKey,
        status: "failed",
      }),
    ]));
    const replay = await createHostedPhysicalNote({
      ...blockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(replay).toEqual(indeterminate);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("restores a provider-accepted legacy row without another send or charge", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        {
          kind: "definite_failure",
          reason: "unknown",
          status: 422,
        },
        { kind: "accepted", providerLetterId: "ltr_later" },
      ],
      [{ kind: "accepted", providerLetterId: "ltr_legacy" }],
    );
    const legacyRequest = buildRequest(62);
    const failed = await createHostedPhysicalNote({
      ...legacyRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setFailureReason(failed.physicalNoteId!, null);
    store.setCreatedAt(
      failed.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    provider.create.mockClear();

    const blockedRequest = buildRequest(63);
    const response = await createHostedPhysicalNote({
      ...blockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toMatchObject({
      complimentary: false,
      failureReason: "prior_note_accepted",
      status: "failed",
    });
    expect(response.physicalNoteId).not.toBe(failed.physicalNoteId);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        failureReason: "prior_note_accepted",
        id: failed.physicalNoteId,
        providerLetterId: "ltr_legacy",
        status: "accepted",
      }),
      expect.objectContaining({
        complimentaryOfferCode: null,
        failureReason: "prior_note_accepted",
        id: response.physicalNoteId,
        requestKey: blockedRequest.requestKey,
        status: "failed",
      }),
    ]));
    const replay = await createHostedPhysicalNote({
      ...blockedRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const legacyReplay = await createHostedPhysicalNote({
      ...legacyRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const laterRequest = {
      ...buildRequest(67),
      originAssistantInputId: `ain_${"2".repeat(32)}`,
      recipient: {
        addressLine1: "456 Different Street",
        city: "Chicago",
        name: "Taylor Example",
        postalCode: "60601",
        state: "IL",
      },
    };
    expect(mocks.recordUsage).not.toHaveBeenCalled();
    const laterResponse = await createHostedPhysicalNote({
      ...laterRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const laterReplay = await createHostedPhysicalNote({
      ...laterRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(replay).toEqual(response);
    expect(legacyReplay).toMatchObject({
      failureReason: "prior_note_accepted",
      physicalNoteId: failed.physicalNoteId,
      status: "accepted",
    });
    expect(laterResponse).toMatchObject({
      complimentary: false,
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(laterResponse.physicalNoteId).not.toBe(failed.physicalNoteId);
    expect(laterResponse.physicalNoteId).not.toBe(response.physicalNoteId);
    expect(laterReplay).toEqual(laterResponse);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("does not reconstruct paid usage for a restored legacy acceptance", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        { kind: "accepted", providerLetterId: "ltr_complimentary" },
        {
          kind: "definite_failure",
          reason: "unknown",
          status: 422,
        },
        { kind: "accepted", providerLetterId: "ltr_later_paid" },
      ],
      [{ kind: "accepted", providerLetterId: "ltr_legacy_paid_unknown" }],
    );
    const complimentary = await createHostedPhysicalNote({
      ...buildRequest(65),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const legacyRequest = buildRequest(66);
    const failed = await createHostedPhysicalNote({
      ...legacyRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setFailureReason(failed.physicalNoteId!, null);
    store.setCreatedAt(
      failed.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    provider.create.mockClear();

    const response = await createHostedPhysicalNote({
      ...legacyRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const replay = await createHostedPhysicalNote({
      ...legacyRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const laterRequest = {
      ...buildRequest(69),
      originAssistantInputId: `ain_${"3".repeat(32)}`,
      recipient: {
        addressLine1: "456 Different Street",
        city: "Chicago",
        name: "Taylor Example",
        postalCode: "60601",
        state: "IL",
      },
    };
    const laterResponse = await createHostedPhysicalNote({
      ...laterRequest,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toMatchObject({
      complimentary: false,
      failureReason: "prior_note_accepted",
      physicalNoteId: failed.physicalNoteId,
      status: "accepted",
    });
    expect(replay).toEqual(response);
    expect(laterResponse).toMatchObject({
      complimentary: false,
      status: "accepted",
    });
    expect(store.allRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        id: complimentary.physicalNoteId,
        status: "accepted",
      }),
      expect.objectContaining({
        complimentaryOfferCode: null,
        id: failed.physicalNoteId,
        providerLetterId: "ltr_legacy_paid_unknown",
        status: "accepted",
      }),
    ]));
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("keeps ambiguous provider authority pending and reserves the offer", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "ambiguous_failure" },
    ]);

    const response = await createHostedPhysicalNote({
      ...buildRequest(7),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toEqual({
      complimentary: true,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "pending",
    });
    expect(store.allRows()).toEqual([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: null,
        status: "starting",
      }),
    ]);
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("never resends an HTTP 408 reservation and suppresses accepted reconciliation", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      error: {
        code: "request_timeout",
        message: "provider detail",
        status_code: 408,
      },
    }, { status: 408 }));
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    const request = buildRequest(70);
    const response = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime,
    });
    const replay = await createHostedPhysicalNote({
      ...request,
      artwork: {
        ...request.artwork,
        url: "https://assets.example.test/refreshed-capability.png",
      },
      prisma: store.prisma,
      runtime,
    });

    expect(response).toMatchObject({
      complimentary: true,
      status: "pending",
    });
    expect(replay).toEqual(response);
    expect(store.allRows()).toEqual([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        failureReason: null,
        providerLetterId: null,
        status: "starting",
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    store.setCreatedAt(
      response.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const provider = createPhysicalNoteRuntime(
      [],
      [{ kind: "accepted", providerLetterId: "ltr_stale_free" }],
    );
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(71),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(blocked).toMatchObject({
      failureReason: "prior_note_accepted",
      status: "failed",
    });
    expect(blocked.physicalNoteId).not.toBe(response.physicalNoteId);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: response.physicalNoteId,
      signal: undefined,
    });
    expect(store.allRows().find((row) => row.id === response.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: "ltr_stale_free",
        status: "accepted",
      });
    expect(store.allRows().find((row) => row.id === blocked.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: null,
        failureReason: "prior_note_accepted",
        providerLetterId: null,
        status: "failed",
      });
    expect(store.allRows()).toHaveLength(2);
    expect(provider.create).not.toHaveBeenCalled();
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("keeps the request that proves stale absence unsent", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        { kind: "ambiguous_failure" },
        { kind: "accepted", providerLetterId: "ltr_reclaimed_free" },
      ],
      [{ kind: "absent" }],
    );

    const stale = await createHostedPhysicalNote({
      ...buildRequest(52),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setCreatedAt(
      stale.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    provider.create.mockClear();
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(53),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(blocked).toMatchObject({
      failureReason: "unknown",
      status: "failed",
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.allRows().find((row) => row.id === stale.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: null,
        failureReason: "unknown",
        providerLetterId: null,
        status: "failed",
      });
    const later = await createHostedPhysicalNote({
      ...buildRequest(57),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(later).toMatchObject({
      complimentary: true,
      status: "accepted",
    });
    expect(provider.create).toHaveBeenCalledOnce();
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("blocks recent and indeterminate requests behind ambiguous authority", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [{ kind: "ambiguous_failure" }],
      [{ kind: "indeterminate" }],
    );

    const stale = await createHostedPhysicalNote({
      ...buildRequest(54),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    provider.create.mockClear();
    const recent = await createHostedPhysicalNote({
      ...buildRequest(55),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(recent).toMatchObject({
      failureReason: "prior_note_unresolved",
      status: "failed",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();

    store.setCreatedAt(
      stale.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const indeterminate = await createHostedPhysicalNote({
      ...buildRequest(58),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(indeterminate).toMatchObject({
      failureReason: "prior_note_unresolved",
      status: "failed",
    });
    expect(store.allRows().find((row) => row.id === stale.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: null,
        status: "starting",
      });

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("keeps recent same-request replay pending after indeterminate evidence", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [{ kind: "ambiguous_failure" }],
      [{ kind: "indeterminate" }],
    );
    const request = buildRequest(56);

    await expect(createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({ status: "pending" });
    await expect(createHostedPhysicalNote({
      ...request,
      artwork: {
        ...request.artwork,
        url: "https://assets.example.test/refreshed-replay-capability.png",
      },
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({
      complimentary: true,
      status: "pending",
    });

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledOnce();
    expect(store.allRows()).toHaveLength(1);
  });

  it("finalizes accepted evidence on exact paid replay without another create", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        { kind: "accepted", providerLetterId: "ltr_free_before_recovery" },
        { kind: "ambiguous_failure" },
      ],
      [{ kind: "accepted", providerLetterId: "ltr_recovered_paid" }],
    );
    await createHostedPhysicalNote({
      ...buildRequest(72),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const request = buildRequest(73);
    const pending = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(pending).toMatchObject({
      complimentary: false,
      status: "pending",
    });
    mocks.recordUsage.mockClear();

    const recovered = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const replay = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(recovered).toMatchObject({
      complimentary: false,
      physicalNoteId: pending.physicalNoteId,
      status: "accepted",
    });
    expect(replay).toEqual(recovered);
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: pending.physicalNoteId,
      signal: undefined,
    });
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it.each([
    {
      age: "recent",
      createdAt: new Date(),
      expectedReason: undefined,
      expectedStatus: "pending" as const,
    },
    {
      age: "aged",
      createdAt: new Date(Date.now() - REPLAY_WINDOW_MS - 1),
      expectedReason: "unknown" as const,
      expectedStatus: "failed" as const,
    },
  ])(
    "keeps an exact $age replay unsent after provider absence",
    async ({ createdAt, expectedReason, expectedStatus }) => {
      const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
      const store = createPhysicalNoteStore();
      const provider = createPhysicalNoteRuntime(
        [{ kind: "ambiguous_failure" }],
        [{ kind: "absent" }],
      );
      const request = buildRequest(74);
      const pending = await createHostedPhysicalNote({
        ...request,
        prisma: store.prisma,
        runtime: provider.runtime,
      });
      const pendingId = pending.physicalNoteId;
      if (!pendingId) {
        throw new Error("Expected a persisted physical-note reservation.");
      }
      store.setCreatedAt(pendingId, createdAt);

      const replay = await createHostedPhysicalNote({
        ...request,
        prisma: store.prisma,
        runtime: provider.runtime,
      });

      expect(replay).toMatchObject({
        ...(expectedReason ? { failureReason: expectedReason } : {}),
        physicalNoteId: pending.physicalNoteId,
        status: expectedStatus,
      });
      expect(provider.create).toHaveBeenCalledOnce();
      expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
      expect(mocks.recordUsage).not.toHaveBeenCalled();
      expect(store.allRows()).toHaveLength(1);
    },
  );

  it("does not reserve or send a paid note when remaining usage is insufficient", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_free" },
    ]);

    await createHostedPhysicalNote({
      ...buildRequest(8),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    mocks.readUsageGate.mockResolvedValueOnce({
      allowed: true,
      periodEnd: DEFAULT_PERIOD_END,
      periodStart: DEFAULT_PERIOD_START,
      remainingUsdMicros: COST_USD_MICROS - 1n,
    });

    const response = await createHostedPhysicalNote({
      ...buildRequest(9),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toEqual({
      complimentary: false,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    });
    expect(provider.create).toHaveBeenCalledOnce();
    expect(store.allRows()).toHaveLength(1);
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });
});

describe("recoverHostedPhysicalNote", () => {
  it("returns unconfirmed without a provider read when no target or guard exists", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([]);
    const originAssistantInputId = recoveryOrigin(200);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(provider.create).not.toHaveBeenCalled();

    const laterFailure = createPhysicalNoteRuntime([{
      kind: "definite_failure",
      reason: "unknown",
      status: 422,
    }]);
    const later = await createHostedPhysicalNote({
      ...buildRequest(200),
      prisma: store.prisma,
      runtime: laterFailure.runtime,
    });
    store.setFailureReason(later.physicalNoteId!, null);
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(store.allRows().find((row) => row.id === later.physicalNoteId))
      .toMatchObject({ failureReason: null, status: "failed" });
  });

  it("replays one accepted recovery input without advancing another guard", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(214);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(215),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    const blockedId = blocked.physicalNoteId!;
    store.setFailureReason(blockedId, null);
    store.setCreatedAt(
      guardId,
      new Date(store.allRows().find((row) => row.id === blockedId)!.createdAt.getTime() - 1),
    );
    const firstOrigin = recoveryOrigin(214);
    const firstProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_replay_first_guard",
    }]);

    const first = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: firstOrigin,
      prisma: store.prisma,
      runtime: firstProvider.runtime,
    });
    const replay = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: firstOrigin,
      prisma: store.prisma,
      runtime: firstProvider.runtime,
    });

    expect(first).toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(replay).toEqual(first);
    expect(firstProvider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRecoveries()).toEqual([
      expect.objectContaining({
        originAssistantInputId: firstOrigin,
        physicalNoteId: guardId,
        resultStatus: "accepted",
      }),
    ]);

    const secondProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_new_input_second_guard",
    }]);
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(215),
      prisma: store.prisma,
      runtime: secondProvider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(secondProvider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      providerLetterId: "ltr_new_input_second_guard",
      status: "accepted",
    });
  });

  it("rolls back terminal recovery when result persistence fails", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(216);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(217),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    const blockedId = blocked.physicalNoteId!;
    store.setFailureReason(blockedId, null);
    store.setCreatedAt(
      guardId,
      new Date(store.allRows().find((row) => row.id === blockedId)!.createdAt.getTime() - 1),
    );
    const originAssistantInputId = recoveryOrigin(216);
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_interrupted_first_guard",
    }]);
    store.failNextRecoveryCompletion();

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).rejects.toThrow("simulated recovery result persistence failure");

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRecoveries()).toEqual([
      expect.objectContaining({
        originAssistantInputId,
        physicalNoteId: guardId,
        resultStatus: null,
        settledUsageCostUsdMicros: null,
      }),
    ]);

    const retryProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_retry_first_guard",
    }]);
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: retryProvider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(retryProvider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: guardId,
      signal: undefined,
    });
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
  });

  it("rolls back an aged absence and blocker cleanup when result persistence fails", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(218);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(219),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    const blockedId = blocked.physicalNoteId!;
    store.setCreatedAt(
      guardId,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const originAssistantInputId = recoveryOrigin(218);
    const provider = createPhysicalNoteRuntime([], [{ kind: "absent" }]);
    store.failNextRecoveryCompletion();

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).rejects.toThrow("simulated recovery result persistence failure");

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      failureReason: "prior_note_unresolved",
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRecoveries()).toEqual([
      expect.objectContaining({
        originAssistantInputId,
        physicalNoteId: guardId,
        resultStatus: null,
      }),
    ]);

    const retryProvider = createPhysicalNoteRuntime([], [{ kind: "absent" }]);
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: retryProvider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "clear",
    });
    expect(store.allRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureReason: "unknown", id: guardId }),
      expect.objectContaining({ failureReason: "unknown", id: blockedId }),
    ]));
  });

  it("restores accepted provider evidence without sending another note", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(201);
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_recovered",
    }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(201).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: "prior_note_accepted",
      providerLetterId: "ltr_recovered",
      status: "accepted",
    });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("keeps complimentary accepted recovery usage-free on replay", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const sendProvider = createPhysicalNoteRuntime([{ kind: "ambiguous_failure" }]);
    const pending = await createHostedPhysicalNote({
      ...buildRequest(220),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    expect(pending).toMatchObject({ complimentary: true, status: "pending" });
    const originAssistantInputId = recoveryOrigin(220);
    const recoveryProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_recovery_complimentary_acceptance",
    }]);

    const recovered = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
    });
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
    })).resolves.toEqual(recovered);

    expect(recovered).toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(store.allRecoveries()).toEqual([
      expect.objectContaining({
        originAssistantInputId,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: null,
      }),
    ]);
    expect(recoveryProvider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("replays a paid accepted recovery without settling usage twice", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const sendProvider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_recovery_free_seed" },
      { kind: "ambiguous_failure" },
    ]);
    await createHostedPhysicalNote({
      ...buildRequest(218),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    const pending = await createHostedPhysicalNote({
      ...buildRequest(219),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    expect(pending).toMatchObject({ complimentary: false, status: "pending" });
    const originAssistantInputId = recoveryOrigin(219);
    const recoveryProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_recovery_paid_acceptance",
    }]);

    const recovered = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
    });
    const replay = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
    });

    expect(recovered).toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: COST_USD_MICROS.toString(),
      status: "accepted",
    });
    expect(replay).toEqual(recovered);
    expect(store.allRecoveries()).toEqual([
      expect.objectContaining({
        originAssistantInputId,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: COST_USD_MICROS,
      }),
    ]);
    expect(recoveryProvider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("replays a targeted accepted recovery result after the response is lost", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const sendProvider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_recovery_target_free_seed" },
      { kind: "ambiguous_failure" },
    ]);
    await createHostedPhysicalNote({
      ...buildRequest(221),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    const pending = await createHostedPhysicalNote({
      ...buildRequest(222),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    expect(pending).toMatchObject({ complimentary: false, status: "pending" });
    const targetOrigin = recoveryOrigin(222);
    const followupOrigin = recoveryOrigin(223);
    const recoveryProvider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_targeted_recovery_acceptance",
    }]);
    const accepted = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: targetOrigin,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
    });

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: followupOrigin,
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
      targetOriginAssistantInputId: targetOrigin,
    })).resolves.toEqual(accepted);

    expect(accepted).toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: COST_USD_MICROS.toString(),
      status: "accepted",
    });
    expect(recoveryProvider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
    expect(store.allRecoveries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originAssistantInputId: targetOrigin,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: COST_USD_MICROS,
      }),
      expect.objectContaining({
        originAssistantInputId: followupOrigin,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: COST_USD_MICROS,
      }),
    ]));
  });

  it("reports a targeted accepted send after its original response was lost", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const targetOrigin = recoveryOrigin(224);
    const sendProvider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_target_send_free_seed" },
      { kind: "accepted", providerLetterId: "ltr_target_send_paid" },
    ]);
    await createHostedPhysicalNote({
      ...buildRequest(223),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    await createHostedPhysicalNote({
      ...buildRequest(224),
      originAssistantInputId: targetOrigin,
      requestKey: createHostedPhysicalNoteRequestKey({
        originAssistantInputId: targetOrigin,
      }),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    const recoveryProvider = createPhysicalNoteRuntime([]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(225),
      prisma: store.prisma,
      runtime: recoveryProvider.runtime,
      targetOriginAssistantInputId: targetOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: COST_USD_MICROS.toString(),
      status: "accepted",
    });
    expect(recoveryProvider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("targets an incomplete prior recovery without advancing the oldest guard", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(226);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(227),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    const blockedId = blocked.physicalNoteId!;
    store.setFailureReason(blockedId, null);
    store.setCreatedAt(
      guardId,
      new Date(store.allRows().find((row) => row.id === blockedId)!.createdAt.getTime() - 1),
    );
    const targetOrigin = recoveryOrigin(226);
    await store.prisma.hostedPhysicalNoteRecovery.create({
      data: {
        memberId: MEMBER_ID,
        originAssistantInputId: targetOrigin,
        physicalNoteId: blockedId,
      },
    });
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_targeted_incomplete_recovery",
    }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(227),
      prisma: store.prisma,
      runtime: provider.runtime,
      targetOriginAssistantInputId: targetOrigin,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });

    expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: blockedId,
      signal: undefined,
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      providerLetterId: null,
      status: "failed",
    });
    expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
      providerLetterId: "ltr_targeted_incomplete_recovery",
      status: "accepted",
    });
  });

  it.each([
    {
      providerLetterId: "ltr_targeted_pending_recovery",
      resultStatus: "pending" as const,
      retryAfter: new Date(Date.now() - 1_000),
      sequence: 240,
    },
    {
      providerLetterId: "ltr_targeted_unavailable_recovery",
      resultStatus: "unavailable" as const,
      retryAfter: null,
      sequence: 242,
    },
  ])(
    "rechecks a targeted $resultStatus recovery against its stored note",
    async ({ providerLetterId, resultStatus, retryAfter, sequence }) => {
      const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
      const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
      const { guardId, store } = await createLegacyPhysicalNoteGuard(sequence);
      const blocked = await createHostedPhysicalNote({
        ...buildRequest(sequence + 1),
        prisma: store.prisma,
        runtime: createPhysicalNoteRuntime([]).runtime,
      });
      const blockedId = blocked.physicalNoteId!;
      store.setFailureReason(blockedId, null);
      store.setCreatedAt(
        guardId,
        new Date(
          store.allRows().find((row) => row.id === blockedId)!.createdAt.getTime()
            - 1,
        ),
      );
      const targetOrigin = recoveryOrigin(sequence);
      await store.prisma.hostedPhysicalNoteRecovery.create({
        data: {
          memberId: MEMBER_ID,
          originAssistantInputId: targetOrigin,
          physicalNoteId: blockedId,
          remainingUnresolved: true,
          resultStatus,
          retryAfter,
        },
      });
      const provider = createPhysicalNoteRuntime([], [{
        kind: "accepted",
        providerLetterId,
      }]);

      await expect(recoverHostedPhysicalNote({
        memberId: MEMBER_ID,
        originAssistantInputId: recoveryOrigin(sequence + 2),
        prisma: store.prisma,
        runtime: provider.runtime,
        targetOriginAssistantInputId: targetOrigin,
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });

      expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
        noteId: blockedId,
        signal: undefined,
      });
      expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
        failureReason: null,
        providerLetterId: null,
        status: "failed",
      });
      expect(store.allRows().find((row) => row.id === blockedId)).toMatchObject({
        providerLetterId,
        status: "accepted",
      });
    },
  );

  it.each([
    {
      resultStatus: "pending" as const,
      retryAfter: new Date(Date.now() + 60_000),
      sequence: 244,
    },
    {
      resultStatus: "unavailable" as const,
      retryAfter: null,
      sequence: 245,
    },
  ])(
    "replays the same $resultStatus recovery input without a provider read",
    async ({ resultStatus, retryAfter, sequence }) => {
      const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
      const { guardId, store } = await createLegacyPhysicalNoteGuard(sequence);
      const originAssistantInputId = recoveryOrigin(sequence);
      await store.prisma.hostedPhysicalNoteRecovery.create({
        data: {
          memberId: MEMBER_ID,
          originAssistantInputId,
          physicalNoteId: guardId,
          remainingUnresolved: true,
          resultStatus,
          retryAfter,
        },
      });
      const provider = createPhysicalNoteRuntime([], [{
        kind: "accepted",
        providerLetterId: "ltr_same_input_must_not_lookup",
      }]);

      await expect(recoverHostedPhysicalNote({
        memberId: MEMBER_ID,
        originAssistantInputId,
        prisma: store.prisma,
        runtime: provider.runtime,
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: retryAfter?.toISOString() ?? null,
        settledUsageCostUsdMicros: null,
        status: resultStatus,
      });
      expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    },
  );

  it("keeps a targeted nonterminal recovery with a missing note pointer unconfirmed", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const targetOrigin = recoveryOrigin(246);
    await store.prisma.hostedPhysicalNoteRecovery.create({
      data: {
        memberId: MEMBER_ID,
        originAssistantInputId: targetOrigin,
        physicalNoteId: "hpn_missing_physical_note",
        remainingUnresolved: true,
        resultStatus: "pending",
      },
    });
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_missing_pointer_must_not_lookup",
    }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(247),
      prisma: store.prisma,
      runtime: provider.runtime,
      targetOriginAssistantInputId: targetOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
  });

  it("keeps unknown and cross-member recovery targets unconfirmed", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const unknownTargetOrigin = recoveryOrigin(238);
    const crossMemberTargetOrigin = recoveryOrigin(239);
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_must_not_lookup_unknown_target",
    }]);
    await store.prisma.hostedPhysicalNoteRecovery.create({
      data: {
        memberId: "member_other_physical_note",
        originAssistantInputId: crossMemberTargetOrigin,
      },
    });

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(228),
      prisma: store.prisma,
      runtime: provider.runtime,
      targetOriginAssistantInputId: unknownTargetOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(229),
      prisma: store.prisma,
      runtime: provider.runtime,
      targetOriginAssistantInputId: crossMemberTargetOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });

    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(store.allRecoveries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memberId: MEMBER_ID,
        originAssistantInputId: recoveryOrigin(228),
        physicalNoteId: null,
        resultStatus: "pending",
      }),
      expect.objectContaining({
        memberId: MEMBER_ID,
        originAssistantInputId: recoveryOrigin(229),
        physicalNoteId: null,
        resultStatus: "pending",
      }),
    ]));
  });

  it("keeps targeted complimentary and legacy accepted sends usage-free", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const complimentaryOrigin = recoveryOrigin(230);
    const legacyOrigin = recoveryOrigin(231);
    const sendProvider = createPhysicalNoteRuntime([{
      kind: "accepted",
      providerLetterId: "ltr_target_complimentary",
    }]);
    await createHostedPhysicalNote({
      ...buildRequest(230),
      originAssistantInputId: complimentaryOrigin,
      requestKey: createHostedPhysicalNoteRequestKey({
        originAssistantInputId: complimentaryOrigin,
      }),
      prisma: store.prisma,
      runtime: sendProvider.runtime,
    });
    const legacy = await createHostedPhysicalNote({
      ...buildRequest(231),
      originAssistantInputId: legacyOrigin,
      requestKey: createHostedPhysicalNoteRequestKey({
        originAssistantInputId: legacyOrigin,
      }),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([{
        kind: "definite_failure",
        reason: "unknown",
        status: 422,
      }]).runtime,
    });
    const legacyPhysicalNoteId = legacy.physicalNoteId!;
    store.setFailureReason(legacyPhysicalNoteId, "prior_note_accepted");
    await store.prisma.hostedPhysicalNote.updateMany({
      data: {
        acceptedAt: new Date(),
        providerLetterId: "ltr_target_legacy",
        status: "accepted",
      },
      where: { id: legacyPhysicalNoteId },
    });

    const runtime = createPhysicalNoteRuntime([]);
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(232),
      prisma: store.prisma,
      runtime: runtime.runtime,
      targetOriginAssistantInputId: complimentaryOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: recoveryOrigin(233),
      prisma: store.prisma,
      runtime: runtime.runtime,
      targetOriginAssistantInputId: legacyOrigin,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });

    expect(runtime.findLetterByNoteId).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("reports accepted evidence separately when another guard remains", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(210);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(211),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    store.setFailureReason(blocked.physicalNoteId!, null);
    const blockedCreatedAt = store.allRows().find(
      (row) => row.id === blocked.physicalNoteId,
    )!.createdAt;
    store.setCreatedAt(guardId, new Date(blockedCreatedAt.getTime() - 1));
    const provider = createPhysicalNoteRuntime([], [{
      kind: "accepted",
      providerLetterId: "ltr_recovered_with_remaining",
    }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(210).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: "prior_note_accepted",
      providerLetterId: "ltr_recovered_with_remaining",
      status: "accepted",
    });
    expect(store.allRows().find(
      (row) => row.id === blocked.physicalNoteId,
    )).toMatchObject({
      failureReason: null,
      status: "failed",
    });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("keeps recent absence pending until the existing safety window ends", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(202);
    const provider = createPhysicalNoteRuntime([], [{ kind: "absent" }]);

    const response = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(202).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toEqual({
      remainingUnresolved: true,
      retryAfter: expect.stringMatching(/Z$/u),
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(new Date(response.retryAfter!).getTime()).toBeGreaterThan(Date.now());
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      status: "failed",
    });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("keeps the checked tied guard pending when the aggregate reread selects another row", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(212);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(213),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([]).runtime,
    });
    const blockedId = blocked.physicalNoteId!;
    const tiedCreatedAt = new Date(Date.now() - REPLAY_WINDOW_MS - 1);
    store.setFailureReason(blockedId, null);
    store.setCreatedAt(guardId, tiedCreatedAt);
    store.setCreatedAt(blockedId, tiedCreatedAt);
    store.queueFindFirstRowIds(guardId, blockedId);
    const provider = createPhysicalNoteRuntime([], [{ kind: "indeterminate" }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(212).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: guardId,
      signal: undefined,
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      status: "failed",
    });
  });

  it("clears an aged proven absence and its unsent blocker", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(203);
    const blockedProvider = createPhysicalNoteRuntime([]);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(204),
      prisma: store.prisma,
      runtime: blockedProvider.runtime,
    });
    store.setCreatedAt(
      guardId,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const provider = createPhysicalNoteRuntime([], [{ kind: "absent" }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(203).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "clear",
    });
    expect(blocked).toMatchObject({
      failureReason: "prior_note_unresolved",
      status: "failed",
    });
    expect(store.allRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        failureReason: "unknown",
        id: guardId,
        status: "failed",
      }),
      expect.objectContaining({
        failureReason: "unknown",
        id: blocked.physicalNoteId,
        status: "failed",
      }),
    ]));
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("reports a cleared check separately when another guard remains", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(208);
    const blockedProvider = createPhysicalNoteRuntime([]);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(209),
      prisma: store.prisma,
      runtime: blockedProvider.runtime,
    });
    store.setFailureReason(blocked.physicalNoteId!, null);
    store.setCreatedAt(
      guardId,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const provider = createPhysicalNoteRuntime([], [{ kind: "absent" }]);

    const response = await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(208).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(response).toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "clear",
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: "unknown",
      status: "failed",
    });
    expect(store.allRows().find(
      (row) => row.id === blocked.physicalNoteId,
    )).toMatchObject({
      failureReason: null,
      status: "failed",
    });
  });

  it("keeps an aged indeterminate lookup pending without a false retry time", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(205);
    store.setCreatedAt(
      guardId,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const provider = createPhysicalNoteRuntime([], [{ kind: "indeterminate" }]);

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(205).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "pending",
    });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("reasserts current group authority before checking the provider", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { store } = await createLegacyPhysicalNoteGuard(206);
    const provider = createPhysicalNoteRuntime([], [{ kind: "indeterminate" }]);
    mocks.isThreadContainerDestination.mockReturnValue(true);
    mocks.requireDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        accountLookupKey: "group_account",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: "thread_physical_note",
      },
    });
    mocks.assertGroupOrigin.mockResolvedValue(MEMBER_ID);

    await recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(206).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(mocks.assertGroupOrigin).toHaveBeenCalledTimes(2);
    expect(mocks.assertGroupOrigin).toHaveBeenCalledWith(expect.objectContaining({
      originAssistantInputId: buildRequest(206).originAssistantInputId,
    }));
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
  });

  it("fails closed without provider configuration and leaves the guard intact", async () => {
    const recoverHostedPhysicalNote = await loadRecoverHostedPhysicalNote();
    const { guardId, store } = await createLegacyPhysicalNoteGuard(207);
    const provider = createPhysicalNoteRuntime([]);
    vi.stubEnv("LOB_API_KEY", "");

    await expect(recoverHostedPhysicalNote({
      memberId: MEMBER_ID,
      originAssistantInputId: buildRequest(207).originAssistantInputId,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toEqual({
      remainingUnresolved: true,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "unavailable",
    });
    expect(store.allRows().find((row) => row.id === guardId)).toMatchObject({
      failureReason: null,
      status: "failed",
    });
    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
  });
});

async function loadCreateHostedPhysicalNote() {
  const { createHostedPhysicalNote } = await import(
    "@/src/lib/physical-notes/service"
  );
  return createHostedPhysicalNote;
}

async function loadRecoverHostedPhysicalNote() {
  const { recoverHostedPhysicalNote } = await import(
    "@/src/lib/physical-notes/service"
  );
  return recoverHostedPhysicalNote;
}

async function createLegacyPhysicalNoteGuard(sequence: number): Promise<{
  guardId: string;
  store: PhysicalNoteStore;
}> {
  const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
  const store = createPhysicalNoteStore();
  const provider = createPhysicalNoteRuntime([{
    kind: "definite_failure",
    reason: "unknown",
    status: 422,
  }]);
  const failed = await createHostedPhysicalNote({
    ...buildRequest(sequence),
    prisma: store.prisma,
    runtime: provider.runtime,
  });
  const guardId = failed.physicalNoteId!;
  store.setFailureReason(guardId, null);
  return { guardId, store };
}

function buildRequest(sequence: number): HostedPhysicalNoteSendRequest & {
  memberId: string;
} {
  return {
    artwork: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      sha256: sequence.toString(16).padStart(64, "0"),
      url: `https://assets.example.test/physical-note-${sequence}.png`,
    },
    memberId: MEMBER_ID,
    originAssistantInputId: `ain_${"1".repeat(32)}`,
    recipient: {
      addressLine1: "123 Main Street",
      city: "Atlanta",
      name: "Alex Example",
      postalCode: "30301",
      state: "GA",
    },
    requestKey: `physical-note-request-${sequence}`,
  };
}

function recoveryOrigin(sequence: number): string {
  return `ain_${sequence.toString(16).padStart(32, "0")}`;
}

function createPhysicalNoteRuntime(
  results: readonly LobPhysicalNoteCreateResult[],
  lookupResults: readonly LobPhysicalNoteLookupResult[] = [],
) {
  const remaining = [...results];
  const remainingLookups = [...lookupResults];
  const create = vi.fn(async (): Promise<LobPhysicalNoteCreateResult> => {
    const result = remaining.shift();
    if (!result) {
      throw new Error("unexpected physical-note provider call");
    }
    return result;
  });
  const findLetterByNoteId = vi.fn(
    async (): Promise<LobPhysicalNoteLookupResult> => {
      const result = remainingLookups.shift();
      if (!result) {
        throw new Error("unexpected physical-note provider lookup");
      }
      return result;
    },
  );
  const runtime = {
    create,
    findLetterByNoteId,
  } satisfies LobPhysicalNoteRuntime;
  return { create, findLetterByNoteId, runtime };
}

function createPhysicalNoteStore(
  initialRows: readonly HostedPhysicalNote[] = [],
): PhysicalNoteStore {
  const rows = new Map(
    initialRows.map((row) => [row.id, cloneRow(row)]),
  );
  const recoveryRows = new Map<string, HostedPhysicalNoteRecovery>();
  const queuedFindFirstRowIds: string[] = [];
  let failNextRecoveryCompletion = false;

  const hostedPhysicalNote = {
    async create(input: {
      data: PhysicalNoteCreateData;
    }): Promise<HostedPhysicalNote> {
      const now = new Date();
      const row: HostedPhysicalNote = {
        acceptedAt: null,
        createdAt: now,
        failureReason: null,
        providerLetterId: null,
        updatedAt: now,
        ...input.data,
      };
      rows.set(row.id, row);
      return cloneRow(row);
    },

    async findFirst(input: {
      orderBy?: readonly [
        { createdAt: "asc" },
        { id: "asc" },
      ];
      select?: { id: true };
      where: PhysicalNoteWhere;
    }): Promise<HostedPhysicalNote | { id: string } | null> {
      const candidates = [...rows.values()].filter((candidate) =>
        matchesWhere(candidate, input.where)
      );
      if (input.orderBy?.[0]?.createdAt === "asc") {
        candidates.sort((left, right) => {
          const createdAtOrder =
            left.createdAt.getTime() - right.createdAt.getTime();
          return createdAtOrder || left.id.localeCompare(right.id);
        });
      }
      const queuedId = queuedFindFirstRowIds.shift();
      const row = queuedId
        ? candidates.find((candidate) => candidate.id === queuedId)
        : candidates[0];
      if (queuedId && !row) {
        throw new Error(`queued physical note ${queuedId} did not match`);
      }
      if (!row) return null;
      return input.select ? { id: row.id } : cloneRow(row);
    },

    async findUnique(input: {
      where: {
        id?: string;
        memberId_requestKey?: {
          memberId: string;
          requestKey: string;
        };
      };
    }): Promise<HostedPhysicalNote | null> {
      const id = input.where.id;
      if (id) {
        const row = rows.get(id);
        return row ? cloneRow(row) : null;
      }
      const compound = input.where.memberId_requestKey;
      if (!compound) return null;
      const row = [...rows.values()].find((candidate) =>
        candidate.memberId === compound.memberId
        && candidate.requestKey === compound.requestKey
      );
      return row ? cloneRow(row) : null;
    },

    async findUniqueOrThrow(input: {
      where: { id: string };
    }): Promise<HostedPhysicalNote> {
      const row = rows.get(input.where.id);
      if (!row) {
        throw new Error(`missing physical note ${input.where.id}`);
      }
      return cloneRow(row);
    },

    async updateMany(input: {
      data: PhysicalNoteUpdateData;
      where: PhysicalNoteWhere;
    }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, row] of rows) {
        if (!matchesWhere(row, input.where)) continue;
        rows.set(id, {
          ...row,
          ...input.data,
          updatedAt: new Date(),
        });
        count += 1;
      }
      return { count };
    },
  };

  const hostedPhysicalNoteRecovery = {
    async create(input: {
      data: PhysicalNoteRecoveryCreateData;
    }): Promise<HostedPhysicalNoteRecovery> {
      if (recoveryRows.has(input.data.originAssistantInputId)) {
        throw new Error("duplicate physical-note recovery identity");
      }
      const now = new Date();
      const row: HostedPhysicalNoteRecovery = {
        createdAt: now,
        physicalNoteId: null,
        remainingUnresolved: null,
        resultStatus: null,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        updatedAt: now,
        ...input.data,
      };
      recoveryRows.set(row.originAssistantInputId, row);
      return cloneRecoveryRow(row);
    },

    async findUnique(input: {
      where: { originAssistantInputId: string };
    }): Promise<HostedPhysicalNoteRecovery | null> {
      const row = recoveryRows.get(input.where.originAssistantInputId);
      return row ? cloneRecoveryRow(row) : null;
    },

    async findUniqueOrThrow(input: {
      where: { originAssistantInputId: string };
    }): Promise<HostedPhysicalNoteRecovery> {
      const row = recoveryRows.get(input.where.originAssistantInputId);
      if (!row) {
        throw new Error(
          `missing physical-note recovery ${input.where.originAssistantInputId}`,
        );
      }
      return cloneRecoveryRow(row);
    },

    async updateMany(input: {
      data: PhysicalNoteRecoveryUpdateData;
      where: PhysicalNoteRecoveryWhere;
    }): Promise<{ count: number }> {
      if (failNextRecoveryCompletion) {
        failNextRecoveryCompletion = false;
        throw new Error("simulated recovery result persistence failure");
      }
      let count = 0;
      for (const [originAssistantInputId, row] of recoveryRows) {
        if (!matchesRecoveryWhere(row, input.where)) continue;
        recoveryRows.set(originAssistantInputId, {
          ...row,
          ...input.data,
          updatedAt: new Date(),
        });
        count += 1;
      }
      return { count };
    },
  };

  const prismaLike = {
    async $transaction<T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      const rowSnapshot = new Map(
        [...rows].map(([id, row]) => [id, cloneRow(row)]),
      );
      const recoverySnapshot = new Map(
        [...recoveryRows].map(([id, row]) => [id, cloneRecoveryRow(row)]),
      );
      try {
        return await callback(asPhysicalNoteTransactionClient(prisma));
      } catch (error) {
        rows.clear();
        for (const [id, row] of rowSnapshot) rows.set(id, row);
        recoveryRows.clear();
        for (const [id, row] of recoverySnapshot) {
          recoveryRows.set(id, row);
        }
        throw error;
      }
    },
    hostedPhysicalNote,
    hostedPhysicalNoteRecovery,
  };
  const prisma = asPhysicalNotePrismaClient(prismaLike);

  return {
    allRecoveries: () => [...recoveryRows.values()].map(cloneRecoveryRow),
    allRows: () => [...rows.values()].map(cloneRow),
    failNextRecoveryCompletion() {
      failNextRecoveryCompletion = true;
    },
    prisma,
    queueFindFirstRowIds(...ids) {
      queuedFindFirstRowIds.push(...ids);
    },
    setCreatedAt(id, createdAt) {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`missing physical note ${id}`);
      }
      rows.set(id, { ...row, createdAt });
    },
    setFailureReason(id, failureReason) {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`missing physical note ${id}`);
      }
      rows.set(id, { ...row, failureReason });
    },
  };
}

function asPhysicalNotePrismaClient(value: object): PrismaClient {
  // Test-only boundary: the service exercises only the delegates implemented
  // by createPhysicalNoteStore.
  return value as PrismaClient;
}

function asPhysicalNoteTransactionClient(
  prisma: PrismaClient,
): Prisma.TransactionClient {
  // Test-only boundary: this fake transaction exposes the same delegates as
  // the fake client and intentionally omits nested transaction methods.
  return prisma as Prisma.TransactionClient;
}

function matchesWhere(
  row: HostedPhysicalNote,
  where: PhysicalNoteWhere,
): boolean {
  return (
    (where.OR === undefined
      || where.OR.some((candidate) => matchesWhere(row, candidate)))
    && (where.complimentaryOfferCode === undefined
      || row.complimentaryOfferCode === where.complimentaryOfferCode)
    && (where.createdAt === undefined
      || row.createdAt <= where.createdAt.lte)
    && (where.failureReason === undefined
      || row.failureReason === where.failureReason)
    && (where.id === undefined || row.id === where.id)
    && (where.memberId === undefined || row.memberId === where.memberId)
    && (where.providerLetterId === undefined
      || row.providerLetterId === where.providerLetterId)
    && (where.requestKey === undefined
      || row.requestKey === where.requestKey)
    && (where.status === undefined || row.status === where.status)
  );
}

function matchesRecoveryWhere(
  row: HostedPhysicalNoteRecovery,
  where: PhysicalNoteRecoveryWhere,
): boolean {
  return (
    (where.memberId === undefined || row.memberId === where.memberId)
    && (where.originAssistantInputId === undefined
      || row.originAssistantInputId === where.originAssistantInputId)
    && (where.physicalNoteId === undefined
      || row.physicalNoteId === where.physicalNoteId)
    && (where.resultStatus === undefined
      || row.resultStatus === where.resultStatus)
  );
}

function cloneRow(row: HostedPhysicalNote): HostedPhysicalNote {
  return {
    ...row,
    acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function cloneRecoveryRow(
  row: HostedPhysicalNoteRecovery,
): HostedPhysicalNoteRecovery {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    retryAfter: row.retryAfter ? new Date(row.retryAfter) : null,
    updatedAt: new Date(row.updatedAt),
  };
}
