import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS,
} from "@murphai/hosted-execution/vault-share";

import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { generateHostedVaultShareId } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import {
  appendHostedVaultShareProjectionMaintenanceTx,
  type HostedVaultShareProjectionMaintenanceSignal,
} from "./projection-maintenance";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const MAX_GRANTS_PER_GRANTOR_BATCH = 25;

export type HostedVaultShareRecentDateBackfillMode = "apply" | "dry-run";

export interface HostedVaultShareRecentDateBackfillStore {
  listCandidateGrantors(input: {
    grantedBefore: Date;
    take: number;
  }): Promise<string[]>;
  refreshGrantor(input: {
    grantedBefore: Date;
    grantorMemberId: string;
    now: Date;
  }): Promise<{
    refreshedGrants: number;
    signal: HostedVaultShareProjectionMaintenanceSignal | null;
  }>;
}

export interface HostedVaultShareRecentDateBackfillSummary {
  batchSize: number;
  hasMore: boolean;
  maintenanceRows: number;
  mode: HostedVaultShareRecentDateBackfillMode;
  refreshedGrants: number;
  selectedGrantors: number;
  signalFailures: number;
}

export async function backfillHostedVaultShareRecentDateGenerations(input: {
  batchSize?: number;
  grantedBefore: Date;
  mode?: HostedVaultShareRecentDateBackfillMode;
  now?: () => Date;
  signal?: (signal: HostedVaultShareProjectionMaintenanceSignal) => Promise<void>;
  store?: HostedVaultShareRecentDateBackfillStore;
}): Promise<HostedVaultShareRecentDateBackfillSummary> {
  const batchSize = normalizeBatchSize(input.batchSize);
  const mode = input.mode ?? "dry-run";
  const store = input.store ?? createHostedVaultShareRecentDateBackfillStore();
  const candidates = await store.listCandidateGrantors({
    grantedBefore: input.grantedBefore,
    take: batchSize + 1,
  });
  const selected = candidates.slice(0, batchSize);
  const summary: HostedVaultShareRecentDateBackfillSummary = {
    batchSize,
    hasMore: candidates.length > batchSize,
    maintenanceRows: 0,
    mode,
    refreshedGrants: 0,
    selectedGrantors: selected.length,
    signalFailures: 0,
  };
  if (mode === "dry-run") {
    return summary;
  }

  const signal = input.signal ?? signalHostedVaultShareProjectionMaintenance;
  for (const grantorMemberId of selected) {
    const refreshed = await store.refreshGrantor({
      grantedBefore: input.grantedBefore,
      grantorMemberId,
      now: (input.now ?? (() => new Date()))(),
    });
    summary.refreshedGrants += refreshed.refreshedGrants;
    if (!refreshed.signal) {
      continue;
    }
    summary.maintenanceRows += 1;
    try {
      await signal(refreshed.signal);
    } catch {
      summary.signalFailures += 1;
    }
  }
  return summary;
}

export function createHostedVaultShareRecentDateBackfillStore(
  prisma: PrismaClient = getPrisma(),
): HostedVaultShareRecentDateBackfillStore {
  const candidateWhere = (grantedBefore: Date): Prisma.HostedVaultShareWhereInput => ({
    destination: {
      hostedGroupRuntime: { isNot: null },
    },
    grantedAt: { lt: grantedBefore },
    projectionKind: { in: [...HOSTED_VAULT_SHARE_RECENT_DATE_PROJECTION_KINDS] },
    status: "granted",
  });
  return {
    listCandidateGrantors: async ({ grantedBefore, take }) => {
      const rows = await prisma.hostedVaultShare.findMany({
        distinct: ["grantorMemberId"],
        orderBy: { grantorMemberId: "asc" },
        select: { grantorMemberId: true },
        take,
        where: candidateWhere(grantedBefore),
      });
      return rows.map((row) => row.grantorMemberId);
    },
    refreshGrantor: async ({ grantedBefore, grantorMemberId, now }) =>
      await prisma.$transaction(async (tx) => {
        const grants = await tx.hostedVaultShare.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: MAX_GRANTS_PER_GRANTOR_BATCH,
          where: {
            ...candidateWhere(grantedBefore),
            grantorMemberId,
          },
        });
        const nextGrantIds: string[] = [];
        for (const grant of grants) {
          const nextGrantId = generateHostedVaultShareId();
          const updated = await tx.hostedVaultShare.updateMany({
            data: {
              grantedAt: now,
              id: nextGrantId,
              projectionSnapshotCiphertext: null,
            },
            where: {
              id: grant.id,
              ...candidateWhere(grantedBefore),
              grantorMemberId,
            },
          });
          if (updated.count === 1) {
            nextGrantIds.push(nextGrantId);
          }
        }
        const signal = nextGrantIds.length > 0
          ? await appendHostedVaultShareProjectionMaintenanceTx({
              grantIds: nextGrantIds,
              memberId: grantorMemberId,
              tx,
            })
          : null;
        return {
          refreshedGrants: nextGrantIds.length,
          signal,
        };
      }),
  };
}

async function signalHostedVaultShareProjectionMaintenance(
  signal: HostedVaultShareProjectionMaintenanceSignal,
): Promise<void> {
  await signalHostedMailboxAppendRuntime({
    expectedUserId: signal.memberId,
    knownCheckpoint: {
      lane: signal.lane,
      laneSeq: signal.laneSeq,
      userId: signal.memberId,
    },
    mailboxItemId: signal.mailboxItemId,
  });
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(
      `Hosted vault-share recent-date backfill batch size must be between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  return batchSize;
}
