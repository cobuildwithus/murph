import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import { materializeHostedIngressEnvelopeTx } from "../hosted-ingress/lifecycle";
import { nudgeHostedRunBestEffort } from "../hosted-ingress/control";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getHostedOnboardingEnvironment } from "../hosted-onboarding/runtime";

import {
  generateHostedVaultSyncAgentToken,
  generateHostedVaultSyncPairingCode,
  generateHostedVaultSyncSessionId,
  hashHostedVaultSyncSecret,
  HOSTED_VAULT_SYNC_SESSION_TTL_MS,
  normalizeHostedVaultSyncPairingCode,
  deleteHostedVaultSyncPayload,
  projectHostedVaultSyncSessionView,
  requireHostedVaultSyncAgentSession,
  upsertHostedVaultSyncPayload,
  type HostedVaultSyncSessionView,
} from "./shared";

export interface CreateHostedVaultSyncSessionResult {
  pairingCode: string;
  session: HostedVaultSyncSessionView;
}

export async function createHostedVaultSyncSession(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<CreateHostedVaultSyncSessionResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date();
  const pairingCode = generateHostedVaultSyncPairingCode();
  const session = await prisma.hostedVaultSyncSession.create({
    data: {
      direction: "local_to_hosted",
      expiresAt: new Date(now.getTime() + HOSTED_VAULT_SYNC_SESSION_TTL_MS),
      id: generateHostedVaultSyncSessionId(),
      memberId: input.memberId,
      pairingCodeHash: hashHostedVaultSyncSecret(normalizeHostedVaultSyncPairingCode(pairingCode)),
      status: "pending",
    },
  });

  return {
    pairingCode,
    session: projectHostedVaultSyncSessionView({
      appBaseUrl: getHostedOnboardingEnvironment().publicBaseUrl,
      pairingCode,
      session,
    }),
  };
}

export async function listHostedVaultSyncSessions(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<HostedVaultSyncSessionView[]> {
  const prisma = input.prisma ?? getPrisma();
  const sessions = await prisma.hostedVaultSyncSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    where: { memberId: input.memberId },
  });
  return Promise.all(
    sessions.map((session) => projectHostedVaultSyncSessionViewWithRunStatus({
      prisma,
      session,
    })),
  );
}

export async function revokeHostedVaultSyncSession(input: {
  memberId: string;
  prisma?: PrismaClient;
  sessionId: string;
}): Promise<HostedVaultSyncSessionView> {
  const prisma = input.prisma ?? getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.hostedVaultSyncSession.updateMany({
      where: {
        id: input.sessionId,
        memberId: input.memberId,
      },
      data: {
        agentTokenHash: null,
        pairingCodeHash: null,
        revokedAt: new Date(),
        status: "revoked",
      },
    });
    await deleteHostedVaultSyncPayload({
      memberId: input.memberId,
      prisma: tx,
      sessionId: input.sessionId,
    });
  });
  const session = await prisma.hostedVaultSyncSession.findFirst({
    where: { id: input.sessionId, memberId: input.memberId },
  });
  if (!session) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
      message: "That vault sync session is not available.",
    });
  }
  return projectHostedVaultSyncSessionView({ session });
}

async function projectHostedVaultSyncSessionViewWithRunStatus(input: {
  prisma: PrismaClient;
  session: Parameters<typeof projectHostedVaultSyncSessionView>[0]["session"];
}): Promise<HostedVaultSyncSessionView> {
  const view = projectHostedVaultSyncSessionView({ session: input.session });
  if (!input.session.queuedIngressEventId || view.status !== "queued") {
    return view;
  }

  const event = await input.prisma.hostedIngressEvent.findUnique({
    where: { id: input.session.queuedIngressEventId },
    include: { run: true },
  });
  if (!event) {
    return view;
  }

  if (event.state === "quarantined" || event.run?.status === "failed") {
    return { ...view, status: "failed" };
  }

  if (event.state === "completed") {
    const conflictCount = readVaultSyncImportConflictCount(
      event.run?.redactedSummaryJson ?? null,
      input.session.id,
    );
    return {
      ...view,
      status: conflictCount && conflictCount > 0 ? "committed_with_conflicts" : "committed",
    };
  }

  return view;
}

function readVaultSyncImportSummaries(value: unknown): Record<string, unknown>[] {
  const summary = readRecord(value);
  const details = readRecord(summary?.details);
  const summaries = details?.vaultSyncImports;
  if (Array.isArray(summaries)) {
    return summaries.flatMap((entry) => {
      const record = readRecord(entry);
      return record ? [record] : [];
    });
  }

  return [];
}

function readVaultSyncImportSummary(value: unknown, sessionId?: string | null): Record<string, unknown> | null {
  const summaries = readVaultSyncImportSummaries(value);
  if (!sessionId) {
    return summaries[0] ?? null;
  }

  return summaries.find((summary) => summary.sessionId === sessionId) ?? null;
}

function readVaultSyncImportConflictCount(value: unknown, sessionId?: string | null): number | null {
  const vaultSyncImport = readVaultSyncImportSummary(value, sessionId);
  const conflictCount = vaultSyncImport?.conflictCount;
  return typeof conflictCount === "number" && Number.isFinite(conflictCount)
    ? conflictCount
    : null;
}

