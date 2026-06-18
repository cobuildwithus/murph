import { Prisma } from "@prisma/client";
import type {
  HostedComputerHandoff as PrismaHostedComputerHandoff,
  HostedComputerRun as PrismaHostedComputerRun,
  PrismaClient,
} from "@prisma/client";

import { HOSTED_COMPUTER_PROFILE_KEYS } from "@murphai/hosted-execution/computer-use";
import type {
  HostedComputerAwaitingReason,
  HostedComputerFinishOutcome,
  HostedComputerHandoffPurpose,
  HostedComputerHandoffStatus,
  HostedComputerProfileKey,
  HostedComputerRunStatus,
} from "@murphai/hosted-execution/computer-use";

import { getPrisma } from "../prisma";
import { computerUseConflictError, computerUseNotFoundError } from "./errors";
import { createComputerId } from "./ids";

export interface ComputerRunRecord {
  awaitingMessage: string | null;
  awaitingReason: HostedComputerAwaitingReason | null;
  checkpointContext: ComputerRunCheckpointContext | null;
  completedAt: Date | null;
  expiresAt: Date;
  id: string;
  kernelLiveViewUrlEncrypted: string | null;
  kernelProfileName: string;
  kernelSessionId: string | null;
  lastAuthenticatedAt: Date | null;
  lastCheckpointAt: Date | null;
  lastTitle: string | null;
  lastUrl: string | null;
  memberId: string;
  pausedAt: Date | null;
  pendingHandoffId: string | null;
  profileKey: HostedComputerProfileKey;
  resumedAt: Date | null;
  status: HostedComputerRunStatus;
  suggestedReply: string | null;
  updatedAt: Date;
}

export interface ComputerRunCheckpointContext {
  conversationId: string | null;
  recipientKey: string | null;
}

export interface ComputerHandoffRecord {
  completedAt: Date | null;
  expiresAt: Date;
  id: string;
  memberId: string;
  openedAt: Date | null;
  purpose: HostedComputerHandoffPurpose;
  runId: string;
  status: HostedComputerHandoffStatus;
  suggestedReply: string | null;
  tokenHash: string;
  updatedAt: Date;
}

export interface ComputerCreateRunResult {
  created: boolean;
  run: ComputerRunRecord;
}

export interface ComputerMarkRunExpiredResult {
  expired: boolean;
  run: ComputerRunRecord;
}

