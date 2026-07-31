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

import type {
  LobPhysicalNoteCreateResult,
  LobPhysicalNoteRuntime,
} from "@/src/lib/physical-notes/lob-runtime";

const mocks = vi.hoisted(() => ({
  assertActiveAccess: vi.fn(),
  assertGroupOrigin: vi.fn(),
  getPrisma: vi.fn(),
  isThreadContainerDestination: vi.fn(),
  lockMember: vi.fn(),
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

type PhysicalNoteWhere = Partial<Pick<
  HostedPhysicalNote,
  | "complimentaryOfferCode"
  | "id"
  | "memberId"
  | "providerLetterId"
  | "requestKey"
  | "status"
>>;

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
>;

type PhysicalNoteUpdateData = Partial<Pick<
  HostedPhysicalNote,
  | "acceptedAt"
  | "complimentaryOfferCode"
  | "providerLetterId"
  | "status"
>>;

interface PhysicalNoteStore {
  allRows(): HostedPhysicalNote[];
  prisma: PrismaClient;
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
  mocks.readUsageGate.mockResolvedValue({
    allowed: true,
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

    expect(paidResponse).toEqual({
      complimentary: false,
      costUsdMicros: COST_USD_MICROS.toString(),
      physicalNoteId: expect.stringMatching(/^hpn_[a-f0-9]{32}$/u),
      status: "accepted",
    });
    expect(mocks.readUsageGate).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledWith({
      accountAllowance: true,
      prisma: expect.anything(),
      trustedUserId: MEMBER_ID,
      usage: [
        expect.objectContaining({
          featureKey: "physical-note",
          provider: "lob",
          providerRequestId: "ltr_paid",
          rawUsageJson: {
            providerCostUsdMicros: Number(COST_USD_MICROS),
            providerPricingVersion: "lob-test-v1",
          },
        }),
      ],
    });
    expect(store.allRows().find(
      (row) => row.id === paidResponse.physicalNoteId,
    )).toMatchObject({
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
      remainingUsdMicros: COST_USD_MICROS,
    });
    const firstPaidResult = createDeferred<LobPhysicalNoteCreateResult>();
    const firstPaidCreate = vi.fn<
      LobPhysicalNoteRuntime["create"]
    >(() => firstPaidResult.promise);
    const firstPaidPromise = createHostedPhysicalNote({
      ...buildRequest(11),
      prisma: store.prisma,
      runtime: { create: firstPaidCreate },
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
    const replay = await createHostedPhysicalNote({
      ...request,
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(replay).toEqual(first);
    expect(provider.create).toHaveBeenCalledOnce();
    expect(store.allRows()).toHaveLength(1);
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
    const provider = createPhysicalNoteRuntime([
      { kind: "definite_failure", status: 422 },
      { kind: "accepted", providerLetterId: "ltr_retry" },
    ]);

    const failed = await createHostedPhysicalNote({
      ...buildRequest(5),
      prisma: store.prisma,
      runtime: provider.runtime,
    });
    const retry = await createHostedPhysicalNote({
      ...buildRequest(6),
      prisma: store.prisma,
      runtime: provider.runtime,
    });

    expect(failed.status).toBe("failed");
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
      status: "failed",
    });
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
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
) {
  const remaining = [...results];
  const create = vi.fn(async (
    _input: Parameters<LobPhysicalNoteRuntime["create"]>[0],
  ): Promise<LobPhysicalNoteCreateResult> => {
    const result = remaining.shift();
    if (!result) {
      throw new Error("unexpected physical-note provider call");
    }
    return result;
  });
  const runtime = { create } satisfies LobPhysicalNoteRuntime;
  return { create, runtime };
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
    async aggregate(): Promise<{
      _sum: { providerCostUsdMicros: bigint | null };
    }> {
      const providerCostUsdMicros = [...rows.values()]
        .filter((row) =>
          row.memberId === MEMBER_ID
          && row.complimentaryOfferCode === null
          && row.status === "starting"
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
        providerLetterId: null,
        updatedAt: now,
        ...input.data,
      };
      rows.set(row.id, row);
      return cloneRow(row);
    },

    async findFirst(input: {
      where: PhysicalNoteWhere;
    }): Promise<{ id: string } | null> {
      const row = [...rows.values()].find((candidate) =>
        matchesWhere(candidate, input.where)
      );
      return row ? { id: row.id } : null;
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