function readVaultSyncImportSessionSummaries(value: unknown): Array<{
  conflictCount: number;
  sessionId: string;
}> {
  return readVaultSyncImportSummaries(value).flatMap((vaultSyncImport) => {
    const sessionId = vaultSyncImport.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return [];
    }

    const conflictCount = vaultSyncImport.conflictCount;
    return [{
      conflictCount: typeof conflictCount === "number" && Number.isFinite(conflictCount)
        ? conflictCount
        : 0,
      sessionId,
    }];
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function exchangeHostedVaultSyncPairingCode(input: {
  pairingCode: string;
  prisma?: PrismaClient;
}): Promise<{ agentToken: string; session: HostedVaultSyncSessionView }> {
  const prisma = input.prisma ?? getPrisma();
  const pairingCodeHash = hashHostedVaultSyncSecret(normalizeHostedVaultSyncPairingCode(input.pairingCode));
  const session = await prisma.hostedVaultSyncSession.findUnique({
    where: { pairingCodeHash },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now || session.status !== "pending") {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
      message: "That vault sync session is not available. Start a new sync from Settings.",
    });
  }

  const agentToken = generateHostedVaultSyncAgentToken();
  const updateResult = await prisma.hostedVaultSyncSession.updateMany({
    where: {
      id: session.id,
      pairingCodeHash,
      revokedAt: null,
      status: "pending",
    },
    data: {
      agentTokenHash: hashHostedVaultSyncSecret(agentToken),
      pairingCodeHash: null,
      status: "exchanged",
    },
  });
  if (updateResult.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
      message: "That vault sync session is not available. Start a new sync from Settings.",
    });
  }
  const updated = await prisma.hostedVaultSyncSession.findUniqueOrThrow({
    where: { id: session.id },
  });

  return {
    agentToken,
    session: projectHostedVaultSyncSessionView({ session: updated }),
  };
}

export async function completeHostedVaultSyncAgentUpload(input: {
  bundleBase64: string;
  localManifestHash: string;
  prisma?: PrismaClient;
  request: Request;
  sessionId: string;
  sourceSchemaVersion?: string | null;
  sourceVaultId?: string | null;
  sourceVaultTitle?: string | null;
}): Promise<HostedVaultSyncSessionView> {
  const prisma = input.prisma ?? getPrisma();
  const session = await requireHostedVaultSyncAgentSession({
    prisma,
    request: input.request,
    sessionId: input.sessionId,
  });
  const eventId = buildHostedVaultSyncImportEventId(input.sessionId);
  if (session.status === "queued" && session.queuedIngressEventId === eventId) {
    return projectHostedVaultSyncSessionView({ session });
  }
  if (session.status !== "exchanged") {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_ALREADY_USED",
      httpStatus: 409,
      message: "That vault sync session has already been used. Start a new sync from Settings.",
    });
  }
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await upsertHostedVaultSyncPayload({
      memberId: session.memberId,
      payload: {
        bundleBase64: input.bundleBase64,
        sessionId: input.sessionId,
        sourceSchemaVersion: input.sourceSchemaVersion ?? null,
      },
      prisma: tx,
      sessionId: input.sessionId,
    });

    await materializeHostedIngressEnvelopeTx({
      tx,
      wake: buildHostedExecutionVaultSyncImportWake({
        eventId,
        memberId: session.memberId,
        occurredAt: now.toISOString(),
        vaultSync: {
          localManifestHash: input.localManifestHash,
          sessionId: input.sessionId,
          sourceSchemaVersion: input.sourceSchemaVersion ?? null,
          sourceVaultId: input.sourceVaultId ?? null,
          sourceVaultTitle: input.sourceVaultTitle ?? null,
        },
      }),
    });

    return await tx.hostedVaultSyncSession.update({
      where: { id: input.sessionId },
      data: {
        localManifestHash: input.localManifestHash,
        queuedAt: now,
        queuedIngressEventId: eventId,
        sourceSchemaVersion: input.sourceSchemaVersion ?? null,
        sourceVaultId: input.sourceVaultId ?? null,
        sourceVaultTitle: input.sourceVaultTitle ?? null,
        status: "queued",
        uploadedAt: now,
      },
    });
  });

  await nudgeHostedRunBestEffort({
    context: "vault-sync.import",
    userId: session.memberId,
  });

  return projectHostedVaultSyncSessionView({ session: updated });
}

export async function readHostedVaultSyncAgentSession(input: {
  prisma?: PrismaClient;
  request: Request;
  sessionId: string;
}): Promise<HostedVaultSyncSessionView> {
  const prisma = input.prisma ?? getPrisma();
  const session = await requireHostedVaultSyncAgentSession({
    prisma,
    request: input.request,
    sessionId: input.sessionId,
  });
  return projectHostedVaultSyncSessionView({ session });
}

export function buildHostedVaultSyncImportEventId(sessionId: string): string {
  return `vault-sync.import:${sessionId}`;
}

export type VaultSyncTx = Prisma.TransactionClient;

export async function markHostedVaultSyncSessionCommittedFromRunSummary(input: {
  memberId: string;
  prisma?: PrismaClient;
  redactedSummary: unknown;
}): Promise<void> {
  const sessions = readVaultSyncImportSessionSummaries(input.redactedSummary);
  if (sessions.length === 0) {
    return;
  }

  const prisma = input.prisma ?? getPrisma();
  await Promise.all(
    sessions.map(async (session) => {
      await prisma.hostedVaultSyncSession.updateMany({
        where: {
          id: session.sessionId,
          memberId: input.memberId,
          status: { in: ["exchanged", "uploaded", "queued"] },
        },
        data: {
          status: session.conflictCount > 0 ? "committed_with_conflicts" : "committed",
        },
      });
      await deleteHostedVaultSyncPayload({
        memberId: input.memberId,
        prisma,
        sessionId: session.sessionId,
      });
    }),
  );
}