export interface ComputerUseStore {
  claimHandoffForCompletion(input: {
    handoffId: string;
  }): Promise<ComputerHandoffRecord | null>;
  completeHandoff(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord>;
  createHandoff(input: {
    expiresAt: Date;
    memberId: string;
    purpose: HostedComputerHandoffPurpose;
    runId: string;
    suggestedReply: string | null;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
  createRun(input: {
    expiresAt: Date;
    id: string;
    kernelProfileName: string;
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
    startUrl: string | null;
  }): Promise<ComputerCreateRunResult>;
  attachRunBrowser(input: {
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  findActiveRunForProfileKey(input: {
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerRunRecord | null>;
  findHandoffByRun(input: {
    handoffId: string;
    runId: string;
  }): Promise<ComputerHandoffRecord | null>;
  listStaleActiveRuns(input: {
    now: Date;
  }): Promise<ComputerRunRecord[]>;
  listStaleActiveRunsForProfileKey(input: {
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerRunRecord[]>;
  listMemberRuns(input: {
    memberId: string;
  }): Promise<ComputerRunRecord[]>;
  hasConversationMailboxItemAfter(input: {
    after: Date;
    mailboxItemId: string;
    memberId: string;
  }): Promise<boolean>;
  markHandoffOpened(input: {
    handoffId: string;
    now: Date;
  }): Promise<void>;
  markHandoffExpired(input: {
    expectedStatus?: "open" | "checkpointing";
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord>;
  clearRunBrowser(input: {
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string;
    expectedPendingHandoffId: string | null;
    lastTitle?: string | null;
    lastUrl?: string | null;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  clearTerminalRunBrowser(input: {
    expectedKernelSessionId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  markRunProfileCheckpointed(input: {
    authenticated: boolean;
    now: Date;
    runId: string;
  }): Promise<void>;
  markRunAwaitingUser(input: {
    awaitingMessage: string;
    awaitingReason: HostedComputerAwaitingReason;
    checkpointContext: ComputerRunCheckpointContext | null;
    now: Date;
    pendingHandoffId: string | null;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerRunRecord>;
  replaceAwaitingRunHandoff(input: {
    expectedHandoffUpdatedAt: Date;
    expectedPendingHandoffId: string;
    newPendingHandoffId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  markRunExpired(input: {
    expectedKernelSessionId: string | null;
    now: Date;
    runId: string;
  }): Promise<ComputerMarkRunExpiredResult>;
  markRunRunning(input: {
    awaitingReason: HostedComputerAwaitingReason | null;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  replaceRunBrowser(input: {
    expectedHandoffUpdatedAt?: Date | null;
    expectedPendingHandoffId: string | null;
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  requireHandoffByTokenHash(input: {
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
  releaseHandoffClaim(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
  }): Promise<void>;
  requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord>;
  requireMemberComputerUseAvailable(input: {
    memberId: string;
  }): Promise<void>;
  updateRunBrowserState(input: {
    expectedKernelSessionId: string | null;
    lastTitle: string | null;
    lastUrl: string | null;
    runId: string;
  }): Promise<void>;
  finishRun(input: {
    expectedCompletedHandoffId?: string | null;
    expectedKernelSessionId: string | null;
    expectedRunStatus?: HostedComputerRunStatus | null;
    now: Date;
    outcome: HostedComputerFinishOutcome;
    runId: string;
  }): Promise<ComputerRunRecord>;
}

export class PrismaComputerUseStore implements ComputerUseStore {
  private readonly prisma: PrismaClient | Prisma.TransactionClient;

  constructor(prisma: PrismaClient | Prisma.TransactionClient = getPrisma()) {
    this.prisma = prisma;
  }

  async findActiveRunForProfileKey(input: {
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerRunRecord | null> {
    const run = await this.prisma.hostedComputerRun.findFirst({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        expiresAt: { gt: input.now },
        memberId: input.memberId,
        profileKey: input.profileKey,
        status: { in: ["running", "awaiting_user"] },
      },
    });

    return run ? mapRun(run) : null;
  }

  async listStaleActiveRunsForProfileKey(input: {
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        memberId: input.memberId,
        profileKey: input.profileKey,
        OR: [
          {
            expiresAt: { lte: input.now },
            status: { in: ["running", "awaiting_user"] },
          },
          {
            kernelSessionId: { not: null },
            status: { in: ["completed", "failed", "expired", "canceled"] },
          },
        ],
      },
    });

    return runs.map(mapRun);
  }

  async listStaleActiveRuns(input: {
    now: Date;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "asc",
      },
      where: {
        OR: [
          {
            expiresAt: { lte: input.now },
            status: { in: ["running", "awaiting_user"] },
          },
          {
            kernelSessionId: { not: null },
            status: { in: ["completed", "failed", "expired", "canceled"] },
          },
        ],
      },
    });

    return runs.map(mapRun);
  }

  async listMemberRuns(input: {
    memberId: string;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "asc",
      },
      where: {
        memberId: input.memberId,
      },
    });

    return runs.map(mapRun);
  }

  async hasConversationMailboxItemAfter(input: {
    after: Date;
    mailboxItemId: string;
    memberId: string;
  }): Promise<boolean> {
    const item = await this.prisma.hostedMailboxItem.findFirst({
      select: {
        id: true,
      },
      where: {
        id: input.mailboxItemId,
        createdAt: {
          gt: input.after,
        },
        kind: "conversation.message",
        lane: "conversation",
        userId: input.memberId,
      },
    });

    return item !== null;
  }

  async createRun(input: {
    expiresAt: Date;
    id: string;
    kernelProfileName: string;
    memberId: string;
    now: Date;
    profileKey: HostedComputerProfileKey;
    startUrl: string | null;
  }): Promise<ComputerCreateRunResult> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerUseAvailable(tx, input.memberId);

      const activeRun = await tx.hostedComputerRun.findFirst({
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          expiresAt: { gt: input.now },
          memberId: input.memberId,
          profileKey: input.profileKey,
          status: { in: ["running", "awaiting_user"] },
        },
      });
      if (activeRun) {
        return {
          created: false,
          run: mapRun(activeRun),
        };
      }

      const run = await tx.hostedComputerRun.create({
        data: {
          expiresAt: input.expiresAt,
          id: input.id,
          kernelProfileName: input.kernelProfileName,
          lastUrl: input.startUrl,
          memberId: input.memberId,
          profileKey: input.profileKey,
        },
      });

      return {
        created: true,
        run: mapRun(run),
      };
    });
  }

  async attachRunBrowser(input: {
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerUseAvailable(tx, input.memberId);
      const updated = await tx.hostedComputerRun.updateMany({
        data: {
          kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.kernelSessionId,
        },
        where: {
          id: input.runId,
          expiresAt: { gt: input.now },
          kernelSessionId: null,
          memberId: input.memberId,
          status: "running",
        },
      });
      if (updated.count === 0) {
        throw staleRunStateConflictError();
      }

      const run = await tx.hostedComputerRun.findUnique({
        where: { id: input.runId },
      });
      if (!run) {
        throw computerUseNotFoundError();
      }

      return mapRun(run);
    });
  }

  async requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.findFirst({
      where: {
        id: input.runId,
        memberId: input.memberId,
      },
    });

    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async requireMemberComputerUseAvailable(input: {
    memberId: string;
  }): Promise<void> {
    await requireMemberComputerUseAvailable(this.prisma, input.memberId);
  }

  async createHandoff(input: {
    expiresAt: Date;
    memberId: string;
    purpose: HostedComputerHandoffPurpose;
    runId: string;
    suggestedReply: string | null;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord> {
    const handoff = await this.prisma.hostedComputerHandoff.create({
      data: {
        expiresAt: input.expiresAt,
        id: createComputerId("hch"),
        memberId: input.memberId,
        purpose: input.purpose,
        runId: input.runId,
        suggestedReply: input.suggestedReply,
        tokenHash: input.tokenHash,
      },
    });

    return mapHandoff(handoff);
  }

  async requireHandoffByTokenHash(input: {
    tokenHash: string;
  }): Promise<ComputerHandoffRecord> {
    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      where: { tokenHash: input.tokenHash },
    });

    if (!handoff) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    return mapHandoff(handoff);
  }

  async findHandoffByRun(input: {
    handoffId: string;
    runId: string;
  }): Promise<ComputerHandoffRecord | null> {
    const handoff = await this.prisma.hostedComputerHandoff.findFirst({
      where: {
        id: input.handoffId,
        runId: input.runId,
      },
    });

    return handoff ? mapHandoff(handoff) : null;
  }

  async markHandoffOpened(input: {
    handoffId: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        openedAt: input.now,
      },
      where: {
        id: input.handoffId,
        openedAt: null,
      },
    });
  }

  async markHandoffExpired(input: {
    expectedStatus?: "open" | "checkpointing";
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord> {
    const where: Prisma.HostedComputerHandoffWhereInput = {
      id: input.handoffId,
      status: input.expectedStatus ?? { in: ["open", "checkpointing"] },
      ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
    };
    const updated = await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        status: "expired",
      },
      where,
    });
    if (
      (input.expectedStatus || input.expectedUpdatedAt) &&
      updated.count === 0
    ) {
      throw staleRunStateConflictError();
    }

    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      where: { id: input.handoffId },
    });

    if (!handoff) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    return mapHandoff(handoff);
  }

  async clearRunBrowser(input: {
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string;
    expectedPendingHandoffId: string | null;
    lastTitle?: string | null;
    lastUrl?: string | null;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const where = requireCheckpointingHandoffForBrowserUpdate({
      expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt ?? null,
      expectedPendingHandoffId: input.expectedPendingHandoffId,
      where: {
        id: input.runId,
        kernelSessionId: input.expectedKernelSessionId,
        pendingHandoffId: input.expectedPendingHandoffId,
        status: "awaiting_user",
      },
    });
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        ...(Object.hasOwn(input, "lastTitle") ? { lastTitle: input.lastTitle } : {}),
        ...(Object.hasOwn(input, "lastUrl") ? { lastUrl: input.lastUrl } : {}),
      },
      where,
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async completeHandoff(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord> {
    const updated = await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        completedAt: input.now,
        status: "completed",
      },
      where: {
        id: input.handoffId,
        status: "checkpointing",
        ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
      },
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }
    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      where: { id: input.handoffId },
    });

    if (!handoff) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    return mapHandoff(handoff);
  }

  async claimHandoffForCompletion(input: {
    handoffId: string;
  }): Promise<ComputerHandoffRecord | null> {
    const claimed = await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        status: "checkpointing",
      },
      where: {
        id: input.handoffId,
        status: "open",
      },
    });
    if (claimed.count === 0) {
      return null;
    }

    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      where: { id: input.handoffId },
    });

    if (!handoff) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    return mapHandoff(handoff);
  }

  async releaseHandoffClaim(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
  }): Promise<void> {
    const released = await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        status: "open",
      },
      where: {
        id: input.handoffId,
        status: "checkpointing",
        ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
      },
    });
    if (input.expectedUpdatedAt && released.count === 0) {
      throw staleRunStateConflictError();
    }
  }

  async markRunAwaitingUser(input: {
    awaitingMessage: string;
    awaitingReason: HostedComputerAwaitingReason;
    checkpointContext: ComputerRunCheckpointContext | null;
    now: Date;
    pendingHandoffId: string | null;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: input.awaitingMessage,
        awaitingReason: input.awaitingReason,
        metadataJson: buildRunPauseMetadataJson(input.checkpointContext),
        pausedAt: input.now,
        pendingHandoffId: input.pendingHandoffId,
        status: "awaiting_user",
        suggestedReply: input.suggestedReply,
      },
      where: {
        id: input.runId,
        status: "running",
      },
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async replaceAwaitingRunHandoff(input: {
    expectedHandoffUpdatedAt: Date;
    expectedPendingHandoffId: string;
    newPendingHandoffId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        pausedAt: input.now,
        pendingHandoffId: input.newPendingHandoffId,
      },
      where: requirePendingHandoffForRunUpdate({
        expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt,
        expectedPendingHandoffId: input.expectedPendingHandoffId,
        where: {
          id: input.runId,
          pendingHandoffId: input.expectedPendingHandoffId,
          status: "awaiting_user",
        },
      }),
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async markRunRunning(input: {
    awaitingReason: HostedComputerAwaitingReason | null;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: {
          resume: {
            awaitingReason: input.awaitingReason,
            confirmedAt: input.now.toISOString(),
            source: "explicit_start_resume",
          },
        },
        pausedAt: null,
        pendingHandoffId: null,
        resumedAt: input.now,
        status: "running",
        suggestedReply: null,
      },
      where: {
        id: input.runId,
        kernelSessionId: { not: null },
        status: "awaiting_user",
      },
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async replaceRunBrowser(input: {
    expectedHandoffUpdatedAt?: Date | null;
    expectedPendingHandoffId: string | null;
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerUseAvailable(tx, input.memberId);
      const where = requireCheckpointingHandoffForBrowserUpdate({
        expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt ?? null,
        expectedPendingHandoffId: input.expectedPendingHandoffId,
        where: {
          id: input.runId,
          expiresAt: { gt: input.now },
          kernelSessionId: null,
          memberId: input.memberId,
          pendingHandoffId: input.expectedPendingHandoffId,
          status: "awaiting_user",
        },
      });
      const updated = await tx.hostedComputerRun.updateMany({
        data: {
          kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
          kernelSessionId: input.kernelSessionId,
        },
        where,
      });
      if (updated.count === 0) {
        throw staleRunStateConflictError();
      }

      const run = await tx.hostedComputerRun.findUnique({
        where: { id: input.runId },
      });
      if (!run) {
        throw computerUseNotFoundError();
      }

      return mapRun(run);
    });
  }

  async updateRunBrowserState(input: {
    expectedKernelSessionId: string | null;
    lastTitle: string | null;
    lastUrl: string | null;
    runId: string;
  }): Promise<void> {
    await this.prisma.hostedComputerRun.updateMany({
      data: {
        lastTitle: input.lastTitle,
        lastUrl: input.lastUrl,
      },
      where: {
        id: input.runId,
        kernelSessionId: input.expectedKernelSessionId,
        status: { in: ["running", "awaiting_user"] },
      },
    });
  }

  async markRunProfileCheckpointed(input: {
    authenticated: boolean;
    now: Date;
    runId: string;
  }): Promise<void> {
    await this.prisma.hostedComputerRun.update({
      data: {
        lastCheckpointAt: input.now,
        ...(input.authenticated ? { lastAuthenticatedAt: input.now } : {}),
      },
      where: { id: input.runId },
    });
  }

  async markRunExpired(input: {
    expectedKernelSessionId: string | null;
    now: Date;
    runId: string;
  }): Promise<ComputerMarkRunExpiredResult> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: input.now,
        lastTitle: null,
        lastUrl: null,
        metadataJson: Prisma.JsonNull,
        pendingHandoffId: null,
        suggestedReply: null,
        status: "expired",
      },
      where: {
        id: input.runId,
        kernelSessionId: input.expectedKernelSessionId,
        status: { in: ["running", "awaiting_user"] },
      },
    });
    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return {
      expired: updated.count > 0,
      run: mapRun(run),
    };
  }

  async finishRun(input: {
    expectedCompletedHandoffId?: string | null;
    expectedKernelSessionId: string | null;
    expectedRunStatus?: HostedComputerRunStatus | null;
    now: Date;
    outcome: HostedComputerFinishOutcome;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: input.now,
        lastTitle: null,
        lastUrl: null,
        metadataJson: Prisma.JsonNull,
        pendingHandoffId: null,
        suggestedReply: null,
        status: input.outcome,
      },
      where: requireCompletedHandoffForFinish({
        expectedCompletedHandoffId: input.expectedCompletedHandoffId ?? null,
        where: {
          id: input.runId,
          kernelSessionId: input.expectedKernelSessionId,
          status: input.expectedRunStatus ?? { in: ["running", "awaiting_user"] },
        },
      }),
    });
    if (updated.count === 0) {
      throw staleRunStateConflictError();
    }

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }

  async clearTerminalRunBrowser(input: {
    expectedKernelSessionId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    await this.prisma.hostedComputerRun.updateMany({
      data: {
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      },
      where: {
        id: input.runId,
        kernelSessionId: input.expectedKernelSessionId,
        status: { in: ["completed", "failed", "expired", "canceled"] },
      },
    });

    const run = await this.prisma.hostedComputerRun.findUnique({
      where: { id: input.runId },
    });
    if (!run) {
      throw computerUseNotFoundError();
    }

    return mapRun(run);
  }
}

