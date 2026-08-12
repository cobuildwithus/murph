import type {
  HostedPhysicalNote,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhysicalNoteSendRequest,
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

interface PhysicalNoteStore {
  allRows(): HostedPhysicalNote[];
  prisma: PrismaClient;
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

  it("reserves known in-flight paid costs before another provider send", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    await createHostedPhysicalNote({
      ...buildRequest(10),
      prisma: store.prisma,
      runtime: createPhysicalNoteRuntime([
        { kind: "accepted", providerLetterId: "ltr_free" },
      ]).runtime,
    });
    mocks.readUsageGate.mockResolvedValue({
      allowed: true,
      periodEnd: DEFAULT_PERIOD_END,
      periodStart: DEFAULT_PERIOD_START,
      remainingUsdMicros: COST_USD_MICROS,
    });
    const firstPaidResult = createDeferred<LobPhysicalNoteCreateResult>();
    const firstPaidCreate = vi.fn<
      LobPhysicalNoteRuntime["create"]
    >(() => firstPaidResult.promise);
    const firstPaidLookup = vi.fn<
      LobPhysicalNoteRuntime["findLetterByNoteId"]
    >();
    const firstPaidPromise = createHostedPhysicalNote({
      ...buildRequest(11),
      prisma: store.prisma,
      runtime: {
        create: firstPaidCreate,
        findLetterByNoteId: firstPaidLookup,
      },
    });
    await vi.waitFor(() => {
      expect(firstPaidCreate).toHaveBeenCalledOnce();
    });

    const blockedProvider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_should_not_send" },
    ]);
    const blocked = await createHostedPhysicalNote({
      ...buildRequest(12),
      prisma: store.prisma,
      runtime: blockedProvider.runtime,
    });

    expect(blocked).toEqual({
      complimentary: false,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    });
    expect(blockedProvider.create).not.toHaveBeenCalled();

    firstPaidResult.resolve({
      kind: "accepted",
      providerLetterId: "ltr_first_paid",
    });
    await expect(firstPaidPromise).resolves.toMatchObject({
      complimentary: false,
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
      [{
        kind: "definite_failure",
        reason: "unknown",
        status: 422,
      }],
      [{ kind: "accepted", providerLetterId: "ltr_legacy" }],
    );
    const failed = await createHostedPhysicalNote({
      ...buildRequest(62),
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
        failureReason: null,
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
    expect(replay).toEqual(response);
    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
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

    expect(response).toMatchObject({
      complimentary: false,
      physicalNoteId: failed.physicalNoteId,
      status: "accepted",
    });
    expect(replay).toEqual(response);
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
    expect(provider.create).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
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

  it("keeps an HTTP 408 reservation and offer after one provider request", async () => {
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

    const response = await createHostedPhysicalNote({
      ...buildRequest(70),
      prisma: store.prisma,
      runtime,
    });

    expect(response).toMatchObject({
      complimentary: true,
      status: "pending",
    });
    expect(store.allRows()).toEqual([
      expect.objectContaining({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        failureReason: null,
        providerLetterId: null,
        status: "starting",
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("finalizes a stale Lob acceptance while the current request proceeds", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        { kind: "ambiguous_failure" },
        { kind: "accepted", providerLetterId: "ltr_current_paid" },
      ],
      [{ kind: "accepted", providerLetterId: "ltr_stale_free" }],
    );

    const stale = await createHostedPhysicalNote({
      ...buildRequest(50),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setCreatedAt(
      stale.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    provider.create.mockClear();
    const current = await createHostedPhysicalNote({
      ...buildRequest(51),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.findLetterByNoteId).toHaveBeenCalledWith({
      noteId: stale.physicalNoteId,
      signal: undefined,
    });
    expect(current).toEqual({
      complimentary: false,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(store.allRows().find((row) => row.id === stale.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: "ltr_stale_free",
        status: "accepted",
      });
    expect(store.allRows().find((row) => row.id === current.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: null,
        providerLetterId: "ltr_current_paid",
        status: "accepted",
      });
    expect(store.allRows()).toHaveLength(2);
    expect(provider.create).toHaveBeenCalledOnce();
    expect(mocks.readUsageGate).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("releases a stale complimentary claim when Lob confirms no letter exists", async () => {
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
    const current = await createHostedPhysicalNote({
      ...buildRequest(53),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(current).toMatchObject({
      complimentary: true,
      status: "accepted",
    });
    expect(store.allRows().find((row) => row.id === stale.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: null,
        providerLetterId: null,
        status: "failed",
      });
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("leaves an indeterminate claim pending while the current request proceeds", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime(
      [
        { kind: "ambiguous_failure" },
        { kind: "accepted", providerLetterId: "ltr_after_indeterminate" },
      ],
      [{ kind: "indeterminate" }],
    );

    const stale = await createHostedPhysicalNote({
      ...buildRequest(54),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    store.setCreatedAt(
      stale.physicalNoteId!,
      new Date(Date.now() - REPLAY_WINDOW_MS - 1),
    );
    const current = await createHostedPhysicalNote({
      ...buildRequest(55),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(current).toMatchObject({
      complimentary: false,
      status: "accepted",
    });
    expect(store.allRows().find((row) => row.id === stale.physicalNoteId))
      .toMatchObject({
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        providerLetterId: null,
        status: "starting",
      });

    expect(provider.findLetterByNoteId).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("uses ordinary same-request replay inside the window without a Lob lookup", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "ambiguous_failure" },
      { kind: "accepted", providerLetterId: "ltr_replayed_in_window" },
    ]);
    const request = buildRequest(56);

    await expect(createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({ status: "pending" });
    await expect(createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({
      complimentary: true,
      status: "accepted",
    });

    expect(provider.findLetterByNoteId).not.toHaveBeenCalled();
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(store.allRows()).toHaveLength(1);
  });

  it("reserves paid notes only against the current allowance period", async () => {
    const createHostedPhysicalNote = await loadCreateHostedPhysicalNote();
    const store = createPhysicalNoteStore();
    const provider = createPhysicalNoteRuntime([
      { kind: "accepted", providerLetterId: "ltr_period_free" },
      { kind: "ambiguous_failure" },
      { kind: "accepted", providerLetterId: "ltr_period_paid" },
    ]);
    mocks.readUsageGate.mockResolvedValue({
      allowed: true,
      periodEnd: DEFAULT_PERIOD_END,
      periodStart: DEFAULT_PERIOD_START,
      remainingUsdMicros: COST_USD_MICROS,
    });

    await createHostedPhysicalNote({
      ...buildRequest(40),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const oldPending = await createHostedPhysicalNote({
      ...buildRequest(41),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    expect(oldPending.status).toBe("pending");
    store.setCreatedAt(
      oldPending.physicalNoteId!,
      new Date(DEFAULT_PERIOD_START.getTime() - 1),
    );

    await expect(createHostedPhysicalNote({
      ...buildRequest(42),
      prisma: store.prisma,
      runtime: provider.runtime,
    })).resolves.toMatchObject({
      complimentary: false,
      status: "accepted",
    });
    expect(provider.create).toHaveBeenCalledTimes(3);
  });

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

async function loadCreateHostedPhysicalNote() {
  const { createHostedPhysicalNote } = await import(
    "@/src/lib/physical-notes/service"
  );
  return createHostedPhysicalNote;
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) {
        throw new Error("deferred promise is not initialized");
      }
      resolvePromise(value);
    },
  };
}

function createPhysicalNoteStore(
  initialRows: readonly HostedPhysicalNote[] = [],
): PhysicalNoteStore {
  const rows = new Map(
    initialRows.map((row) => [row.id, cloneRow(row)]),
  );

  const hostedPhysicalNote = {
    async aggregate(input: {
      where: {
        createdAt?: { gte: Date; lt: Date };
      };
    }): Promise<{
      _sum: { providerCostUsdMicros: bigint | null };
    }> {
      const providerCostUsdMicros = [...rows.values()]
        .filter((row) =>
          row.memberId === MEMBER_ID
          && row.complimentaryOfferCode === null
          && row.status === "starting"
          && (
            !input.where.createdAt
            || (
              row.createdAt >= input.where.createdAt.gte
              && row.createdAt < input.where.createdAt.lt
            )
          )
        )
        .reduce((sum, row) => sum + row.providerCostUsdMicros, 0n);
      return {
        _sum: {
          providerCostUsdMicros:
            providerCostUsdMicros === 0n ? null : providerCostUsdMicros,
        },
      };
    },

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
      orderBy?: { createdAt: "asc" };
      select?: { id: true };
      where: PhysicalNoteWhere;
    }): Promise<HostedPhysicalNote | { id: string } | null> {
      const candidates = [...rows.values()].filter((candidate) =>
        matchesWhere(candidate, input.where)
      );
      if (input.orderBy?.createdAt === "asc") {
        candidates.sort((left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime()
        );
      }
      const row = candidates[0];
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

  const prismaLike = {
    async $transaction<T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return await callback(asPhysicalNoteTransactionClient(prisma));
    },
    hostedPhysicalNote,
  };
  const prisma = asPhysicalNotePrismaClient(prismaLike);

  return {
    allRows: () => [...rows.values()].map(cloneRow),
    prisma,
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
    (where.complimentaryOfferCode === undefined
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

function cloneRow(row: HostedPhysicalNote): HostedPhysicalNote {
  return {
    ...row,
    acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
