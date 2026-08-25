import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { ensureHostedGroupStructureForThreadContainerTx } from "./group-store";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

export type HostedGroupMaterializationBackfillMode = "apply" | "dry-run";

export interface HostedGroupMaterializationBackfillStore {
  countCandidateContainerMemberIds(): Promise<number>;
  listCandidateContainerMemberIds(input: { take: number }): Promise<string[]>;
  materializeCandidate(input: {
    containerMemberId: string;
    now: Date;
  }): Promise<{ created: boolean }>;
}

export interface HostedGroupMaterializationBackfillSummary {
  alreadyMaterializedRows: number;
  batchSize: number;
  failedRows: number;
  hasMore: boolean;
  materializedRows: number;
  mode: HostedGroupMaterializationBackfillMode;
  remainingRows: number;
  selectedRows: number;
  wouldMaterializeRows: number;
}

export interface HostedGroupMaterializationReadiness {
  complete: boolean;
  pendingRows: number;
}

export async function backfillHostedGroupMaterialization(input: {
  batchSize?: number;
  mode?: HostedGroupMaterializationBackfillMode;
  now?: () => Date;
  store?: HostedGroupMaterializationBackfillStore;
} = {}): Promise<HostedGroupMaterializationBackfillSummary> {
  const batchSize = normalizeBatchSize(input.batchSize);
  const mode = input.mode ?? "dry-run";
  const store = input.store ?? createHostedGroupMaterializationBackfillStore();
  const now = input.now ?? (() => new Date());
  const candidates = await store.listCandidateContainerMemberIds({
    take: batchSize + 1,
  });
  const selected = candidates.slice(0, batchSize);
  const summary: HostedGroupMaterializationBackfillSummary = {
    alreadyMaterializedRows: 0,
    batchSize,
    failedRows: 0,
    hasMore: candidates.length > batchSize,
    materializedRows: 0,
    mode,
    remainingRows: 0,
    selectedRows: selected.length,
    wouldMaterializeRows: selected.length,
  };
  if (mode === "dry-run") {
    summary.remainingRows = await store.countCandidateContainerMemberIds();
    summary.hasMore = summary.remainingRows > 0;
    return summary;
  }

  for (const containerMemberId of selected) {
    try {
      const result = await store.materializeCandidate({
        containerMemberId,
        now: now(),
      });
      if (result.created) {
        summary.materializedRows += 1;
      } else {
        summary.alreadyMaterializedRows += 1;
      }
    } catch {
      // Each candidate owns its own transaction. Keep later rows moving and
      // report only an aggregate failure count so a rerun can resume safely.
      summary.failedRows += 1;
    }
  }
  summary.remainingRows = await store.countCandidateContainerMemberIds();
  summary.hasMore = summary.remainingRows > 0;
  return summary;
}

export async function readHostedGroupMaterializationReadiness(input: {
  store?: HostedGroupMaterializationBackfillStore;
} = {}): Promise<HostedGroupMaterializationReadiness> {
  const store = input.store ?? createHostedGroupMaterializationBackfillStore();
  const pendingRows = await store.countCandidateContainerMemberIds();
  return {
    complete: pendingRows === 0,
    pendingRows,
  };
}

export function createHostedGroupMaterializationBackfillStore(
  prisma: PrismaClient = getPrisma(),
): HostedGroupMaterializationBackfillStore {
  const candidateWhere: Prisma.HostedThreadContainerWhereInput = {
    member: {
      hostedGroupRuntime: { is: null },
    },
    routes: { some: {} },
  };
  return {
    countCandidateContainerMemberIds: async () =>
      prisma.hostedThreadContainer.count({ where: candidateWhere }),
    listCandidateContainerMemberIds: async ({ take }) => {
      const rows = await prisma.hostedThreadContainer.findMany({
        orderBy: { memberId: "asc" },
        select: { memberId: true },
        take,
        where: candidateWhere,
      });
      return rows.map((row) => row.memberId);
    },
    materializeCandidate: async ({ containerMemberId, now }) =>
      await prisma.$transaction(async (tx) => {
        const result = await ensureHostedGroupStructureForThreadContainerTx({
          containerMemberId,
          now,
          tx,
        });
        return { created: result.created };
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
  };
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(
      `Hosted group materialization backfill batch size must be between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  return batchSize;
}
