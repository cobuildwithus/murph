import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createHostedPhysicalNoteRequestKey,
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
} from "@murphai/hosted-execution/physical-notes";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import type { LobPhysicalNoteCreateResult } from "@/src/lib/physical-notes/lob-runtime";

const mocks = vi.hoisted(() => ({
  readUsageGate: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: () => false,
  requireHostedAssistantNotificationDestination: async () => ({
    conversationShape: "direct-member",
  }),
}));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readUsageGate,
}));
vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: mocks.recordUsage,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The physical-note concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "physical-note PostgreSQL concurrency",
  () => {
    let firstClient: PrismaClient | null = null;
    let secondClient: PrismaClient | null = null;
    let observerClient: PrismaClient | null = null;
    let memberId: string | null = null;

    beforeAll(async () => {
      vi.stubEnv("LOB_API_KEY", "test_physical_notes");
      vi.stubEnv("LOB_FROM_ADDRESS_ID", "adr_from_test");
      vi.stubEnv("LOB_PHYSICAL_NOTE_COST_USD_MICROS", "250000");
      vi.stubEnv("LOB_PHYSICAL_NOTE_PRICING_VERSION", "lob-test-v1");
      mocks.readUsageGate.mockResolvedValue({
        allowed: true,
        periodEnd: new Date(Date.now() + 60 * 60 * 1_000),
        periodStart: new Date(Date.now() - 60 * 60 * 1_000),
        remainingUsdMicros: 1_000_000n,
      });
      mocks.recordUsage.mockResolvedValue(undefined);

      firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      observerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      memberId = `member_physical_note_${randomUUID().replaceAll("-", "")}`;
      await firstClient.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberId,
        },
      });
    });

    beforeEach(async () => {
      const first = requirePrisma(firstClient);
      await first.hostedAiUsage.deleteMany({
        where: { memberId: requireMemberId(memberId) },
      });
      await first.hostedPhysicalNoteRecovery.deleteMany({
        where: { memberId: requireMemberId(memberId) },
      });
      await first.hostedPhysicalNote.deleteMany({
        where: { memberId: requireMemberId(memberId) },
      });
      mocks.recordUsage.mockReset();
      mocks.recordUsage.mockResolvedValue(undefined);
    });

    afterAll(async () => {
      if (firstClient && memberId) {
        await firstClient.hostedMember.deleteMany({
          where: { id: memberId },
        });
      }
      await firstClient?.$disconnect();
      await secondClient?.$disconnect();
      await observerClient?.$disconnect();
      vi.unstubAllEnvs();
    });

    it("blocks a distinct concurrent request while provider authority is pending", async () => {
      const first = requirePrisma(firstClient);
      const second = requirePrisma(secondClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );

      const firstCreate = vi.fn(async () => ({
        kind: "ambiguous_failure" as const,
      }));
      const secondCreate = vi.fn(async () => ({
        kind: "ambiguous_failure" as const,
      }));
      const responses = await Promise.all([
        createHostedPhysicalNote({
          ...buildRequest(1, beneficiary),
          prisma: first,
          runtime: {
            create: firstCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        }),
        createHostedPhysicalNote({
          ...buildRequest(2, beneficiary),
          prisma: second,
          runtime: {
            create: secondCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        }),
      ]);

      expect(responses.map((response) => response.complimentary).sort())
        .toEqual([false, true]);
      expect(responses.map((response) => response.status).sort())
        .toEqual(["failed", "pending"]);
      expect(responses.find((response) => response.status === "failed"))
        .toMatchObject({ failureReason: "prior_note_unresolved" });
      expect(firstCreate.mock.calls.length + secondCreate.mock.calls.length)
        .toBe(1);
      await expect(first.hostedPhysicalNote.count({
        where: {
          complimentaryOfferCode: "physical-note-v1",
          memberId: beneficiary,
        },
      })).resolves.toBe(1);
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    });

    it.each([
      {
        blockerReason: "prior_note_accepted" as const,
        sourceResult: {
          kind: "accepted" as const,
          providerLetterId: "ltr_concurrent_accepted",
        },
        sourceStatus: "accepted" as const,
      },
      {
        blockerReason: "unknown" as const,
        sourceResult: {
          kind: "definite_failure" as const,
          reason: "request_invalid" as const,
          status: 422,
        },
        sourceStatus: "failed" as const,
      },
    ])(
      "settles a committed blocker after the source becomes $sourceStatus",
      async ({ blockerReason, sourceResult, sourceStatus }) => {
        const sourceClient = requirePrisma(firstClient);
        const blockerClient = requirePrisma(secondClient);
        const observer = requirePrisma(observerClient);
        const beneficiary = requireMemberId(memberId);
        const { createHostedPhysicalNote } = await import(
          "@/src/lib/physical-notes/service"
        );
        const createStarted = createDeferred();
        const completeCreate = createDeferred<LobPhysicalNoteCreateResult>();
        if (sourceStatus === "accepted") {
          const complimentaryId = `hpn_${randomUUID().replaceAll("-", "")}`;
          await observer.hostedPhysicalNote.create({
            data: {
              acceptedAt: new Date(),
              complimentaryOfferCode: "physical-note-v1",
              failureReason: null,
              id: complimentaryId,
              memberId: beneficiary,
              pricingVersion: "lob-test-v1",
              provider: "lob",
              providerCostUsdMicros: 250_000n,
              providerLetterId: `ltr_${complimentaryId}`,
              requestFingerprint: `fingerprint_${complimentaryId}`,
              requestKey: `request_${complimentaryId}`,
              status: "accepted",
            },
          });
        }
        const sourceCreate = vi.fn(async () => {
          createStarted.resolve();
          return await completeCreate.promise;
        });
        const blockerCreate = vi.fn(async () => ({
          kind: "ambiguous_failure" as const,
        }));
        const sourceRequest = buildRequest(10, beneficiary);
        const blockerRequest = buildRequest(11, beneficiary);
        const source = createHostedPhysicalNote({
          ...sourceRequest,
          prisma: sourceClient,
          runtime: {
            create: sourceCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        });
        await createStarted.promise;

        const blocker = await createHostedPhysicalNote({
          ...blockerRequest,
          prisma: blockerClient,
          runtime: {
            create: blockerCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        });
        expect(blocker).toMatchObject({
          failureReason: "prior_note_unresolved",
          status: "failed",
        });
        expect(blockerCreate).not.toHaveBeenCalled();
        const blockerId = blocker.physicalNoteId;
        if (!blockerId) {
          throw new Error("Expected a persisted physical-note blocker.");
        }

        completeCreate.resolve(sourceResult);
        await expect(source).resolves.toMatchObject({ status: sourceStatus });
        if (sourceStatus === "accepted") {
          expect(mocks.recordUsage).toHaveBeenCalledOnce();
        }
        await expect(observer.hostedPhysicalNote.findUnique({
          where: { id: blockerId },
        })).resolves.toMatchObject({
          failureReason: blockerReason,
          status: "failed",
        });
        const replayCreate = vi.fn(async () => ({
          kind: "ambiguous_failure" as const,
        }));
        await expect(createHostedPhysicalNote({
          ...blockerRequest,
          prisma: blockerClient,
          runtime: {
            create: replayCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        })).resolves.toMatchObject({
          failureReason: blockerReason,
          physicalNoteId: blockerId,
          status: "failed",
        });
        expect(replayCreate).not.toHaveBeenCalled();

        const sourceRow = await observer.hostedPhysicalNote.findUniqueOrThrow({
          where: {
            memberId_requestKey: {
              memberId: beneficiary,
              requestKey: sourceRequest.requestKey,
            },
          },
        });
        if (sourceStatus === "accepted") {
          const laterCreate = vi.fn(async () => ({
            kind: "accepted" as const,
            providerLetterId: "ltr_after_concurrent_acceptance",
          }));
          await expect(createHostedPhysicalNote({
            ...buildRequest(12, beneficiary),
            prisma: observer,
            runtime: {
              create: laterCreate,
              async findLetterByNoteId() {
                return { kind: "indeterminate" };
              },
            },
          })).resolves.toMatchObject({
            complimentary: false,
            status: "accepted",
          });
          expect(sourceRow).toMatchObject({
            complimentaryOfferCode: null,
            status: "accepted",
          });
          expect(laterCreate).toHaveBeenCalledOnce();
          expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
        } else {
          expect(sourceRow).toMatchObject({
            complimentaryOfferCode: null,
            failureReason: "request_invalid",
            status: "failed",
          });
          expect(mocks.recordUsage).not.toHaveBeenCalled();
        }
      },
    );

    it("recovers accepted exact replay after local finalization rolls back", async () => {
      const sourceClient = requirePrisma(firstClient);
      const replayClient = requirePrisma(secondClient);
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      const complimentaryId = `hpn_${randomUUID().replaceAll("-", "")}`;
      await observer.hostedPhysicalNote.create({
        data: {
          acceptedAt: new Date(),
          complimentaryOfferCode: "physical-note-v1",
          failureReason: null,
          id: complimentaryId,
          memberId: beneficiary,
          pricingVersion: "lob-test-v1",
          provider: "lob",
          providerCostUsdMicros: 250_000n,
          providerLetterId: `ltr_${complimentaryId}`,
          requestFingerprint: `fingerprint_${complimentaryId}`,
          requestKey: `request_${complimentaryId}`,
          status: "accepted",
        },
      });
      const request = buildRequest(20, beneficiary);
      const sourceCreate = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_before_local_rollback",
      }));
      mocks.recordUsage.mockRejectedValueOnce(
        new Error("simulated local usage transaction failure"),
      );

      await expect(createHostedPhysicalNote({
        ...request,
        prisma: sourceClient,
        runtime: {
          create: sourceCreate,
          async findLetterByNoteId() {
            return { kind: "indeterminate" };
          },
        },
      })).rejects.toThrow("simulated local usage transaction failure");
      const starting = await observer.hostedPhysicalNote.findUniqueOrThrow({
        where: {
          memberId_requestKey: {
            memberId: beneficiary,
            requestKey: request.requestKey,
          },
        },
      });
      expect(starting).toMatchObject({
        providerLetterId: null,
        status: "starting",
      });

      const replayCreate = vi.fn(async () => ({
        kind: "ambiguous_failure" as const,
      }));
      const findAccepted = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_before_local_rollback",
      }));
      const recovered = await createHostedPhysicalNote({
        ...request,
        prisma: replayClient,
        runtime: {
          create: replayCreate,
          findLetterByNoteId: findAccepted,
        },
      });
      const stableReplay = await createHostedPhysicalNote({
        ...request,
        prisma: replayClient,
        runtime: {
          create: replayCreate,
          findLetterByNoteId: findAccepted,
        },
      });

      expect(recovered).toMatchObject({
        complimentary: false,
        physicalNoteId: starting.id,
        status: "accepted",
      });
      expect(stableReplay).toEqual(recovered);
      expect(sourceCreate).toHaveBeenCalledOnce();
      expect(replayCreate).not.toHaveBeenCalled();
      expect(findAccepted).toHaveBeenCalledOnce();
      expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: starting.id },
      })).resolves.toMatchObject({
        providerLetterId: "ltr_before_local_rollback",
        status: "accepted",
      });
    });

    it("reports a targeted accepted send after the original response is lost", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote, recoverHostedPhysicalNote } =
        await import("@/src/lib/physical-notes/service");
      const complimentaryId = `hpn_${randomUUID().replaceAll("-", "")}`;
      await observer.hostedPhysicalNote.create({
        data: {
          acceptedAt: new Date(),
          complimentaryOfferCode: "physical-note-v1",
          failureReason: null,
          id: complimentaryId,
          memberId: beneficiary,
          pricingVersion: "lob-test-v1",
          provider: "lob",
          providerCostUsdMicros: 250_000n,
          providerLetterId: `ltr_${complimentaryId}`,
          requestFingerprint: `fingerprint_${complimentaryId}`,
          requestKey: `request_${complimentaryId}`,
          status: "accepted",
        },
      });
      const targetRequest = buildRequest(24, beneficiary);
      const createProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_original_send_response_lost",
      }));
      const findProviderLetter = vi.fn(async () => {
        throw new Error("Targeted accepted send recovery must not read Lob.");
      });

      const sent = await createHostedPhysicalNote({
        ...targetRequest,
        requestKey: createHostedPhysicalNoteRequestKey({
          originAssistantInputId: targetRequest.originAssistantInputId,
        }),
        prisma: observer,
        runtime: {
          create: createProviderLetter,
          findLetterByNoteId: findProviderLetter,
        },
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: buildRequest(25, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime: {
          async create() {
            throw new Error("Recovery must not create a physical note.");
          },
          findLetterByNoteId: findProviderLetter,
        },
        targetOriginAssistantInputId: targetRequest.originAssistantInputId,
      })).resolves.toEqual({
        remainingUnresolved: false,
        retryAfter: null,
        settledUsageCostUsdMicros: "250000",
        status: "accepted",
      });

      expect(sent).toMatchObject({
        complimentary: false,
        status: "accepted",
      });
      expect(createProviderLetter).toHaveBeenCalledOnce();
      expect(findProviderLetter).not.toHaveBeenCalled();
      expect(mocks.recordUsage).toHaveBeenCalledOnce();
    });

    it("recovers a newer accepted exact replay behind an older unresolved row", async () => {
      const replayClient = requirePrisma(secondClient);
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      const olderRequest = buildRequest(21, beneficiary);
      const replayRequest = buildRequest(22, beneficiary);
      const olderId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const replayId = `hpn_${randomUUID().replaceAll("-", "")}`;
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: "physical-note-v1",
            createdAt: new Date(Date.now() - 1_000),
            id: olderId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: buildRequestFingerprint(olderRequest),
            requestKey: olderRequest.requestKey,
            status: "starting",
          },
          {
            complimentaryOfferCode: null,
            id: replayId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: buildRequestFingerprint(replayRequest),
            requestKey: replayRequest.requestKey,
            status: "starting",
          },
        ],
      });
      const createProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_must_not_create",
      }));
      const findProviderLetter = vi.fn(async (input: { noteId: string }) => {
        if (input.noteId !== replayId) {
          throw new Error("Exact replay looked up the wrong physical note.");
        }
        return {
          kind: "accepted" as const,
          providerLetterId: "ltr_newer_accepted",
        };
      });

      const recovered = await createHostedPhysicalNote({
        ...replayRequest,
        prisma: replayClient,
        runtime: {
          create: createProviderLetter,
          findLetterByNoteId: findProviderLetter,
        },
      });
      const stableReplay = await createHostedPhysicalNote({
        ...replayRequest,
        prisma: replayClient,
        runtime: {
          create: createProviderLetter,
          findLetterByNoteId: findProviderLetter,
        },
      });
      const blocked = await createHostedPhysicalNote({
        ...buildRequest(23, beneficiary),
        prisma: replayClient,
        runtime: {
          create: createProviderLetter,
          findLetterByNoteId: findProviderLetter,
        },
      });

      expect(recovered).toMatchObject({
        complimentary: false,
        physicalNoteId: replayId,
        status: "accepted",
      });
      expect(stableReplay).toEqual(recovered);
      expect(blocked).toMatchObject({
        failureReason: "prior_note_unresolved",
        status: "failed",
      });
      expect(createProviderLetter).not.toHaveBeenCalled();
      expect(findProviderLetter).toHaveBeenCalledOnce();
      expect(findProviderLetter).toHaveBeenCalledWith({
        noteId: replayId,
        signal: undefined,
      });
      expect(mocks.recordUsage).toHaveBeenCalledOnce();
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: olderId },
      })).resolves.toMatchObject({
        providerLetterId: null,
        status: "starting",
      });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: replayId },
      })).resolves.toMatchObject({
        providerLetterId: "ltr_newer_accepted",
        status: "accepted",
      });
    });

    it("enters Lob once for concurrent replay of the same request", async () => {
      const first = requirePrisma(firstClient);
      const second = requirePrisma(secondClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      const firstCreate = vi.fn(async () => ({
        kind: "ambiguous_failure" as const,
      }));
      const secondCreate = vi.fn(async () => ({
        kind: "ambiguous_failure" as const,
      }));
      const request = buildRequest(6, beneficiary);

      const responses = await Promise.all([
        createHostedPhysicalNote({
          ...request,
          prisma: first,
          runtime: {
            create: firstCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        }),
        createHostedPhysicalNote({
          ...request,
          prisma: second,
          runtime: {
            create: secondCreate,
            async findLetterByNoteId() {
              return { kind: "indeterminate" };
            },
          },
        }),
      ]);

      expect(responses.map((response) => response.status))
        .toEqual(["pending", "pending"]);
      expect(firstCreate.mock.calls.length + secondCreate.mock.calls.length)
        .toBe(1);
      await expect(first.hostedPhysicalNote.count({
        where: { memberId: beneficiary },
      })).resolves.toBe(1);
      await expect(first.hostedPhysicalNote.findFirst({
        where: { memberId: beneficiary },
      })).resolves.toMatchObject({
        complimentaryOfferCode: "physical-note-v1",
        status: "starting",
      });
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    });

    it("revalidates every unresolved legacy note after waiting on the member lock", async () => {
      const lockHolder = requirePrisma(firstClient);
      const requestingClient = requirePrisma(secondClient);
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const firstLegacyId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const secondLegacyId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt,
            failureReason: null,
            id: firstLegacyId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: "first-legacy-fingerprint",
            requestKey: `first-legacy-${firstLegacyId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: null,
            createdAt: new Date(createdAt.getTime() + 1),
            failureReason: null,
            id: secondLegacyId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: "second-legacy-fingerprint",
            requestKey: `second-legacy-${secondLegacyId}`,
            status: "failed",
          },
        ],
      });

      const memberLocked = createDeferred();
      const resolveFirstLegacy = createDeferred();
      const holderTransaction = lockHolder.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1
          FROM "hosted_member"
          WHERE "id" = ${beneficiary}
          FOR UPDATE
        `;
        memberLocked.resolve();
        await resolveFirstLegacy.promise;
        await tx.hostedPhysicalNote.update({
          data: { failureReason: "unknown" },
          where: { id: firstLegacyId },
        });
      });
      const createProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_must_not_send",
      }));
      const findProviderLetter = vi.fn(async () => ({
        kind: "indeterminate" as const,
      }));

      try {
        await Promise.race([memberLocked.promise, holderTransaction]);
        const requestingPid = await readBackendPid(requestingClient);
        const request = createHostedPhysicalNote({
          ...buildRequest(5, beneficiary),
          prisma: requestingClient,
          runtime: {
            create: createProviderLetter,
            findLetterByNoteId: findProviderLetter,
          },
        });
        await waitForBlockedBackend({
          observer,
          pid: requestingPid,
        });

        resolveFirstLegacy.resolve();
        await holderTransaction;
        const response = await request;

        expect(response).toMatchObject({
          failureReason: "prior_note_unresolved",
          status: "failed",
        });
        expect(response.physicalNoteId).not.toBe(firstLegacyId);
        expect(response.physicalNoteId).not.toBe(secondLegacyId);
        expect(findProviderLetter).toHaveBeenCalledOnce();
        expect(findProviderLetter).toHaveBeenCalledWith({
          noteId: secondLegacyId,
          signal: undefined,
        });
        expect(createProviderLetter).not.toHaveBeenCalled();
        await expect(observer.hostedPhysicalNote.findUnique({
          where: { id: secondLegacyId },
        })).resolves.toMatchObject({
          failureReason: null,
          status: "failed",
        });
      } finally {
        resolveFirstLegacy.resolve();
        await Promise.allSettled([holderTransaction]);
      }
    });

    it("selects an equal-timestamp recovery guard by a stable total order", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const ids = [
        `hpn_${randomUUID().replaceAll("-", "")}`,
        `hpn_${randomUUID().replaceAll("-", "")}`,
      ].sort();
      const oldestId = ids[0]!;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: ids.map((id, index) => ({
          complimentaryOfferCode: null,
          createdAt,
          failureReason: null,
          id,
          memberId: beneficiary,
          pricingVersion: "lob-test-v1",
          provider: "lob" as const,
          providerCostUsdMicros: 250_000n,
          requestFingerprint: `tied-legacy-fingerprint-${index}`,
          requestKey: `tied-legacy-${id}`,
          status: "failed" as const,
        })),
      });
      const createProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_must_not_send",
      }));
      const findProviderLetter = vi.fn(async () => ({
        kind: "indeterminate" as const,
      }));

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: buildRequest(7, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime: {
          create: createProviderLetter,
          findLetterByNoteId: findProviderLetter,
        },
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "pending",
      });
      expect(findProviderLetter).toHaveBeenCalledWith({
        noteId: oldestId,
        signal: undefined,
      });
      expect(createProviderLetter).not.toHaveBeenCalled();

      const repeatedOldestIds = await Promise.all(
        Array.from({ length: 5 }, async () =>
          (await observer.hostedPhysicalNote.findFirst({
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true },
            where: {
              memberId: beneficiary,
              OR: [
                { status: "starting" },
                { failureReason: null, status: "failed" },
              ],
            },
          }))?.id ?? null
        ),
      );
      expect(repeatedOldestIds).toEqual(Array(5).fill(oldestId));
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: oldestId },
      })).resolves.toMatchObject({
        failureReason: null,
        status: "failed",
      });
    });

    it("replays one accepted recovery input without advancing the next guard", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const firstId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const secondId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt,
            failureReason: null,
            id: firstId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `recovery-replay-first-${firstId}`,
            requestKey: `recovery-replay-first-${firstId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: null,
            createdAt: new Date(createdAt.getTime() + 1),
            failureReason: null,
            id: secondId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `recovery-replay-second-${secondId}`,
            requestKey: `recovery-replay-second-${secondId}`,
            status: "failed",
          },
        ],
      });
      const findProviderLetter = vi.fn(async (input: { noteId: string }) => ({
        kind: "accepted" as const,
        providerLetterId: `ltr_${input.noteId}`,
      }));
      const runtime = {
        async create() {
          throw new Error("Recovery must not create a physical note.");
        },
        findLetterByNoteId: findProviderLetter,
      };
      const firstOrigin = buildRequest(8, beneficiary).originAssistantInputId;

      const first = await recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: firstOrigin,
        prisma: observer,
        runtime,
      });
      const replay = await recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: firstOrigin,
        prisma: observer,
        runtime,
      });

      expect(first).toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });
      expect(replay).toEqual(first);
      expect(findProviderLetter).toHaveBeenCalledOnce();
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: secondId },
      })).resolves.toMatchObject({
        failureReason: null,
        providerLetterId: null,
        status: "failed",
      });
      await observer.hostedPhysicalNote.delete({ where: { id: firstId } });
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: firstOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: null,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: null,
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: firstOrigin,
        prisma: observer,
        runtime,
      })).resolves.toEqual(first);
      expect(findProviderLetter).toHaveBeenCalledOnce();

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId:
          buildRequest(9, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime,
      })).resolves.toEqual({
        remainingUnresolved: false,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });
      expect(findProviderLetter).toHaveBeenCalledTimes(2);
      expect(findProviderLetter.mock.calls.map(([input]) => input.noteId))
        .toEqual([firstId, secondId]);
    });

    it("targets an incomplete prior recovery without advancing the oldest guard", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const firstId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const secondId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const targetOrigin = buildRequest(26, beneficiary).originAssistantInputId;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt,
            failureReason: null,
            id: firstId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `targeted-incomplete-first-${firstId}`,
            requestKey: `targeted-incomplete-first-${firstId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: "physical-note-v1",
            createdAt: new Date(createdAt.getTime() + 1),
            id: secondId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `targeted-incomplete-second-${secondId}`,
            requestKey: `targeted-incomplete-second-${secondId}`,
            status: "starting",
          },
        ],
      });
      await observer.hostedPhysicalNoteRecovery.create({
        data: {
          memberId: beneficiary,
          originAssistantInputId: targetOrigin,
          physicalNoteId: secondId,
        },
      });
      const findProviderLetter = vi.fn(async (input: { noteId: string }) => {
        if (input.noteId !== secondId) {
          throw new Error("Targeted recovery looked up the wrong note.");
        }
        return {
          kind: "accepted" as const,
          providerLetterId: "ltr_targeted_incomplete_recovery",
        };
      });

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: buildRequest(27, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime: {
          async create() {
            throw new Error("Recovery must not create a physical note.");
          },
          findLetterByNoteId: findProviderLetter,
        },
        targetOriginAssistantInputId: targetOrigin,
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });

      expect(findProviderLetter).toHaveBeenCalledOnce();
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: firstId },
      })).resolves.toMatchObject({
        failureReason: null,
        providerLetterId: null,
        status: "failed",
      });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: secondId },
      })).resolves.toMatchObject({
        providerLetterId: "ltr_targeted_incomplete_recovery",
        status: "accepted",
      });
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    });

    it("rechecks a targeted pending recovery against its stored note", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const firstId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const secondId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const targetOrigin = buildRequest(28, beneficiary).originAssistantInputId;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt,
            failureReason: null,
            id: firstId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `targeted-pending-first-${firstId}`,
            requestKey: `targeted-pending-first-${firstId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: "physical-note-v1",
            createdAt: new Date(createdAt.getTime() + 1),
            id: secondId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `targeted-pending-second-${secondId}`,
            requestKey: `targeted-pending-second-${secondId}`,
            status: "starting",
          },
        ],
      });
      await observer.hostedPhysicalNoteRecovery.create({
        data: {
          memberId: beneficiary,
          originAssistantInputId: targetOrigin,
          physicalNoteId: secondId,
          remainingUnresolved: true,
          resultStatus: "pending",
          retryAfter: new Date(Date.now() - 1_000),
        },
      });
      const findProviderLetter = vi.fn(async (input: { noteId: string }) => {
        if (input.noteId !== secondId) {
          throw new Error("Targeted pending recovery looked up the wrong note.");
        }
        return {
          kind: "accepted" as const,
          providerLetterId: "ltr_targeted_pending_recovery",
        };
      });

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: buildRequest(29, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime: {
          async create() {
            throw new Error("Recovery must not create a physical note.");
          },
          findLetterByNoteId: findProviderLetter,
        },
        targetOriginAssistantInputId: targetOrigin,
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: buildRequest(30, beneficiary).originAssistantInputId,
        prisma: observer,
        runtime: {
          async create() {
            throw new Error("Recovery must not create a physical note.");
          },
          findLetterByNoteId: findProviderLetter,
        },
        targetOriginAssistantInputId: targetOrigin,
      })).resolves.toEqual({
        remainingUnresolved: true,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "accepted",
      });

      expect(findProviderLetter).toHaveBeenCalledOnce();
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: firstId },
      })).resolves.toMatchObject({
        failureReason: null,
        providerLetterId: null,
        status: "failed",
      });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: secondId },
      })).resolves.toMatchObject({
        providerLetterId: "ltr_targeted_pending_recovery",
        status: "accepted",
      });
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    });

    it("commits accepted recovery state, usage, blockers, and replay result atomically", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const noteId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const blockerId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const usageId = `usage_${randomUUID().replaceAll("-", "")}`;
      const usageTurnId = `turn_${randomUUID().replaceAll("-", "")}`;
      const failedOrigin = buildRequest(14, beneficiary).originAssistantInputId;
      const targetedReplayOrigin =
        buildRequest(15, beneficiary).originAssistantInputId;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt: new Date(Date.now() - 1_000),
            id: noteId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `atomic-accepted-${noteId}`,
            requestKey: `atomic-accepted-${noteId}`,
            status: "starting",
          },
          {
            complimentaryOfferCode: null,
            failureReason: "prior_note_unresolved",
            id: blockerId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `atomic-accepted-blocker-${blockerId}`,
            requestKey: `atomic-accepted-blocker-${blockerId}`,
            status: "failed",
          },
        ],
      });
      mocks.recordUsage.mockImplementation(async (input: {
        prisma?: Prisma.TransactionClient;
        trustedUserId?: string | null;
      }) => {
        if (!input.prisma || input.trustedUserId !== beneficiary) {
          throw new Error("Physical-note usage must use the member transaction.");
        }
        await input.prisma.hostedAiUsage.create({
          data: {
            attemptCount: 1,
            id: usageId,
            memberId: beneficiary,
            occurredAt: new Date(),
            provider: "lob",
            sessionId: `physical-note-${noteId}`,
            turnId: usageTurnId,
          },
        });
        return { recordedIds: [usageId] };
      });
      let failNextRecoveryCompletion = true;
      const recoveryClient = observer.$extends({
        query: {
          hostedPhysicalNoteRecovery: {
            async updateMany({ args, query }) {
              if (failNextRecoveryCompletion) {
                failNextRecoveryCompletion = false;
                throw new Error("simulated atomic recovery result failure");
              }
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      const findProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: `ltr_${noteId}`,
      }));
      const runtime = {
        async create() {
          throw new Error("Recovery must not create a physical note.");
        },
        findLetterByNoteId: findProviderLetter,
      };

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: failedOrigin,
        prisma: recoveryClient,
        runtime,
      })).rejects.toThrow("simulated atomic recovery result failure");
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: noteId },
      })).resolves.toMatchObject({
        acceptedAt: null,
        providerLetterId: null,
        status: "starting",
      });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: blockerId },
      })).resolves.toMatchObject({
        failureReason: "prior_note_unresolved",
        status: "failed",
      });
      await expect(observer.hostedAiUsage.count({
        where: { id: usageId },
      })).resolves.toBe(0);
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: failedOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: noteId,
        resultStatus: null,
        settledUsageCostUsdMicros: null,
      });
      const accepted = await recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: failedOrigin,
        prisma: recoveryClient,
        runtime,
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: failedOrigin,
        prisma: recoveryClient,
        runtime,
      })).resolves.toEqual(accepted);
      expect(accepted).toEqual({
        remainingUnresolved: false,
        retryAfter: null,
        settledUsageCostUsdMicros: "250000",
        status: "accepted",
      });
      expect(findProviderLetter).toHaveBeenCalledTimes(2);
      expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: noteId },
      })).resolves.toMatchObject({
        providerLetterId: `ltr_${noteId}`,
        status: "accepted",
      });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: blockerId },
      })).resolves.toMatchObject({
        failureReason: "prior_note_accepted",
        status: "failed",
      });
      await expect(observer.hostedAiUsage.count({
        where: { id: usageId },
      })).resolves.toBe(1);
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: failedOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: noteId,
        remainingUnresolved: false,
        resultStatus: "accepted",
        settledUsageCostUsdMicros: 250_000n,
      });
      await observer.hostedPhysicalNote.delete({ where: { id: noteId } });
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: failedOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: null,
        settledUsageCostUsdMicros: 250_000n,
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: failedOrigin,
        prisma: recoveryClient,
        runtime,
      })).resolves.toEqual(accepted);
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: targetedReplayOrigin,
        prisma: recoveryClient,
        runtime,
        targetOriginAssistantInputId: failedOrigin,
      })).resolves.toEqual(accepted);
      expect(findProviderLetter).toHaveBeenCalledTimes(2);
      expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
    });

    it("commits aged absence, blocker cleanup, and replay result atomically", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const noteId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const blockerId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const failedOrigin = buildRequest(16, beneficiary).originAssistantInputId;
      const retryOrigin = buildRequest(17, beneficiary).originAssistantInputId;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
            failureReason: null,
            id: noteId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `atomic-clear-${noteId}`,
            requestKey: `atomic-clear-${noteId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: null,
            failureReason: "prior_note_unresolved",
            id: blockerId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `atomic-clear-blocker-${blockerId}`,
            requestKey: `atomic-clear-blocker-${blockerId}`,
            status: "failed",
          },
        ],
      });
      let failNextRecoveryCompletion = true;
      const recoveryClient = observer.$extends({
        query: {
          hostedPhysicalNoteRecovery: {
            async updateMany({ args, query }) {
              if (failNextRecoveryCompletion) {
                failNextRecoveryCompletion = false;
                throw new Error("simulated atomic recovery result failure");
              }
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      const findProviderLetter = vi.fn(async () => ({
        kind: "absent" as const,
      }));
      const runtime = {
        async create() {
          throw new Error("Recovery must not create a physical note.");
        },
        findLetterByNoteId: findProviderLetter,
      };

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: failedOrigin,
        prisma: recoveryClient,
        runtime,
      })).rejects.toThrow("simulated atomic recovery result failure");
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: noteId },
      })).resolves.toMatchObject({ failureReason: null, status: "failed" });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: blockerId },
      })).resolves.toMatchObject({
        failureReason: "prior_note_unresolved",
        status: "failed",
      });
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: failedOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: noteId,
        resultStatus: null,
        settledUsageCostUsdMicros: null,
      });

      const cleared = await recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: retryOrigin,
        prisma: recoveryClient,
        runtime,
      });
      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId: retryOrigin,
        prisma: recoveryClient,
        runtime,
      })).resolves.toEqual(cleared);
      expect(cleared).toEqual({
        remainingUnresolved: false,
        retryAfter: null,
        settledUsageCostUsdMicros: null,
        status: "clear",
      });
      expect(findProviderLetter).toHaveBeenCalledTimes(2);
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: noteId },
      })).resolves.toMatchObject({ failureReason: "unknown", status: "failed" });
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: blockerId },
      })).resolves.toMatchObject({ failureReason: "unknown", status: "failed" });
      await expect(observer.hostedPhysicalNoteRecovery.findUnique({
        where: { originAssistantInputId: retryOrigin },
      })).resolves.toMatchObject({
        physicalNoteId: noteId,
        remainingUnresolved: false,
        resultStatus: "clear",
        settledUsageCostUsdMicros: null,
      });
    });

    it("keeps a restarted incomplete recovery bound to its terminalized guard", async () => {
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const completedId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const nextId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const originAssistantInputId =
        buildRequest(13, beneficiary).originAssistantInputId;
      const { recoverHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            acceptedAt: new Date(),
            complimentaryOfferCode: "physical-note-v1",
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
            failureReason: "prior_note_accepted",
            id: completedId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            providerLetterId: `ltr_${completedId}`,
            requestFingerprint: `recovery-interrupted-complete-${completedId}`,
            requestKey: `recovery-interrupted-complete-${completedId}`,
            status: "accepted",
          },
          {
            complimentaryOfferCode: null,
            failureReason: null,
            id: nextId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: `recovery-interrupted-next-${nextId}`,
            requestKey: `recovery-interrupted-next-${nextId}`,
            status: "failed",
          },
        ],
      });
      await observer.hostedPhysicalNoteRecovery.create({
        data: {
          memberId: beneficiary,
          originAssistantInputId,
          physicalNoteId: completedId,
        },
      });
      const findProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_must_not_reconcile_next",
      }));

      await expect(recoverHostedPhysicalNote({
        memberId: beneficiary,
        originAssistantInputId,
        prisma: observer,
        runtime: {
          async create() {
            throw new Error("Recovery must not create a physical note.");
          },
          findLetterByNoteId: findProviderLetter,
        },
      })).rejects.toThrow("recovery result is unconfirmed");
      expect(findProviderLetter).not.toHaveBeenCalled();
      await expect(observer.hostedPhysicalNote.findUnique({
        where: { id: nextId },
      })).resolves.toMatchObject({
        failureReason: null,
        providerLetterId: null,
        status: "failed",
      });
    });
  },
);

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized.");
      }
      resolvePromise(value);
    },
  };
}

