import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeVaultSyncImportRequest,
  HostedRuntimeVaultSyncImportStatus,
} from "@murphai/hosted-execution/runtime-control";

import { getPrisma } from "../prisma";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { nudgeHostedRunnerBestEffort } from "../hosted-runner/control";
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
  createHostedVaultSyncPayload,
  type HostedVaultSyncSessionView,
} from "./shared";

export interface CreateHostedVaultSyncSessionResult {
  pairingCode: string;
  session: HostedVaultSyncSessionView;
}

export interface RecordHostedVaultSyncImportResult {
  recorded: boolean;
  sessionId: string;
  status: HostedRuntimeVaultSyncImportStatus;
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
  return sessions.map((session) => projectHostedVaultSyncSessionView({ session }));
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
  if (session.status === "queued") {
    await nudgeHostedRunnerBestEffort({
      context: "vault-sync.import",
      userId: session.memberId,
    });
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
    const claim = await tx.hostedVaultSyncSession.updateMany({
      where: {
        agentTokenHash: session.agentTokenHash,
        expiresAt: {
          gt: now,
        },
        id: input.sessionId,
        memberId: session.memberId,
        revokedAt: null,
        status: "exchanged",
      },
      data: {
        localManifestHash: input.localManifestHash,
        queuedAt: now,
        sourceSchemaVersion: input.sourceSchemaVersion ?? null,
        sourceVaultId: input.sourceVaultId ?? null,
        sourceVaultTitle: input.sourceVaultTitle ?? null,
        status: "queued",
        uploadedAt: now,
      },
    });

    if (claim.count !== 1) {
      const currentSession = await tx.hostedVaultSyncSession.findFirst({
        where: {
          id: input.sessionId,
          memberId: session.memberId,
        },
      });
      if (currentSession?.status === "queued") {
        return currentSession;
      }
      throw hostedOnboardingError({
        code: "HOSTED_VAULT_SYNC_SESSION_ALREADY_USED",
        httpStatus: 409,
        message: "That vault sync session has already been used. Start a new sync from Settings.",
      });
    }

    await createHostedVaultSyncPayload({
      memberId: session.memberId,
      payload: {
        bundleBase64: input.bundleBase64,
        sessionId: input.sessionId,
        sourceSchemaVersion: input.sourceSchemaVersion ?? null,
      },
      prisma: tx,
      sessionId: input.sessionId,
    });

    await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedExecutionVaultSyncImportWake({
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
      tx,
    });

    return await tx.hostedVaultSyncSession.findUniqueOrThrow({
      where: { id: input.sessionId },
    });
  });

  await nudgeHostedRunnerBestEffort({
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

export async function recordHostedVaultSyncImportResult(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedRuntimeVaultSyncImportRequest;
}): Promise<RecordHostedVaultSyncImportResult> {
  const prisma = input.prisma ?? getPrisma();
  const importedAt = new Date(input.request.importedAt);
  if (Number.isNaN(importedAt.getTime())) {
    throw new TypeError("Hosted vault sync import importedAt must be a valid ISO timestamp.");
  }

  const terminalStatus = mapHostedVaultSyncImportStatus(input.request.status);
  const recorded = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.hostedVaultSyncSession.updateMany({
      where: {
        id: input.request.sessionId,
        memberId: input.memberId,
        status: {
          in: ["exchanged", "uploaded", "queued"],
        },
      },
      data: {
        agentTokenHash: null,
        status: terminalStatus,
      },
    });

    if (updateResult.count !== 1) {
      return false;
    }

    await deleteHostedVaultSyncPayload({
      memberId: input.memberId,
      prisma: tx,
      sessionId: input.request.sessionId,
    });
    return true;
  });

  return {
    recorded,
    sessionId: input.request.sessionId,
    status: input.request.status,
  };
}

export function buildHostedVaultSyncImportEventId(sessionId: string): string {
  return `vault-sync.import:${sessionId}`;
}

export type VaultSyncTx = Prisma.TransactionClient;

function mapHostedVaultSyncImportStatus(
  status: HostedRuntimeVaultSyncImportStatus,
): "committed" | "committed_with_conflicts" | "failed" {
  if (status === "imported") {
    return "committed";
  }

  if (status === "imported_with_conflicts") {
    return "committed_with_conflicts";
  }

  return "failed";
}
