import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import {
  replaceHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-store";
import {
  decryptHostedVaultShareProjectionSnapshots,
} from "@/src/lib/hosted-vault-share/projection-snapshot";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Vault-share deadline proof requires local PostgreSQL.");
  }
}

describe.skipIf(!enabled)("vault-share projection deadline (real PostgreSQL)", () => {
  it.each(["deadline", "cancellation"] as const)(
    "rolls back after %s while blocked on the source lock, then a fresh retry publishes",
    async (stopReason) => {
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const locker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const grantorMemberId = `member_projection_grantor_${suffix}`;
      const destinationMemberId = `member_projection_destination_${suffix}`;
      const projectionScope = hostedVaultShareProjectionKindToScope("time-zone.v0");
      const share = {
        id: `share_projection_${suffix}`,
        grantorMemberId,
        destinationMemberId,
        projectionKind: "time-zone.v0" as const,
        projectionScope,
        projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope),
      };
      const lockAcquired = createBarrier();
      const releaseLock = createBarrier();
      let held: Promise<unknown> | undefined;
      let attempt: Promise<unknown> | undefined;
      let clock: ReturnType<typeof vi.spyOn> | undefined;

      try {
        await observer.hostedMember.createMany({
          data: [grantorMemberId, destinationMemberId].map((id) => ({
            id,
            billingStatus: "active" as const,
          })),
        });
        await observer.hostedWorkspace.create({
          data: { userId: grantorMemberId, version: 7n },
        });
        await observer.hostedVaultShare.create({
          data: {
            id: share.id,
            grantorMemberId,
            destinationMemberId,
            projectionKind: share.projectionKind,
            projectionScopeKey: share.projectionScopeKey,
            grantedAt: new Date(),
          },
        });
        const [backend] = await writer.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        if (!backend) throw new Error("Writer connection was not established.");

        held = locker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT version FROM hosted_workspace
            WHERE user_id = ${grantorMemberId} FOR UPDATE
          `;
          lockAcquired.resolve();
          await releaseLock.promise;
        }, { timeout: 15_000 });
        // Propagate setup failure without leaving the barrier waiting forever.
        void held.catch(lockAcquired.reject);
        await lockAcquired.promise;

        const controller = new AbortController();
        const deadlineAtEpochMs = Date.now() + 10_000;
        const input = {
          deadlineAtEpochMs,
          prisma: writer,
          records: [],
          share,
          signal: controller.signal,
          sourceWorkspaceVersion: "7",
        };
        attempt = replaceHostedVaultShareProjectionSnapshot(input)
          .then((outcome) => outcome, (error: unknown) => error);

        let blocked = false;
        for (let poll = 0; poll < 100; poll += 1) {
          const [activity] = await observer.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT wait_event_type = 'Lock' AS waiting
            FROM pg_stat_activity WHERE pid = ${backend.pid}
          `;
          if (activity?.waiting) {
            blocked = true;
            break;
          }
          await delay(10);
        }
        if (!blocked) {
          releaseLock.resolve();
          await held;
          throw new Error(`Projection did not reach the workspace lock: ${String(await attempt)}`);
        }
        if (stopReason === "deadline") {
          clock = vi.spyOn(Date, "now").mockReturnValue(deadlineAtEpochMs);
        } else {
          controller.abort(new DOMException("Synthetic cancellation.", "AbortError"));
        }
        releaseLock.resolve();
        await held;
        expect(await attempt).toMatchObject({
          name: stopReason === "deadline" ? "TimeoutError" : "AbortError",
        });
        clock?.mockRestore();

        const row = await observer.hostedVaultShare.findUniqueOrThrow({
          where: { id: share.id },
          select: { projectionSnapshotCiphertext: true, projectionSourceWorkspaceVersion: true },
        });
        expect(row).toEqual({
          projectionSnapshotCiphertext: null,
          projectionSourceWorkspaceVersion: null,
        });

        await expect(replaceHostedVaultShareProjectionSnapshot({
          ...input,
          deadlineAtEpochMs: Date.now() + 10_000,
          signal: new AbortController().signal,
        })).resolves.toBe("replaced");
        const refreshed = await observer.hostedVaultShare.findUniqueOrThrow({
          where: { id: share.id },
          select: { projectionSnapshotCiphertext: true, projectionSourceWorkspaceVersion: true },
        });
        expect(refreshed.projectionSourceWorkspaceVersion).toBe(7n);
        expect(refreshed.projectionSnapshotCiphertext).not.toBeNull();
        await expect(decryptHostedVaultShareProjectionSnapshots({
          entries: [{ ...share, ciphertext: refreshed.projectionSnapshotCiphertext }],
          prisma: observer,
        })).resolves.toEqual([[]]);
      } finally {
        releaseLock.resolve();
        await Promise.allSettled([held, attempt]);
        clock?.mockRestore();
        await observer.hostedVaultShare.deleteMany({ where: { id: share.id } });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [grantorMemberId, destinationMemberId] } },
        });
        await Promise.all([writer.$disconnect(), locker.$disconnect(), observer.$disconnect()]);
      }
    },
    30_000,
  );
});

function createBarrier() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