async function requireMemberComputerUseAvailable(
  prisma: PrismaClient | Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${memberId}
      AND suspended_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) {
    const memberRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM hosted_member
      WHERE id = ${memberId}
      LIMIT 1
    `;
    if (memberRows.length === 0) {
      throw computerUseNotFoundError("Hosted member was not found.");
    }
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
      message: "Computer use is not available for this hosted member.",
      retryable: false,
    });
  }
}

async function lockMemberComputerUseAvailable(
  prisma: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${memberId}
      AND suspended_at IS NULL
    FOR UPDATE
  `;

  if (rows.length > 0) {
    return;
  }

  await requireMemberComputerUseAvailable(prisma, memberId);
}

function staleRunStateConflictError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    message: "Computer run state changed; observe the run before retrying.",
    retryable: true,
  });
}

function requireCheckpointingHandoffForBrowserUpdate(input: {
  expectedHandoffUpdatedAt?: Date | null;
  expectedPendingHandoffId: string | null;
  where: Prisma.HostedComputerRunWhereInput;
}): Prisma.HostedComputerRunWhereInput {
  if (!input.expectedPendingHandoffId) {
    return input.where;
  }

  return {
    ...input.where,
    handoffs: {
      some: {
        id: input.expectedPendingHandoffId,
        status: "checkpointing",
        ...(input.expectedHandoffUpdatedAt
          ? { updatedAt: input.expectedHandoffUpdatedAt }
          : {}),
      },
    },
  };
}

