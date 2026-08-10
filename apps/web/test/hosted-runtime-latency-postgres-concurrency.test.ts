import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  recordHostedIngressAssistantMilestone,
  recordHostedIngressProviderStarted,
} from "@/src/lib/hosted-runtime-latency/store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted runtime latency set-write proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted runtime latency PostgreSQL set writes",
  () => {
    it("preserves atomic merge, authority, sanitization, and UTC behavior under overlap", async () => {
      const timezoneDatabaseUrl = withPostgresSessionTimeZone(
        databaseUrl,
        "Australia/Sydney",
      );
      const observer = createPrismaClient({
        databaseUrl: timezoneDatabaseUrl,
        poolMax: 1,
      });
      const challenger = createPrismaClient({
        databaseUrl: timezoneDatabaseUrl,
        poolMax: 1,
      });
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `hbm_latency_set_${suffix}`;
      const assistantInputIds: [string, string] = [
        `assistant_input_latency_a_${suffix}`,
        `assistant_input_latency_b_${suffix}`,
      ];
      const rejectedAssistantInputId = `assistant_input_latency_rejected_${suffix}`;
      const untracedAssistantInputId = `assistant_input_latency_untraced_${suffix}`;
      const runtimeAttemptId = `runtime_latency_old_${suffix}`;
      const rejectedRuntimeAttemptId = `runtime_latency_rejected_${suffix}`;
      const transferredRuntimeAttemptId = `runtime_latency_new_${suffix}`;
      const acceptedAt = new Date("2026-08-09T12:00:00.000Z");

      try {
        await createLatencySetWriteFixture(observer, {
          acceptedAt,
          assistantInputIds,
          memberId,
          rejectedAssistantInputId,
          rejectedRuntimeAttemptId,
          runtimeAttemptId,
          suffix,
        });

        await expect(observer.$queryRaw<Array<{ timeZone: string }>>`
          SELECT current_setting('TimeZone') AS "timeZone"
        `).resolves.toEqual([{ timeZone: "Australia/Sydney" }]);

        const requestedAssistantInputIds = [
          assistantInputIds[1],
          rejectedAssistantInputId,
          untracedAssistantInputId,
          assistantInputIds[0],
        ];
        const firstProviderAt = new Date("2026-08-09T12:00:10.000Z");
        await expect(recordHostedIngressProviderStarted({
          assistantInputIds: requestedAssistantInputIds,
          at: firstProviderAt,
          authenticatedUserId: memberId,
          phaseBreakdown: {
            schemaVersion: 1,
            preProvider: { outboxScanPerformed: true },
            provider: { sessionResolveMs: 10 },
          },
          prisma: observer,
          providerRequestOrdinal: 2,
          runtimeAttemptId,
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 2,
          untracedCount: 1,
        });

        const earliestProviderAt = new Date("2026-08-09T12:00:05.000Z");
        await recordHostedIngressProviderStarted({
          assistantInputIds,
          at: earliestProviderAt,
          authenticatedUserId: memberId,
          prisma: observer,
          providerRequestOrdinal: 1,
          runtimeAttemptId,
          source: "linq",
        });

        const providerRows = await observer.hostedIngressLatencyTrace.findMany({
          orderBy: { assistantInputId: "asc" },
          select: {
            assistantInputId: true,
            phaseBreakdownJson: true,
            providerRequestOrdinal: true,
            providerStartAt: true,
            updatedAt: true,
          },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        expect(providerRows).toHaveLength(2);
        for (const row of providerRows) {
          expect(row.providerStartAt).toEqual(earliestProviderAt);
          expect(row.providerRequestOrdinal).toBe(1);
          expect(Math.abs(Date.now() - row.updatedAt.getTime())).toBeLessThan(60_000);
        }
        const sanitized = requireJsonRecord(providerRows[0]?.phaseBreakdownJson);
        expect(sanitized).toEqual({
          boot: { nodeStartupMs: 3 },
          orchestration: { triggeredByWebDirect: true },
          preProvider: { outboxScanPerformed: true },
          provider: { promptBuildMs: 9, sessionResolveMs: 10 },
          schemaVersion: 1,
        });
        const providerNoOpMarker = new Date("2026-08-09T12:00:06.000Z");
        await observer.hostedIngressLatencyTrace.updateMany({
          data: { updatedAt: providerNoOpMarker },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        await recordHostedIngressProviderStarted({
          assistantInputIds,
          at: earliestProviderAt,
          authenticatedUserId: memberId,
          prisma: observer,
          providerRequestOrdinal: 1,
          runtimeAttemptId,
          source: "linq",
        });
        await expect(observer.hostedIngressLatencyTrace.findMany({
          orderBy: { assistantInputId: "asc" },
          select: { updatedAt: true },
          where: { assistantInputId: { in: assistantInputIds } },
        })).resolves.toEqual([
          { updatedAt: providerNoOpMarker },
          { updatedAt: providerNoOpMarker },
        ]);

        const firstOutputAt = new Date("2026-08-09T12:00:30.000Z");
        await expect(recordHostedIngressAssistantMilestone({
          assistantInputIds: requestedAssistantInputIds,
          at: firstOutputAt,
          authenticatedUserId: memberId,
          milestone: "first_codex_output_observed",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 2,
          untracedCount: 1,
        });
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: new Date("2026-08-09T12:00:20.000Z"),
          authenticatedUserId: memberId,
          milestone: "first_codex_output_observed",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        });
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: new Date("2026-08-09T12:00:40.000Z"),
          authenticatedUserId: memberId,
          milestone: "progress_update_accepted",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        });
        const earliestProgressAt = new Date("2026-08-09T12:00:25.000Z");
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: earliestProgressAt,
          authenticatedUserId: memberId,
          milestone: "progress_update_accepted",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        });

        await Promise.all([
          recordHostedIngressAssistantMilestone({
            assistantInputIds,
            at: new Date("2026-08-09T12:00:50.000Z"),
            authenticatedUserId: memberId,
            milestone: "linq_typing_request_started",
            prisma: observer,
            runtimeAttemptId,
            runtimeLeaseGeneration: "4",
            source: "linq",
          }),
          recordHostedIngressAssistantMilestone({
            assistantInputIds: [...assistantInputIds].reverse(),
            at: new Date("2026-08-09T12:00:51.000Z"),
            authenticatedUserId: memberId,
            milestone: "linq_typing_accepted",
            prisma: challenger,
            runtimeAttemptId,
            runtimeLeaseGeneration: "4",
            source: "linq",
          }),
        ]);

        const ordinaryRows = await observer.hostedIngressLatencyTrace.findMany({
          select: { phaseBreakdownJson: true },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        for (const row of ordinaryRows) {
          const assistant = requireJsonRecord(
            requireJsonRecord(row.phaseBreakdownJson).assistant,
          );
          expect(assistant).toMatchObject({
            firstCodexOutputObservedAtEpochMs: firstOutputAt.getTime(),
            linqTypingAcceptedAtEpochMs: new Date(
              "2026-08-09T12:00:51.000Z",
            ).getTime(),
            linqTypingRequestStartedAtEpochMs: new Date(
              "2026-08-09T12:00:50.000Z",
            ).getTime(),
            progressUpdateAcceptedAtEpochMs: earliestProgressAt.getTime(),
          });
        }

        const terminalAt = new Date("2026-08-09T12:01:00.000Z");
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: terminalAt,
          authenticatedUserId: memberId,
          checkpointPublicationExpectedBy: new Date("2026-08-09T12:02:00.000Z"),
          milestone: "terminal_non_reply_committed",
          prisma: observer,
          runtimeAttemptId: transferredRuntimeAttemptId,
          runtimeLeaseGeneration: "5",
          source: "linq",
        });
        const terminalNoOpMarker = new Date("2026-08-09T12:01:01.000Z");
        await observer.hostedIngressLatencyTrace.updateMany({
          data: { updatedAt: terminalNoOpMarker },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: new Date("2026-08-09T12:03:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "terminal_non_reply_committed",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        });
        await recordHostedIngressAssistantMilestone({
          assistantInputIds,
          at: new Date("2026-08-09T12:04:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "terminal_non_reply_committed",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "5",
          source: "linq",
        });

        const terminalRows = await observer.hostedIngressLatencyTrace.findMany({
          select: {
            phaseBreakdownJson: true,
            runtimeAttemptId: true,
            updatedAt: true,
          },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        for (const row of terminalRows) {
          expect(row.runtimeAttemptId).toBe(transferredRuntimeAttemptId);
          expect(row.updatedAt).toEqual(terminalNoOpMarker);
          const assistant = requireJsonRecord(
            requireJsonRecord(row.phaseBreakdownJson).assistant,
          );
          expect(assistant).toMatchObject({
            checkpointPublicationExpectedByEpochMs: new Date(
              "2026-08-09T12:02:00.000Z",
            ).getTime(),
            runtimeLeaseGeneration: "5",
            terminalNonReplyCommittedAtEpochMs: terminalAt.getTime(),
          });
        }
      } finally {
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          observer.$disconnect(),
          challenger.$disconnect(),
        ]);
      }
    });
  },
);

async function createLatencySetWriteFixture(
  prisma: PrismaClient,
  input: {
    acceptedAt: Date;
    assistantInputIds: readonly [string, string];
    memberId: string;
    rejectedAssistantInputId: string;
    rejectedRuntimeAttemptId: string;
    runtimeAttemptId: string;
    suffix: string;
  },
): Promise<void> {
  await prisma.hostedMember.create({ data: { id: input.memberId } });
  const tracedAssistantInputIds = [
    ...input.assistantInputIds,
    input.rejectedAssistantInputId,
  ];
  await prisma.hostedMailboxItem.createMany({
    data: tracedAssistantInputIds.map((assistantInputId, index) => ({
      dedupeKey: `latency-set:${index}:${input.suffix}`,
      id: `hmi_latency_set_${index}_${input.suffix}`,
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: BigInt(index + 1),
      occurredAt: input.acceptedAt,
      payloadSchema: "murph.hosted-execution.conversation-message.v1",
      userId: input.memberId,
    })),
  });
  await prisma.hostedIngressLatencyTrace.createMany({
    data: tracedAssistantInputIds.map((assistantInputId, index) => ({
      acceptedAt: input.acceptedAt,
      assistantInputId,
      id: `hil_latency_set_${index}_${input.suffix}`,
      mailboxItemId: `hmi_latency_set_${index}_${input.suffix}`,
      mailboxLane: "conversation",
      mailboxLaneSeq: BigInt(index + 1),
      phaseBreakdownJson: index === 0
        ? {
            assistant: { firstCodexOutputObservedAtEpochMs: "wrong-type" },
            boot: { nodeStartupMs: 3, restoreWasCold: "wrong-type" },
            orchestration: {
              directEnsureOrchestrationAttemptId: "wrong-type",
              triggeredByWebDirect: true,
            },
            provider: {
              promptBuildMs: 9,
              sessionResolveMs: "wrong-type",
              unknownLeaf: "discard",
            },
            schemaVersion: "wrong-type",
            unknownPhase: { unknownLeaf: "discard" },
          }
        : undefined,
      runtimeAttemptId: index === 2
        ? input.rejectedRuntimeAttemptId
        : input.runtimeAttemptId,
      source: "linq",
      userId: input.memberId,
    })),
  });
}

function requireJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object in the latency trace proof.");
  }
  return Object.fromEntries(Object.entries(value));
}

function withPostgresSessionTimeZone(value: string, timeZone: string): string {
  const url = new URL(value);
  url.searchParams.set("options", `-c timezone=${timeZone}`);
  return url.toString();
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