async function readBackendPid(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the physical-note operation to wait on the member lock.");
}

function buildRequest(sequence: number, memberId: string) {
  return {
    artwork: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      sha256: sequence.toString(16).padStart(64, "0"),
      url: `https://assets.example.test/concurrent-note-${sequence}.png`,
    },
    memberId,
    originAssistantInputId: `ain_${sequence.toString(16).padStart(32, "0")}`,
    recipient: {
      addressLine1: "123 Main Street",
      city: "Atlanta",
      name: "Alex Example",
      postalCode: "30301",
      state: "GA",
    },
    requestKey: `physical-note-concurrent-${sequence}`,
  };
}

function buildRequestFingerprint(
  request: ReturnType<typeof buildRequest>,
): string {
  return createHash("sha256")
    .update("murph.hosted-physical-note.request.v1\0")
    .update(request.artwork.sha256)
    .update("\0")
    .update(request.originAssistantInputId)
    .update("\0")
    .update(stableHostedPhysicalNoteRecipientJson(
      normalizeHostedPhysicalNoteRecipient(request.recipient),
    ))
    .digest("hex");
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Physical-note concurrency Prisma client is unavailable.");
  }
  return value;
}

function requireMemberId(value: string | null): string {
  if (!value) {
    throw new Error("Physical-note concurrency member id is unavailable.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
        url.hostname.toLowerCase(),
      );
  } catch {
    return false;
  }
}
