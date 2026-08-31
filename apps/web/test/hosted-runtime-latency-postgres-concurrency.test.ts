import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  recordHostedIngressAssistantMilestone,
  recordHostedIngressProviderStarted,
  recordHostedIngressRuntimeMilestone,
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
    it("locks ordinary runtime milestones in trace-id order", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `hbm_latency_lock_order_${suffix}`;
      const runtimeAttemptId = `runtime_latency_lock_order_${suffix}`;
      const lowerTraceId = `hil_latency_lock_order_a_${suffix}`;
      const higherTraceId = `hil_latency_lock_order_z_${suffix}`;
      const applicationName = `latency_lock_order_${suffix.slice(0, 8)}`;
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({
        databaseUrl: withPostgresLockOrderProbe(
          databaseUrl,
          applicationName,
        ),
        poolMax: 1,
      });
      let releaseLowerTraceLock!: () => void;
      const lowerTraceLockRelease = new Promise<void>((resolve) => {
        releaseLowerTraceLock = resolve;
      });
      let lowerTraceLockAcquired!: () => void;
      const lowerTraceLockReady = new Promise<void>((resolve) => {
        lowerTraceLockAcquired = resolve;
      });
      const inFlight: Promise<unknown>[] = [];

      try {
        await blocker.hostedMember.create({ data: { id: memberId } });
        await blocker.hostedMailboxItem.createMany({
          data: [higherTraceId, lowerTraceId].map((traceId, index) => ({
            dedupeKey: `latency-lock-order:${index}:${suffix}`,
            id: `hmi_${traceId}`,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: BigInt(index + 1),
            occurredAt: new Date("2026-08-09T12:00:00.000Z"),
            payloadSchema: "murph.hosted-execution.conversation-message.v1",
            userId: memberId,
          })),
        });
        // Insert the higher trace ID first so the old unordered UPDATE takes it
        // before blocking on the lower ID under the forced sequential plan.
        await blocker.hostedIngressLatencyTrace.createMany({
          data: [higherTraceId, lowerTraceId].map((traceId, index) => ({
            acceptedAt: new Date(`2026-08-09T12:00:0${index}.000Z`),
            assistantInputId: `assistant_input_${traceId}`,
            id: traceId,
            mailboxItemId: `hmi_${traceId}`,
            mailboxLane: "conversation",
            mailboxLaneSeq: BigInt(index + 1),
            runtimeAttemptId,
            source: "linq",
            userId: memberId,
          })),
        });

        const blockerPromise = blocker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_ingress_latency_trace
            WHERE id = ${lowerTraceId}
            FOR UPDATE
          `;
          lowerTraceLockAcquired();
          await lowerTraceLockRelease;
        });
        inFlight.push(blockerPromise);
        await lowerTraceLockReady;

        const milestoneAt = new Date("2026-08-09T12:00:10.000Z");
        const writerPromise = recordHostedIngressRuntimeMilestone({
          at: milestoneAt,
          authenticatedUserId: memberId,
          milestone: "mailbox_import_done",
          prisma: writer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "1",
          source: "linq",
        });
        inFlight.push(writerPromise);
        await waitForPostgresLock({ applicationName, observer });

        await expect(observer.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_ingress_latency_trace
            WHERE id = ${higherTraceId}
            FOR UPDATE NOWAIT
          `;
        })).resolves.toBeUndefined();

        releaseLowerTraceLock();
        await blockerPromise;
        await expect(writerPromise).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });
        await expect(observer.hostedIngressLatencyTrace.findMany({
          orderBy: { id: "asc" },
          select: { mailboxImportDoneAt: true },
          where: { id: { in: [lowerTraceId, higherTraceId] } },
        })).resolves.toEqual([
          { mailboxImportDoneAt: milestoneAt },
          { mailboxImportDoneAt: milestoneAt },
        ]);
      } finally {
        releaseLowerTraceLock();
        await Promise.allSettled(inFlight);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          blocker.$disconnect(),
          observer.$disconnect(),
          writer.$disconnect(),
        ]);
      }
    });

    it("skips locked retry-backed rows and records after retry", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `hbm_latency_skip_locked_${suffix}`;
      const assistantInputId = `assistant_input_latency_skip_locked_${suffix}`;
      const mailboxItemId = `hmi_latency_skip_locked_${suffix}`;
      const traceId = `hil_latency_skip_locked_${suffix}`;
      const availableAssistantInputId =
        `assistant_input_latency_skip_locked_available_${suffix}`;
      const availableMailboxItemId =
        `hmi_latency_skip_locked_available_${suffix}`;
      const availableTraceId = `hil_latency_skip_locked_available_${suffix}`;
      const runtimeAttemptId = `runtime_latency_skip_locked_${suffix}`;
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      let releaseTraceLock!: () => void;
      const traceLockRelease = new Promise<void>((resolve) => {
        releaseTraceLock = resolve;
      });
      let traceLockAcquired!: () => void;
      const traceLockReady = new Promise<void>((resolve) => {
        traceLockAcquired = resolve;
      });
      const inFlight: Promise<unknown>[] = [];

      try {
        const acceptedAt = new Date("2026-08-09T12:15:00.000Z");
        await blocker.hostedMember.create({ data: { id: memberId } });
        await blocker.hostedMailboxItem.create({
          data: {
            dedupeKey: `latency-skip-locked:${suffix}`,
            id: mailboxItemId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 1n,
            occurredAt: acceptedAt,
            payloadSchema: "murph.hosted-execution.conversation-message.v1",
            userId: memberId,
          },
        });
        await blocker.hostedIngressLatencyTrace.create({
          data: {
            acceptedAt,
            assistantInputId,
            id: traceId,
            mailboxItemId,
            mailboxLane: "conversation",
            mailboxLaneSeq: 1n,
            runtimeAttemptId,
            source: "linq",
            userId: memberId,
          },
        });
        await writer.$queryRaw`SELECT 1`;

        const blockerPromise = blocker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_ingress_latency_trace
            WHERE id = ${traceId}
            FOR UPDATE
          `;
          traceLockAcquired();
          await traceLockRelease;
        });
        inFlight.push(blockerPromise);
        await traceLockReady;

        const providerStartedAt = new Date("2026-08-09T12:15:10.000Z");
        const providerInput = {
          assistantInputIds: [assistantInputId],
          at: providerStartedAt,
          authenticatedUserId: memberId,
          prisma: writer,
          providerRequestOrdinal: 0,
          runtimeAttemptId,
          source: "linq",
        } satisfies Parameters<typeof recordHostedIngressProviderStarted>[0];
        const providerWhileLocked = recordHostedIngressProviderStarted(
          providerInput,
        );
        inFlight.push(providerWhileLocked);
        await expect(withPostgresProofDeadline(
          providerWhileLocked,
          "Expected provider-start row claim to skip a conflicting lock.",
        )).resolves.toEqual({
          matchedCount: 0,
          recorded: false,
          unmatchedCount: 1,
        });

        const providerClientProbe = writer.$queryRaw<Array<{ value: number }>>`
          SELECT 1::integer AS value
        `;
        inFlight.push(providerClientProbe);
        await expect(withPostgresProofDeadline(
          providerClientProbe,
          "Expected the skipped provider-start claim to release its pooled client.",
        )).resolves.toEqual([{ value: 1 }]);

        const assistantMilestoneAt = new Date("2026-08-09T12:15:20.000Z");
        const assistantInput = {
          assistantInputIds: [assistantInputId],
          at: assistantMilestoneAt,
          authenticatedUserId: memberId,
          milestone: "first_codex_output_observed",
          prisma: writer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "1",
          source: "linq",
        } satisfies Parameters<typeof recordHostedIngressAssistantMilestone>[0];
        const assistantWhileLocked = recordHostedIngressAssistantMilestone(
          assistantInput,
        );
        inFlight.push(assistantWhileLocked);
        await expect(withPostgresProofDeadline(
          assistantWhileLocked,
          "Expected assistant-milestone row claim to skip a conflicting lock.",
        )).resolves.toEqual({
          matchedCount: 0,
          recorded: false,
          unmatchedCount: 1,
        });

        const assistantClientProbe = writer.$queryRaw<Array<{ value: number }>>`
          SELECT 1::integer AS value
        `;
        inFlight.push(assistantClientProbe);
        await expect(withPostgresProofDeadline(
          assistantClientProbe,
          "Expected the skipped assistant claim to release its pooled client.",
        )).resolves.toEqual([{ value: 1 }]);

        await writer.hostedMailboxItem.create({
          data: {
            dedupeKey: `latency-skip-locked-available:${suffix}`,
            id: availableMailboxItemId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 2n,
            occurredAt: new Date(acceptedAt.getTime() + 1_000),
            payloadSchema: "murph.hosted-execution.conversation-message.v1",
            userId: memberId,
          },
        });
        await writer.hostedIngressLatencyTrace.create({
          data: {
            acceptedAt: new Date(acceptedAt.getTime() + 1_000),
            assistantInputId: availableAssistantInputId,
            id: availableTraceId,
            mailboxItemId: availableMailboxItemId,
            mailboxLane: "conversation",
            mailboxLaneSeq: 2n,
            runtimeAttemptId,
            source: "linq",
            userId: memberId,
          },
        });

        const batchedProviderInput = {
          ...providerInput,
          assistantInputIds: [assistantInputId, availableAssistantInputId],
        } satisfies Parameters<typeof recordHostedIngressProviderStarted>[0];
        const batchedProviderWhileLocked = recordHostedIngressProviderStarted(
          batchedProviderInput,
        );
        inFlight.push(batchedProviderWhileLocked);
        await expect(withPostgresProofDeadline(
          batchedProviderWhileLocked,
          "Expected provider-start to update free rows without waiting.",
        )).resolves.toEqual({
          matchedCount: 1,
          recorded: true,
          unmatchedCount: 1,
        });

        const batchedAssistantInput = {
          ...assistantInput,
          assistantInputIds: [assistantInputId, availableAssistantInputId],
        } satisfies Parameters<typeof recordHostedIngressAssistantMilestone>[0];
        const batchedAssistantWhileLocked =
          recordHostedIngressAssistantMilestone(
            batchedAssistantInput,
          );
        inFlight.push(batchedAssistantWhileLocked);
        await expect(withPostgresProofDeadline(
          batchedAssistantWhileLocked,
          "Expected assistant milestone to update free rows without waiting.",
        )).resolves.toEqual({
          matchedCount: 1,
          recorded: true,
          unmatchedCount: 1,
        });

        const availableTrace =
          await writer.hostedIngressLatencyTrace.findUniqueOrThrow({
            select: {
              phaseBreakdownJson: true,
              providerRequestOrdinal: true,
              providerStartAt: true,
            },
            where: { id: availableTraceId },
          });
        expect(availableTrace.providerRequestOrdinal).toBe(0);
        expect(availableTrace.providerStartAt).toEqual(providerStartedAt);
        expect(
          requireJsonRecord(
            requireJsonRecord(availableTrace.phaseBreakdownJson).assistant,
          ),
        ).toMatchObject({
          firstCodexOutputObservedAtEpochMs: assistantMilestoneAt.getTime(),
        });

        releaseTraceLock();
        await blockerPromise;

        await expect(
          recordHostedIngressProviderStarted(batchedProviderInput),
        ).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });
        await expect(
          recordHostedIngressAssistantMilestone(batchedAssistantInput),
        ).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });

        const trace = await writer.hostedIngressLatencyTrace.findUniqueOrThrow({
          select: {
            phaseBreakdownJson: true,
            providerRequestOrdinal: true,
            providerStartAt: true,
            runtimeAttemptId: true,
          },
          where: { id: traceId },
        });
        expect(trace.providerStartAt).toEqual(providerStartedAt);
        expect(trace.providerRequestOrdinal).toBe(0);
        expect(trace.runtimeAttemptId).toBe(runtimeAttemptId);
        expect(
          requireJsonRecord(
            requireJsonRecord(trace.phaseBreakdownJson).assistant,
          ),
        ).toMatchObject({
          firstCodexOutputObservedAtEpochMs: assistantMilestoneAt.getTime(),
        });
      } finally {
        releaseTraceLock();
        await Promise.allSettled(inFlight);
        await writer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          blocker.$disconnect(),
          writer.$disconnect(),
        ]);
      }
    });

    it("does not let an older checkpoint lease overwrite a newer lease after waiting", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `hbm_latency_lease_race_${suffix}`;
      const lowerTraceId = `hil_latency_lease_race_a_${suffix}`;
      const higherTraceId = `hil_latency_lease_race_z_${suffix}`;
      const originalRuntimeAttemptId = `runtime_latency_lease_original_${suffix}`;
      const newerRuntimeAttemptId = `runtime_latency_lease_newer_${suffix}`;
      const olderRuntimeAttemptId = `runtime_latency_lease_older_${suffix}`;
      const newerApplicationName = `latency_lease_newer_${suffix.slice(0, 8)}`;
      const olderApplicationName = `latency_lease_older_${suffix.slice(0, 8)}`;
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const newerWriter = createPrismaClient({
        databaseUrl: withPostgresLockOrderProbe(
          databaseUrl,
          newerApplicationName,
        ),
        poolMax: 1,
      });
      const olderWriter = createPrismaClient({
        databaseUrl: withPostgresLockOrderProbe(
          databaseUrl,
          olderApplicationName,
        ),
        poolMax: 1,
      });
      let releaseHigherTraceLock!: () => void;
      const higherTraceLockRelease = new Promise<void>((resolve) => {
        releaseHigherTraceLock = resolve;
      });
      let higherTraceLockAcquired!: () => void;
      const higherTraceLockReady = new Promise<void>((resolve) => {
        higherTraceLockAcquired = resolve;
      });
      const inFlight: Promise<unknown>[] = [];

      try {
        const acceptedAt = new Date("2026-08-09T12:30:00.000Z");
        await blocker.hostedMember.create({ data: { id: memberId } });
        await blocker.hostedMailboxItem.createMany({
          data: [lowerTraceId, higherTraceId].map((traceId, index) => ({
            dedupeKey: `latency-lease-race:${index}:${suffix}`,
            id: `hmi_${traceId}`,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: BigInt(index + 1),
            occurredAt: acceptedAt,
            payloadSchema: "murph.hosted-execution.conversation-message.v1",
            userId: memberId,
          })),
        });
        await blocker.hostedIngressLatencyTrace.createMany({
          data: [lowerTraceId, higherTraceId].map((traceId, index) => ({
            acceptedAt: new Date(acceptedAt.getTime() + index * 1_000),
            assistantInputId: `assistant_input_${traceId}`,
            id: traceId,
            mailboxItemId: `hmi_${traceId}`,
            mailboxLane: "conversation",
            mailboxLaneSeq: BigInt(index + 1),
            phaseBreakdownJson: {
              assistant: {
                runtimeLeaseGeneration: "1",
                terminalNonReplyCommittedAtEpochMs: acceptedAt.getTime(),
              },
              schemaVersion: 1,
            },
            runtimeAttemptId: originalRuntimeAttemptId,
            source: "linq",
            userId: memberId,
          })),
        });

        const blockerPromise = blocker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_ingress_latency_trace
            WHERE id = ${higherTraceId}
            FOR UPDATE
          `;
          higherTraceLockAcquired();
          await higherTraceLockRelease;
        });
        inFlight.push(blockerPromise);
        await higherTraceLockReady;

        const newerExpectedBy = new Date("2026-08-09T12:40:00.000Z");
        const newerWriterPromise = recordHostedIngressRuntimeMilestone({
          at: newerExpectedBy,
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: newerWriter,
          runtimeAttemptId: newerRuntimeAttemptId,
          runtimeLeaseGeneration: "3",
          source: "linq",
        });
        inFlight.push(newerWriterPromise);
        await waitForPostgresLock({
          applicationName: newerApplicationName,
          observer,
        });

        const olderWriterPromise = recordHostedIngressRuntimeMilestone({
          at: new Date("2026-08-09T12:50:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: olderWriter,
          runtimeAttemptId: olderRuntimeAttemptId,
          runtimeLeaseGeneration: "2",
          source: "linq",
        });
        inFlight.push(olderWriterPromise);
        await waitForPostgresLock({
          applicationName: olderApplicationName,
          observer,
        });

        releaseHigherTraceLock();
        await blockerPromise;
        await expect(newerWriterPromise).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });
        await expect(olderWriterPromise).resolves.toEqual({
          matchedCount: 0,
          recorded: false,
          unmatchedCount: 0,
        });

        const rows = await observer.hostedIngressLatencyTrace.findMany({
          orderBy: { id: "asc" },
          select: { phaseBreakdownJson: true, runtimeAttemptId: true },
          where: { id: { in: [lowerTraceId, higherTraceId] } },
        });
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.runtimeAttemptId).toBe(newerRuntimeAttemptId);
          expect(
            requireJsonRecord(
              requireJsonRecord(row.phaseBreakdownJson).assistant,
            ),
          ).toMatchObject({
            checkpointPublicationExpectedByEpochMs: newerExpectedBy.getTime(),
            runtimeLeaseGeneration: "3",
          });
        }
      } finally {
        releaseHigherTraceLock();
        await Promise.allSettled(inFlight);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          blocker.$disconnect(),
          newerWriter.$disconnect(),
          observer.$disconnect(),
          olderWriter.$disconnect(),
        ]);
      }
    });

    it("updates only the newest 250 checkpoint traces and keeps replay a no-op", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `hbm_latency_boundary_${suffix}`;
      const priorRuntimeAttemptId = `runtime_latency_boundary_old_${suffix}`;
      const nextRuntimeAttemptId = `runtime_latency_boundary_new_${suffix}`;
      const acceptedAt = new Date("2026-08-09T13:00:00.000Z");
      const checkpointExpectedBy = new Date("2026-08-09T14:00:00.000Z");
      const rowCount = 252;

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await prisma.hostedMailboxItem.createMany({
          data: Array.from({ length: rowCount }, (_, index) => {
            const ordinal = index.toString().padStart(3, "0");
            return {
              dedupeKey: `latency-boundary:${ordinal}:${suffix}`,
              id: `hmi_latency_boundary_${ordinal}_${suffix}`,
              kind: "conversation.message",
              lane: "conversation",
              laneSeq: BigInt(index + 1),
              occurredAt: acceptedAt,
              payloadSchema: "murph.hosted-execution.conversation-message.v1",
              userId: memberId,
            };
          }),
        });
        await prisma.hostedIngressLatencyTrace.createMany({
          data: Array.from({ length: rowCount }, (_, index) => {
            const ordinal = index.toString().padStart(3, "0");
            return {
              acceptedAt: new Date(acceptedAt.getTime() + index * 1_000),
              assistantInputId:
                `assistant_input_latency_boundary_${ordinal}_${suffix}`,
              id: `hil_latency_boundary_${ordinal}_${suffix}`,
              mailboxItemId: `hmi_latency_boundary_${ordinal}_${suffix}`,
              mailboxLane: "conversation",
              mailboxLaneSeq: BigInt(index + 1),
              phaseBreakdownJson: {
                assistant: {
                  runtimeLeaseGeneration: "1",
                  terminalNonReplyCommittedAtEpochMs: acceptedAt.getTime(),
                },
                schemaVersion: 1,
              },
              runtimeAttemptId: priorRuntimeAttemptId,
              source: "linq",
              userId: memberId,
            };
          }),
        });

        await expect(recordHostedIngressRuntimeMilestone({
          at: checkpointExpectedBy,
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma,
          runtimeAttemptId: nextRuntimeAttemptId,
          runtimeLeaseGeneration: "2",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 250,
          recorded: true,
          truncated: true,
          unmatchedCount: 0,
        });

        const selectedRows = await prisma.hostedIngressLatencyTrace.findMany({
          orderBy: { acceptedAt: "asc" },
          select: {
            phaseBreakdownJson: true,
            runtimeAttemptId: true,
          },
          where: { userId: memberId },
        });
        expect(selectedRows).toHaveLength(rowCount);
        for (const [index, row] of selectedRows.entries()) {
          const assistant = requireJsonRecord(
            requireJsonRecord(row.phaseBreakdownJson).assistant,
          );
          if (index < 2) {
            expect(row.runtimeAttemptId).toBe(priorRuntimeAttemptId);
            expect(assistant).toEqual({
              runtimeLeaseGeneration: "1",
              terminalNonReplyCommittedAtEpochMs: acceptedAt.getTime(),
            });
          } else {
            expect(row.runtimeAttemptId).toBe(nextRuntimeAttemptId);
            expect(assistant).toEqual({
              checkpointPublicationExpectedByEpochMs:
                checkpointExpectedBy.getTime(),
              runtimeLeaseGeneration: "2",
              terminalNonReplyCommittedAtEpochMs: acceptedAt.getTime(),
            });
          }
        }

        const replayNoOpMarker = new Date("2026-08-09T14:00:01.000Z");
        await prisma.hostedIngressLatencyTrace.updateMany({
          data: { updatedAt: replayNoOpMarker },
          where: { userId: memberId },
        });
        await expect(recordHostedIngressRuntimeMilestone({
          at: new Date("2026-08-09T13:59:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma,
          runtimeAttemptId: nextRuntimeAttemptId,
          runtimeLeaseGeneration: "2",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 250,
          recorded: true,
          truncated: true,
          unmatchedCount: 0,
        });
        await expect(prisma.hostedIngressLatencyTrace.count({
          where: {
            updatedAt: replayNoOpMarker,
            userId: memberId,
          },
        })).resolves.toBe(rowCount);
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

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
          orchestration: {
            runtimeInvocationOrchestrationAttemptId:
              "web-ingress-123e4567-e89b-42d3-a456-426614174000",
            shellPrewarmExpectedOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
            shellPrewarmFirstHintAtEpochMs: 1_775_908_800_001,
            shellPrewarmOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
            shellPrewarmOutcome: "start_issued_warm",
            shellPrewarmSource: "linq-typing-started",
            triggeredByWebDirect: true,
          },
          preProvider: { outboxScanPerformed: true },
          provider: { promptBuildMs: 9, sessionResolveMs: 10 },
          schemaVersion: 1,
        });
        expect(requireJsonRecord(providerRows[1]?.phaseBreakdownJson)).toEqual({
          orchestration: {
            shellPrewarmExpectedOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
            shellPrewarmOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
          },
          preProvider: { outboxScanPerformed: true },
          provider: { sessionResolveMs: 10 },
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
          const phaseBreakdown = requireJsonRecord(row.phaseBreakdownJson);
          const assistant = requireJsonRecord(phaseBreakdown.assistant);
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
          expect(requireJsonRecord(phaseBreakdown.orchestration)).toMatchObject({
            shellPrewarmExpectedOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
            shellPrewarmOrchestrationAttemptId:
              "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
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

        await observer.hostedIngressLatencyTrace.updateMany({
          data: {
            phaseBreakdownJson: {
              assistant: {
                checkpointPublicationExpectedByEpochMs: "wrong-type",
                runtimeLeaseGeneration: "5",
                terminalNonReplyCommittedAtEpochMs: terminalAt.getTime(),
                unknownLeaf: "discard",
              },
              provider: { promptBuildMs: 9, unknownLeaf: "discard" },
              schemaVersion: "wrong-type",
              unknownPhase: { unknownLeaf: "discard" },
            },
          },
          where: { assistantInputId: assistantInputIds[0] },
        });

        await expect(recordHostedIngressRuntimeMilestone({
          at: new Date("2026-08-09T12:05:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: observer,
          runtimeAttemptId,
          runtimeLeaseGeneration: "4",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 0,
          recorded: false,
          unmatchedCount: 0,
        });

        const checkpointRecoveryAttemptId = `runtime_latency_checkpoint_${suffix}`;
        const checkpointExpectedBy = new Date("2026-08-09T12:06:00.000Z");
        await expect(recordHostedIngressRuntimeMilestone({
          at: checkpointExpectedBy,
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: observer,
          runtimeAttemptId: checkpointRecoveryAttemptId,
          runtimeLeaseGeneration: "6",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });

        const checkpointNoOpMarker = new Date("2026-08-09T12:06:01.000Z");
        await observer.hostedIngressLatencyTrace.updateMany({
          data: { updatedAt: checkpointNoOpMarker },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        await expect(recordHostedIngressRuntimeMilestone({
          at: new Date("2026-08-09T12:05:30.000Z"),
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: observer,
          runtimeAttemptId: checkpointRecoveryAttemptId,
          runtimeLeaseGeneration: "6",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });

        const checkpointRows = await observer.hostedIngressLatencyTrace.findMany({
          orderBy: { assistantInputId: "asc" },
          select: {
            phaseBreakdownJson: true,
            runtimeAttemptId: true,
            updatedAt: true,
          },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        for (const row of checkpointRows) {
          expect(row.runtimeAttemptId).toBe(checkpointRecoveryAttemptId);
          expect(row.updatedAt).toEqual(checkpointNoOpMarker);
          const assistant = requireJsonRecord(
            requireJsonRecord(row.phaseBreakdownJson).assistant,
          );
          expect(assistant).toMatchObject({
            checkpointPublicationExpectedByEpochMs:
              checkpointExpectedBy.getTime(),
            runtimeLeaseGeneration: "6",
            terminalNonReplyCommittedAtEpochMs: terminalAt.getTime(),
          });
        }
        expect(checkpointRows[0]?.phaseBreakdownJson).toEqual({
          assistant: {
            checkpointPublicationExpectedByEpochMs:
              checkpointExpectedBy.getTime(),
            runtimeLeaseGeneration: "6",
            terminalNonReplyCommittedAtEpochMs: terminalAt.getTime(),
          },
          provider: { promptBuildMs: 9 },
          schemaVersion: 1,
        });

        const concurrentOlderAttemptId = `runtime_latency_concurrent_older_${suffix}`;
        const concurrentNewerAttemptId = `runtime_latency_concurrent_newer_${suffix}`;
        const [olderLeaseResult, newerLeaseResult] = await Promise.all([
          recordHostedIngressRuntimeMilestone({
            at: new Date("2026-08-09T12:08:00.000Z"),
            authenticatedUserId: memberId,
            milestone: "checkpoint_publication_expected_by",
            prisma: observer,
            runtimeAttemptId: concurrentOlderAttemptId,
            runtimeLeaseGeneration: "7",
            source: "linq",
          }),
          recordHostedIngressRuntimeMilestone({
            at: new Date("2026-08-09T12:07:00.000Z"),
            authenticatedUserId: memberId,
            milestone: "checkpoint_publication_expected_by",
            prisma: challenger,
            runtimeAttemptId: concurrentNewerAttemptId,
            runtimeLeaseGeneration: "8",
            source: "linq",
          }),
        ]);
        expect([0, 2]).toContain(olderLeaseResult.matchedCount);
        expect(newerLeaseResult).toEqual({
          matchedCount: 2,
          recorded: true,
          unmatchedCount: 0,
        });
        const concurrentRows = await observer.hostedIngressLatencyTrace.findMany({
          select: { phaseBreakdownJson: true, runtimeAttemptId: true },
          where: { assistantInputId: { in: assistantInputIds } },
        });
        for (const row of concurrentRows) {
          expect(row.runtimeAttemptId).toBe(concurrentNewerAttemptId);
          const assistant = requireJsonRecord(
            requireJsonRecord(row.phaseBreakdownJson).assistant,
          );
          expect(assistant.runtimeLeaseGeneration).toBe("8");
          expect([
            new Date("2026-08-09T12:07:00.000Z").getTime(),
            new Date("2026-08-09T12:08:00.000Z").getTime(),
          ]).toContain(assistant.checkpointPublicationExpectedByEpochMs);
        }

        await expect(Promise.all([
          recordHostedIngressRuntimeMilestone({
            at: new Date("2026-08-09T12:08:30.000Z"),
            authenticatedUserId: memberId,
            milestone: "checkpoint_publication_expected_by",
            prisma: observer,
            runtimeAttemptId: concurrentNewerAttemptId,
            runtimeLeaseGeneration: "8",
            source: "linq",
          }),
          recordHostedIngressProviderStarted({
            assistantInputIds: [...assistantInputIds].reverse(),
            at: new Date("2026-08-09T12:00:04.000Z"),
            authenticatedUserId: memberId,
            prisma: challenger,
            providerRequestOrdinal: 0,
            runtimeAttemptId: concurrentNewerAttemptId,
            source: "linq",
          }),
        ])).resolves.toHaveLength(2);

        await expect(Promise.all([
          recordHostedIngressRuntimeMilestone({
            at: new Date("2026-08-09T12:08:20.000Z"),
            authenticatedUserId: memberId,
            milestone: "checkpoint_publication_expected_by",
            prisma: observer,
            runtimeAttemptId: concurrentNewerAttemptId,
            runtimeLeaseGeneration: "8",
            source: "linq",
          }),
          recordHostedIngressAssistantMilestone({
            assistantInputIds: [...assistantInputIds].reverse(),
            at: new Date("2026-08-09T12:08:10.000Z"),
            authenticatedUserId: memberId,
            milestone: "first_codex_text_observed",
            prisma: challenger,
            runtimeAttemptId: concurrentNewerAttemptId,
            runtimeLeaseGeneration: "8",
            source: "linq",
          }),
        ])).resolves.toHaveLength(2);

        await observer.hostedMailboxItem.update({
          data: { consumedAt: new Date("2026-08-09T12:06:30.000Z") },
          where: { id: `hmi_latency_set_0_${suffix}` },
        });
        const postConsumptionAttemptId = `runtime_latency_post_consumption_${suffix}`;
        await expect(recordHostedIngressRuntimeMilestone({
          at: new Date("2026-08-09T12:09:00.000Z"),
          authenticatedUserId: memberId,
          milestone: "checkpoint_publication_expected_by",
          prisma: observer,
          runtimeAttemptId: postConsumptionAttemptId,
          runtimeLeaseGeneration: "9",
          source: "linq",
        })).resolves.toEqual({
          matchedCount: 1,
          recorded: true,
          unmatchedCount: 0,
        });
        await expect(observer.hostedIngressLatencyTrace.findMany({
          orderBy: { assistantInputId: "asc" },
          select: { runtimeAttemptId: true },
          where: { assistantInputId: { in: assistantInputIds } },
        })).resolves.toEqual([
          { runtimeAttemptId: concurrentNewerAttemptId },
          { runtimeAttemptId: postConsumptionAttemptId },
        ]);
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
      acceptedAt: new Date(input.acceptedAt.getTime() + index * 1_000),
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
              runtimeInvocationOrchestrationAttemptId:
                "web-ingress-123e4567-e89b-42d3-a456-426614174000",
              shellPrewarmExpectedOrchestrationAttemptId:
                "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
              shellPrewarmFirstHintAtEpochMs: 1_775_908_800_001,
              shellPrewarmOrchestrationAttemptId:
                "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
              shellPrewarmOutcome: "start_issued_warm",
              shellPrewarmSource: "linq-typing-started",
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
        : index === 1
          ? {
              orchestration: {
                shellPrewarmExpectedOrchestrationAttemptId:
                  "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
                shellPrewarmOrchestrationAttemptId:
                  "web-prewarm-123e4567-e89b-42d3-a456-426614174000",
                shellPrewarmOutcome: "wrong-type",
              },
              schemaVersion: 1,
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

function withPostgresLockOrderProbe(value: string, applicationName: string): string {
  const url = new URL(value);
  url.searchParams.set("application_name", applicationName);
  url.searchParams.set(
    "options",
    "-c enable_indexscan=off -c enable_bitmapscan=off",
  );
  return url.toString();
}

async function waitForPostgresLock(input: {
  applicationName: string;
  observer: ReturnType<typeof createPrismaClient>;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${input.applicationName}
        AND state = 'active'
    `;
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the latency writer to wait on a row lock.");
}

async function withPostgresProofDeadline<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), 1_000);
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
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
