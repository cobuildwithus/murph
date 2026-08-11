import { createHash } from "node:crypto";

import type {
  HostedPhysicalNote,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhysicalNoteSendRequest,
} from "@murphai/hosted-execution/physical-notes";
import {
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
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
  LobPhysicalNoteRuntime,
} from "@/src/lib/physical-notes/lob-runtime";

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

const MEMBER_ID = "member_physical_note_replay";
const REQUEST_KEY = "physical-note-replay";
const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"1".repeat(32)}`;
const ARTWORK_SHA256 = "2".repeat(64);
const RECIPIENT = {
  addressLine1: "123 Main Street",
  city: "Atlanta",
  name: "Alex Example",
  postalCode: "30301",
  state: "GA",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("LOB_API_KEY", "test_physical_notes");
  vi.stubEnv("LOB_FROM_ADDRESS_ID", "adr_from_test");
  vi.stubEnv("LOB_PHYSICAL_NOTE_COST_USD_MICROS", "250000");
  vi.stubEnv("LOB_PHYSICAL_NOTE_PRICING_VERSION", "lob-test-v1");

  mocks.assertActiveAccess.mockResolvedValue(undefined);
  mocks.assertGroupOrigin.mockResolvedValue(undefined);
  mocks.getPrisma.mockImplementation(() => {
    throw new Error("test must pass an explicit physical-note store");
  });
  mocks.isThreadContainerDestination.mockReturnValue(false);
  mocks.lockMember.mockResolvedValue(undefined);
  mocks.readActiveAccess.mockResolvedValue(true);
  mocks.requireDestination.mockResolvedValue({
    conversationShape: "direct-member",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("physical-note durable replay", () => {
  it("returns an accepted row after its private artwork URL expires", async () => {
    const acceptedAt = new Date("2026-07-30T20:00:00.000Z");
    const row: HostedPhysicalNote = {
      acceptedAt,
      complimentaryOfferCode: "physical-note-v1",
      createdAt: new Date("2026-07-30T19:59:00.000Z"),
      failureReason: null,
      id: `hpn_${"a".repeat(32)}`,
      memberId: MEMBER_ID,
      pricingVersion: "lob-test-v1",
      provider: "lob",
      providerCostUsdMicros: 250_000n,
      providerLetterId: "ltr_replay",
      requestFingerprint: buildRequestFingerprint(),
      requestKey: REQUEST_KEY,
      status: "accepted",
      updatedAt: acceptedAt,
    };
    const hostedPhysicalNote = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const prismaLike = {
      $transaction: vi.fn(async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => await callback(
        asPhysicalNoteTransactionClient(prisma),
      )),
      hostedPhysicalNote,
    };
    const prisma = asPhysicalNotePrismaClient(prismaLike);
    const create = vi.fn<LobPhysicalNoteRuntime["create"]>();
    const findLetterByNoteId = vi.fn<
      LobPhysicalNoteRuntime["findLetterByNoteId"]
    >();
    const runtime = {
      create,
      findLetterByNoteId,
    } satisfies LobPhysicalNoteRuntime;
    const { createHostedPhysicalNote } = await import(
      "@/src/lib/physical-notes/service"
    );

    const request: HostedPhysicalNoteSendRequest = {
      artwork: {
        expiresAt: "2026-07-30T20:01:00.000Z",
        sha256: ARTWORK_SHA256,
        url: "https://assets.example.test/expired-note.png",
      },
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      recipient: RECIPIENT,
      requestKey: REQUEST_KEY,
    };
    const result = await createHostedPhysicalNote({
      ...request,
      memberId: MEMBER_ID,
      prisma,
      runtime,
    });

    expect(result).toEqual({
      complimentary: true,
      costUsdMicros: "250000",
      physicalNoteId: row.id,
      status: "accepted",
    });
    expect(create).not.toHaveBeenCalled();
    expect(hostedPhysicalNote.findUnique).toHaveBeenCalledOnce();
    expect(hostedPhysicalNote.updateMany).toHaveBeenCalledOnce();
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("rejects expiring artwork before reserving a new note", async () => {
    const hostedPhysicalNote = {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    };
    const prismaLike = {
      $transaction: vi.fn(async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => await callback(
        asPhysicalNoteTransactionClient(prisma),
      )),
      hostedPhysicalNote,
    };
    const prisma = asPhysicalNotePrismaClient(prismaLike);
    const create = vi.fn<LobPhysicalNoteRuntime["create"]>();
    const findLetterByNoteId = vi.fn<
      LobPhysicalNoteRuntime["findLetterByNoteId"]
    >();
    const runtime = {
      create,
      findLetterByNoteId,
    } satisfies LobPhysicalNoteRuntime;
    const { createHostedPhysicalNote } = await import(
      "@/src/lib/physical-notes/service"
    );

    await expect(createHostedPhysicalNote({
      artwork: {
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        sha256: "3".repeat(64),
        url: "https://assets.example.test/expiring-note.png",
      },
      memberId: MEMBER_ID,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      prisma,
      recipient: RECIPIENT,
      requestKey: "physical-note-expiring",
      runtime,
    })).rejects.toThrow("Physical-note artwork URL expires too soon.");

    expect(hostedPhysicalNote.create).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(mocks.readUsageGate).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });
});

function buildRequestFingerprint(): string {
  const recipient = normalizeHostedPhysicalNoteRecipient(RECIPIENT);
  return createHash("sha256")
    .update("murph.hosted-physical-note.request.v1\0")
    .update(ARTWORK_SHA256)
    .update("\0")
    .update(ORIGIN_ASSISTANT_INPUT_ID)
    .update("\0")
    .update(stableHostedPhysicalNoteRecipientJson(recipient))
    .digest("hex");
}

function asPhysicalNotePrismaClient(value: object): PrismaClient {
  // Test-only boundary: this replay fixture implements only the delegates
  // reached by the accepted-row and pre-reservation paths.
  return value as PrismaClient;
}

function asPhysicalNoteTransactionClient(
  prisma: PrismaClient,
): Prisma.TransactionClient {
  // Test-only boundary: the fake transaction intentionally reuses the same
  // read/update delegates and omits nested transaction methods.
  return prisma as Prisma.TransactionClient;
}