function requirePendingHandoffForRunUpdate(input: {
  expectedHandoffUpdatedAt: Date;
  expectedPendingHandoffId: string;
  where: Prisma.HostedComputerRunWhereInput;
}): Prisma.HostedComputerRunWhereInput {
  return {
    ...input.where,
    handoffs: {
      some: {
        id: input.expectedPendingHandoffId,
        status: { in: ["open", "expired", "revoked"] },
        updatedAt: input.expectedHandoffUpdatedAt,
      },
    },
  };
}

function requireCompletedHandoffForFinish(input: {
  expectedCompletedHandoffId: string | null;
  where: Prisma.HostedComputerRunWhereInput;
}): Prisma.HostedComputerRunWhereInput {
  if (!input.expectedCompletedHandoffId) {
    return input.where;
  }

  return {
    ...input.where,
    handoffs: {
      some: {
        id: input.expectedCompletedHandoffId,
        status: "completed",
      },
    },
    pendingHandoffId: input.expectedCompletedHandoffId,
  };
}

function mapRun(run: PrismaHostedComputerRun): ComputerRunRecord {
  return {
    awaitingMessage: run.awaitingMessage,
    awaitingReason: readAwaitingReason(run.awaitingReason),
    checkpointContext: readRunCheckpointContext(run.metadataJson),
    completedAt: run.completedAt,
    expiresAt: run.expiresAt,
    id: run.id,
    kernelLiveViewUrlEncrypted: run.kernelLiveViewUrlEncrypted,
    kernelProfileName: run.kernelProfileName,
    kernelSessionId: run.kernelSessionId,
    lastAuthenticatedAt: run.lastAuthenticatedAt,
    lastCheckpointAt: run.lastCheckpointAt,
    lastTitle: run.lastTitle,
    lastUrl: run.lastUrl,
    memberId: run.memberId,
    pausedAt: run.pausedAt,
    pendingHandoffId: run.pendingHandoffId,
    profileKey: readProfileKey(run.profileKey),
    resumedAt: run.resumedAt,
    status: readRunStatus(run.status),
    suggestedReply: run.suggestedReply,
    updatedAt: run.updatedAt,
  };
}

