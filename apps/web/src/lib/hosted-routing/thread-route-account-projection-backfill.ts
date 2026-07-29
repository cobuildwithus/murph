import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { getPrisma } from "../prisma";
import {
  isHostedThreadDeliveryRouteChannel,
  openHostedThreadDeliveryRoute,
  projectHostedThreadDeliveryRouteAccountLookupKey,
  type HostedThreadDeliveryRouteV1,
} from "./thread-delivery-route";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

export type HostedThreadRouteAccountProjectionBackfillMode = "apply" | "dry-run";

export interface HostedThreadRouteAccountProjectionBackfillCandidate {
  channel: string;
  containerMemberId: string;
  deliveryRouteEncrypted: string | null;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
  updatedAt: Date;
}

export interface HostedThreadRouteAccountProjectionBackfillStore {
  applyCandidate(input: {
    accountLookupKey: string;
    candidate: HostedThreadRouteAccountProjectionBackfillCandidate;
  }): Promise<boolean>;
  countCandidates(): Promise<number>;
  listCandidates(input: {
    take: number;
  }): Promise<HostedThreadRouteAccountProjectionBackfillCandidate[]>;
}

export interface HostedThreadRouteAccountProjectionBackfillSummary {
  appliedRows: number;
  batchSize: number;
  conflicts: number;
  hasMore: boolean;
  invalidRows: number;
  mode: HostedThreadRouteAccountProjectionBackfillMode;
  remainingRows: number;
  selectedRows: number;
  wouldApplyRows: number;
}

export interface HostedThreadRouteAccountProjectionReadiness {
  complete: boolean;
  pendingRows: number;
}

export async function backfillHostedThreadRouteAccountProjections(input: {
  batchSize?: number;
  mode?: HostedThreadRouteAccountProjectionBackfillMode;
  openRoute?: (
    candidate: HostedThreadRouteAccountProjectionBackfillCandidate,
  ) => Promise<HostedThreadDeliveryRouteV1>;
  prisma?: PrismaClient;
  store?: HostedThreadRouteAccountProjectionBackfillStore;
} = {}): Promise<HostedThreadRouteAccountProjectionBackfillSummary> {
  const batchSize = normalizeBatchSize(input.batchSize);
  const mode = input.mode ?? "dry-run";
  const prisma = input.prisma ?? (input.store && input.openRoute ? null : getPrisma());
  const store = input.store
    ?? createHostedThreadRouteAccountProjectionBackfillStore(prisma ?? getPrisma());
  const openRoute = input.openRoute ?? (async (candidate) => {
    if (!prisma || !isHostedThreadDeliveryRouteChannel(candidate.channel)) {
      throw new TypeError("Hosted thread route projection backfill candidate is invalid.");
    }
    return openHostedThreadDeliveryRoute({
      channel: candidate.channel,
      containerMemberId: candidate.containerMemberId,
      encrypted: candidate.deliveryRouteEncrypted,
      prisma,
    });
  });
  const candidates = await store.listCandidates({ take: batchSize + 1 });
  const selected = candidates.slice(0, batchSize);
  const summary: HostedThreadRouteAccountProjectionBackfillSummary = {
    appliedRows: 0,
    batchSize,
    conflicts: 0,
    hasMore: false,
    invalidRows: 0,
    mode,
    remainingRows: 0,
    selectedRows: selected.length,
    wouldApplyRows: 0,
  };

  for (const candidate of selected) {
    let route: HostedThreadDeliveryRouteV1;
    try {
      route = await openRoute(candidate);
      assertHostedThreadRouteProjectionMatchesAuthority(candidate, route);
    } catch {
      summary.invalidRows += 1;
      continue;
    }

    const accountLookupKey =
      projectHostedThreadDeliveryRouteAccountLookupKey(route);
    summary.wouldApplyRows += 1;
    if (mode === "dry-run") {
      continue;
    }

    const applied = await store.applyCandidate({
      accountLookupKey,
      candidate,
    });
    if (applied) {
      summary.appliedRows += 1;
    } else {
      summary.conflicts += 1;
    }
  }

  summary.remainingRows = await store.countCandidates();
  summary.hasMore = summary.remainingRows > 0;
  return summary;
}

export async function readHostedThreadRouteAccountProjectionReadiness(input: {
  prisma?: PrismaClient;
  store?: HostedThreadRouteAccountProjectionBackfillStore;
} = {}): Promise<HostedThreadRouteAccountProjectionReadiness> {
  const store = input.store
    ?? createHostedThreadRouteAccountProjectionBackfillStore(
      input.prisma ?? getPrisma(),
    );
  const pendingRows = await store.countCandidates();
  return {
    complete: pendingRows === 0,
    pendingRows,
  };
}

export function createHostedThreadRouteAccountProjectionBackfillStore(
  prisma: Pick<PrismaClient, "hostedThreadRoute"> = getPrisma(),
): HostedThreadRouteAccountProjectionBackfillStore {
  const candidateWhere: Prisma.HostedThreadRouteWhereInput = {
    accountLookupKey: null,
    channel: {
      in: ["linq", "telegram"],
    },
  };

  return {
    applyCandidate: async ({ accountLookupKey, candidate }) => {
      const updated = await prisma.hostedThreadRoute.updateMany({
        data: {
          accountLookupKey,
        },
        where: {
          ...candidateWhere,
          channel: candidate.channel,
          containerMemberId: candidate.containerMemberId,
          deliveryRouteEncrypted: candidate.deliveryRouteEncrypted,
          threadIdentityLookupKey: candidate.threadIdentityLookupKey,
          threadLookupKey: candidate.threadLookupKey,
          updatedAt: candidate.updatedAt,
        },
      });
      return updated.count === 1;
    },
    countCandidates: async () => prisma.hostedThreadRoute.count({
      where: candidateWhere,
    }),
    listCandidates: async ({ take }) => prisma.hostedThreadRoute.findMany({
      orderBy: [
        { channel: "asc" },
        { threadIdentityLookupKey: "asc" },
      ],
      select: {
        channel: true,
        containerMemberId: true,
        deliveryRouteEncrypted: true,
        threadIdentityLookupKey: true,
        threadLookupKey: true,
        updatedAt: true,
      },
      take,
      where: candidateWhere,
    }),
  };
}

function assertHostedThreadRouteProjectionMatchesAuthority(
  candidate: HostedThreadRouteAccountProjectionBackfillCandidate,
  route: HostedThreadDeliveryRouteV1,
): void {
  if (
    route.channel !== candidate.channel
    || !createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: route.channel,
      threadId: route.threadId,
    }).includes(candidate.threadIdentityLookupKey)
    || !createHostedExternalThreadLookupKeyReadCandidates({
      accountLookupKey: projectHostedThreadDeliveryRouteAccountLookupKey(route),
      channel: route.channel,
      threadId: route.threadId,
    }).includes(candidate.threadLookupKey)
  ) {
    throw new TypeError(
      "Hosted thread route projection does not match canonical route authority.",
    );
  }
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(
      `Hosted thread route projection batch size must be between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  return batchSize;
}