function readProfileKey(value: string): HostedComputerProfileKey {
  for (const profileKey of HOSTED_COMPUTER_PROFILE_KEYS) {
    if (profileKey === value) {
      return profileKey;
    }
  }

  throw new Error(`Unknown hosted computer profile key: ${value}`);
}

function readRunCheckpointContext(
  metadata: Prisma.JsonValue | null,
): ComputerRunCheckpointContext | null {
  const record = asRecord(metadata);
  const pause = asRecord(record?.pause);
  const context = asRecord(pause?.checkpointContext);
  const conversationId = readNullableString(context?.conversationId);
  const recipientKey = readNullableString(context?.recipientKey);
  return conversationId || recipientKey
    ? { conversationId, recipientKey }
    : null;
}

function buildRunPauseMetadataJson(
  checkpointContext: ComputerRunCheckpointContext | null,
): Prisma.InputJsonObject {
  return {
    pause: {
      checkpointContext: checkpointContext
        ? {
          conversationId: checkpointContext.conversationId,
          recipientKey: checkpointContext.recipientKey,
        }
        : null,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function mapHandoff(handoff: PrismaHostedComputerHandoff): ComputerHandoffRecord {
  return {
    completedAt: handoff.completedAt,
    expiresAt: handoff.expiresAt,
    id: handoff.id,
    memberId: handoff.memberId,
    openedAt: handoff.openedAt,
    purpose: readHandoffPurpose(handoff.purpose),
    runId: handoff.runId,
    status: readHandoffStatus(handoff.status),
    suggestedReply: handoff.suggestedReply,
    tokenHash: handoff.tokenHash,
    updatedAt: handoff.updatedAt,
  };
}

function readRunStatus(value: string): HostedComputerRunStatus {
  switch (value) {
    case "running":
    case "awaiting_user":
    case "completed":
    case "failed":
    case "expired":
    case "canceled":
      return value;
    default:
      throw new TypeError("Stored computer run status is unsupported.");
  }
}

function readAwaitingReason(
  value: string | null,
): HostedComputerAwaitingReason | null {
  switch (value) {
    case null:
      return null;
    case "login_needed":
    case "payment_needed":
    case "final_confirmation":
    case "stuck":
    case "other":
      return value;
    default:
      throw new TypeError("Stored computer awaiting reason is unsupported.");
  }
}

function readHandoffPurpose(value: string): HostedComputerHandoffPurpose {
  switch (value) {
    case "login":
    case "payment":
    case "card":
    case "captcha":
    case "manual_browser_help":
      return value;
    default:
      throw new TypeError("Stored computer handoff purpose is unsupported.");
  }
}

function readHandoffStatus(value: string): HostedComputerHandoffStatus {
  switch (value) {
    case "open":
    case "checkpointing":
    case "completed":
    case "expired":
    case "revoked":
      return value;
    default:
      throw new TypeError("Stored computer handoff status is unsupported.");
  }
}
