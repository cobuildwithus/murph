import { Prisma } from "@prisma/client";
import type {
  HostedComputerHandoff as PrismaHostedComputerHandoff,
  HostedComputerRun as PrismaHostedComputerRun,
  PrismaClient,
} from "@prisma/client";

import type {
  HostedComputerAwaitingReason,
  HostedComputerFinishOutcome,
  HostedComputerHandoffPurpose,
  HostedComputerHandoffStatus,
  HostedComputerRunStatus,
  HostedComputerReturnContactKind,
} from "@murphai/hosted-execution/computer-use";

import { getPrisma } from "../prisma";
import { computerUseConflictError, computerUseNotFoundError } from "./errors";
import { createComputerId } from "./ids";


export const MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE =
  "member_owned_provider_setup" as const;
export type MemberOwnedProviderSetupComputerRunPurpose =
  typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;

const ACTIVE_COMPUTER_RUN_STATUSES = [
  "running",
  "awaiting_user",
  "cleanup_pending",
] satisfies HostedComputerRunStatus[];
const RUNNABLE_COMPUTER_RUN_STATUSES = [
  "running",
  "awaiting_user",
] satisfies HostedComputerRunStatus[];
const TERMINAL_COMPUTER_RUN_STATUSES = [
  "completed",
  "failed",
  "expired",
  "canceled",
] satisfies HostedComputerRunStatus[];

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
  lastTitle: string | null;
  lastUrl: string | null;
  memberId: string;
  ownerKey?: string | null;
  ownerPurpose?: string | null;
  pausedAt: Date | null;
  pendingHandoffId: string | null;
  resumeAfterMailboxLaneSeq: bigint | null;
  status: HostedComputerRunStatus;
  suggestedReply: string | null;
  updatedAt: Date;
}

export type MemberOwnedProviderSetupRunRecord = ComputerRunRecord;

export interface ComputerRunCheckpointContext {
  conversationId: string | null;
  recipientKey: string | null;
}

export interface ComputerHandoffRecord {
  completedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  memberId: string;
  purpose: PersistedComputerHandoffPurpose;
  runId: string;
  returnContactKind: HostedComputerReturnContactKind | null;
  status: HostedComputerHandoffStatus;
  suggestedReply: string | null;
  tokenHash: string;
  updatedAt: Date;
}

export type PersistedComputerHandoffPurpose =
  | HostedComputerHandoffPurpose
  | "screen_inspection";

export interface ComputerCreateRunResult {
  created: boolean;
  run: ComputerRunRecord;
}

export interface ComputerMarkRunExpiredResult {
  expired: boolean;
  run: ComputerRunRecord;
}

export interface ComputerManagedLoginBrowser {
  kernelLiveViewUrlEncrypted: string;
  kernelSessionId: string;
}

export interface ComputerManagedLoginTerminalResult {
  handoff: ComputerHandoffRecord;
  run: ComputerRunRecord;
}

export interface ComputerUseStore {
  claimHandoffForCompletion(input: {
    handoffId: string;
    memberId: string;
  }): Promise<ComputerHandoffRecord | null>;
  claimLoginHandoffForCheckpoint(input: {
    expectedAwaitingReason: HostedComputerAwaitingReason | null;
    expectedKernelSessionId: string | null;
    expectedPausedAt: Date;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
    expectedStatus: "checkpointing" | "completed";
    expectedUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerHandoffRecord | null>;
  completeHandoff(input: {
    expectedUpdatedAt?: Date;
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord>;
  completeManagedLoginHandoff(input: {
    browser: ComputerManagedLoginBrowser | null;
    expectedHandoffUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerManagedLoginTerminalResult>;
  convertManagedLoginHandoffToLogin(input: {
    browser: ComputerManagedLoginBrowser | null;
    expectedHandoffUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerManagedLoginTerminalResult>;
  createHandoff(input: {
    expiresAt: Date;
    memberId: string;
    purpose: HostedComputerHandoffPurpose;
    runId: string;
    returnContactKind: HostedComputerReturnContactKind | null;
    suggestedReply: string | null;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
  rotateManagedLoginHandoffCapability(input: {
    expectedStatus: "open" | "checkpointing";
    expectedTokenHash: string;
    expectedUpdatedAt: Date;
    expiresAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
  createRun(input: {
    expiresAt: Date;
    id: string;
    kernelProfileName: string;
    memberId: string;
    now: Date;
    ownerKey?: string | null;
    ownerPurpose?: string | null;
    startUrl: string | null;
  }): Promise<ComputerCreateRunResult>;
  attachRunBrowser(input: {
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  findActiveRunForMember(input: {
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord | null>;
  findHandoffByRun(input: {
    handoffId: string;
    runId: string;
  }): Promise<ComputerHandoffRecord | null>;
  listStaleActiveRuns(input: {
    limit?: number;
    now: Date;
  }): Promise<ComputerRunRecord[]>;
  listStaleActiveRunsForMember(input: {
    limit?: number;
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord[]>;
  listMemberRuns(input: {
    memberId: string;
  }): Promise<ComputerRunRecord[]>;
  hasConversationMailboxItemAfter(input: {
    after: Date;
    afterLaneSeq: bigint | null;
    mailboxItemId: string;
    memberId: string;
  }): Promise<boolean>;
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
  markRunAwaitingUser(input: {
    awaitingMessage: string | null;
    awaitingReason: HostedComputerAwaitingReason;
    checkpointContext: ComputerRunCheckpointContext | null;
    now: Date;
    pendingHandoffId: string | null;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerRunRecord>;
  attachAwaitingRunHandoff(input: {
    awaitingReason: HostedComputerAwaitingReason;
    expectedPausedAt: Date;
    newPendingHandoffId: string;
    now: Date;
    runId: string;
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
  markRunCleanupPending(input: {
    expectedHandoffStatus?: HostedComputerHandoffStatus | null;
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string | null;
    expectedPendingHandoffId?: string | null;
    expectedRunStatus: HostedComputerRunStatus;
    expectedRunUpdatedAt: Date;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  markRunRunning(input: {
    awaitingReason: HostedComputerAwaitingReason | null;
    expectedHandoffStatus?: HostedComputerHandoffStatus | null;
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string;
    expectedPausedAt: Date;
    expectedPendingHandoffId: string | null;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
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
  resumeRunAfterLoginCheckpoint(input: {
    awaitingReason: HostedComputerAwaitingReason | null;
    expectedHandoffUpdatedAt: Date;
    expectedKernelSessionId: string;
    expectedPausedAt: Date;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
    handoffId: string;
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
  reclaimHandoffForCompletion(input: {
    expectedUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord | null>;
  requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord>;
  requireMemberOwnedProviderSetupRun(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<MemberOwnedProviderSetupRunRecord>;
  requireMemberOwnedProviderSetupRunAcquisition(input: {
    candidateRunId?: string | null;
    expectedRunId: string | null;
    memberId: string;
    now?: Date;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
  }): Promise<void>;
  requireComputerHandoffAccess(input: {
    memberId: string;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
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
    terminalBrowserCleanupId?: string | null;
  }): Promise<ComputerRunRecord>;
}

export class PrismaComputerUseStore implements ComputerUseStore {
  private readonly prisma: PrismaClient | Prisma.TransactionClient;

  constructor(prisma: PrismaClient | Prisma.TransactionClient = getPrisma()) {
    this.prisma = prisma;
  }

  async findActiveRunForMember(input: {
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord | null> {
    const run = await this.prisma.hostedComputerRun.findFirst({
      where: {
        memberId: input.memberId,
        OR: [
          { status: "cleanup_pending" },
          {
            expiresAt: { gt: input.now },
            status: { in: RUNNABLE_COMPUTER_RUN_STATUSES },
          },
        ],
      },
    });

    return run ? mapRun(run) : null;
  }

  async listStaleActiveRunsForMember(input: {
    limit?: number;
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: input.limit,
      where: {
        memberId: input.memberId,
        OR: [
          {
            expiresAt: { lte: input.now },
            status: { in: ACTIVE_COMPUTER_RUN_STATUSES },
          },
          {
            kernelSessionId: { not: null },
            status: { in: TERMINAL_COMPUTER_RUN_STATUSES },
          },
        ],
      },
    });

    return runs.map(mapRun);
  }

  async listStaleActiveRuns(input: {
    limit?: number;
    now: Date;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "asc",
      },
      take: input.limit,
      where: {
        OR: [
          {
            expiresAt: { lte: input.now },
            status: { in: ACTIVE_COMPUTER_RUN_STATUSES },
          },
          {
            kernelSessionId: { not: null },
            status: { in: TERMINAL_COMPUTER_RUN_STATUSES },
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
    afterLaneSeq: bigint | null;
    mailboxItemId: string;
    memberId: string;
  }): Promise<boolean> {
    const item = await this.prisma.hostedMailboxItem.findFirst({
      select: {
        id: true,
      },
      where: {
        id: input.mailboxItemId,
        ...(input.afterLaneSeq === null
          ? { createdAt: { gt: input.after } }
          : { laneSeq: { gt: input.afterLaneSeq } }),
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
    ownerKey?: string | null;
    ownerPurpose?: string | null;
    startUrl: string | null;
  }): Promise<ComputerCreateRunResult> {
    assertComputerRunOwnerPair(input);
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerRunCreationAvailable(tx, input);

      const activeRun = await tx.hostedComputerRun.findFirst({
        where: {
          memberId: input.memberId,
          OR: [
            { status: "cleanup_pending" },
            {
              expiresAt: { gt: input.now },
              status: { in: RUNNABLE_COMPUTER_RUN_STATUSES },
            },
          ],
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
          ownerKey: input.ownerKey ?? null,
          ownerPurpose: input.ownerPurpose ?? null,
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
      await lockMemberComputerRunMutationAvailable(tx, input);
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
        const existingRun = await tx.hostedComputerRun.findFirst({
          where: {
            expiresAt: { gt: input.now },
            id: input.runId,
            kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
            kernelSessionId: input.kernelSessionId,
            memberId: input.memberId,
            status: { in: RUNNABLE_COMPUTER_RUN_STATUSES },
          },
        });
        if (existingRun) {
          return mapRun(existingRun);
        }
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

  async requireMemberOwnedProviderSetupRun(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<MemberOwnedProviderSetupRunRecord> {
    const run = await this.prisma.hostedComputerRun.findFirst({
      where: {
        id: input.runId,
        memberId: input.memberId,
        ownerKey: input.ownerKey,
        ownerPurpose: input.ownerPurpose,
      },
    });
    if (!run) {
      throw computerUseConflictError({
        code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
        message: "Computer run is not owned by this operation.",
        retryable: false,
      });
    }
    await requireMemberOwnedProviderSetupRunAccess(this.prisma, {
      memberId: input.memberId,
      ownerKey: input.ownerKey,
      runId: input.runId,
    });
    return mapRun(run);
  }

  async requireMemberOwnedProviderSetupRunAcquisition(input: {
    candidateRunId?: string | null;
    expectedRunId: string | null;
    memberId: string;
    now?: Date;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
  }): Promise<void> {
    if (input.ownerPurpose !== MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE) {
      throw new TypeError("Computer run owner purpose is invalid.");
    }
    await requireMemberOwnedProviderSetupRunAccess(this.prisma, {
      expectedRunId: input.expectedRunId,
      memberId: input.memberId,
      ownerKey: input.ownerKey,
    });
    if (input.candidateRunId) {
      await requireMemberOwnedProviderSetupAcquisitionRecovery(this.prisma, {
        candidateRunId: input.candidateRunId,
        expectedRunId: input.expectedRunId,
        memberId: input.memberId,
        now: input.now,
        ownerKey: input.ownerKey,
        ownerPurpose: input.ownerPurpose,
      });
    }
  }

  async requireComputerHandoffAccess(input: {
    memberId: string;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord> {
    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      include: {
        run: {
          select: { id: true, memberId: true, ownerKey: true, ownerPurpose: true },
        },
      },
      where: { tokenHash: input.tokenHash },
    });
    if (!handoff || handoff.memberId !== input.memberId) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }
    if (
      handoff.run.memberId === input.memberId
      && handoff.run.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
      && handoff.run.ownerKey
    ) {
      await requireMemberOwnedProviderSetupRunAccess(this.prisma, {
        memberId: input.memberId,
        ownerKey: handoff.run.ownerKey,
        runId: handoff.run.id,
      });
    } else {
      await requireMemberComputerUseAvailable(this.prisma, input.memberId);
    }
    return mapHandoff(handoff);
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
    returnContactKind: HostedComputerReturnContactKind | null;
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
        returnContactKind: input.returnContactKind,
        suggestedReply: input.suggestedReply,
        tokenHash: input.tokenHash,
      },
    });

    return mapHandoff(handoff);
  }

  async rotateManagedLoginHandoffCapability(input: {
    expectedStatus: "open" | "checkpointing";
    expectedTokenHash: string;
    expectedUpdatedAt: Date;
    expiresAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
    tokenHash: string;
  }): Promise<ComputerHandoffRecord> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const updated = await tx.hostedComputerHandoff.updateMany({
        data: {
          expiresAt: input.expiresAt,
          tokenHash: input.tokenHash,
          // Capability rotation must not refresh the request-local claim lease.
          updatedAt: input.expectedUpdatedAt,
        },
        where: {
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "managed_login",
          run: {
            is: {
              expiresAt: { gt: input.now },
              pendingHandoffId: input.handoffId,
              status: "awaiting_user",
            },
          },
          runId: input.runId,
          status: input.expectedStatus,
          tokenHash: input.expectedTokenHash,
          updatedAt: input.expectedUpdatedAt,
        },
      });
      if (updated.count === 0) {
        throw staleRunStateConflictError();
      }
      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });
      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }
      return mapHandoff(handoff);
    });
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
    const where = requireHandoffForBrowserUpdate({
      expectedHandoffStatus: "checkpointing",
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

  async completeManagedLoginHandoff(input: {
    browser: ComputerManagedLoginBrowser | null;
    expectedHandoffUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerManagedLoginTerminalResult> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const existing = await requireManagedLoginTerminalState(tx, input);
      if (
        existing.handoff.purpose === "managed_login" &&
        existing.handoff.status === "completed" &&
        hasManagedLoginBrowser(existing.run, input.browser)
      ) {
        return existing;
      }
      assertClaimedManagedLoginTerminalState(existing, input);
      const run = await publishManagedLoginBrowser(tx, {
        ...input,
        pendingHandoffId: input.handoffId,
      });
      const completed = await tx.hostedComputerHandoff.updateMany({
        data: {
          completedAt: input.now,
          status: "completed",
        },
        where: {
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "managed_login",
          runId: input.runId,
          status: "checkpointing",
          updatedAt: input.expectedHandoffUpdatedAt,
        },
      });
      if (completed.count === 0) {
        throw staleRunStateConflictError();
      }
      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });
      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }
      return {
        handoff: mapHandoff(handoff),
        run,
      };
    });
  }

  async convertManagedLoginHandoffToLogin(input: {
    browser: ComputerManagedLoginBrowser | null;
    expectedHandoffUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerManagedLoginTerminalResult> {
    return await this.prisma.$transaction(async (tx) => {
      const replyBoundarySeq = await acquireConversationMailboxReplyBoundarySeq(
        tx,
        input.memberId,
      );
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const existing = await requireManagedLoginTerminalState(tx, input);
      if (
        existing.handoff.purpose === "login" &&
        existing.handoff.status === "open" &&
        existing.run.resumeAfterMailboxLaneSeq !== null &&
        hasManagedLoginBrowser(existing.run, input.browser)
      ) {
        return existing;
      }
      assertClaimedManagedLoginTerminalState(existing, input);
      const publishedRun = await publishManagedLoginBrowser(tx, {
        ...input,
        pendingHandoffId: input.handoffId,
      });
      const run = await setManagedLoginFallbackReplyBoundary(
        tx,
        input,
        publishedRun,
        replyBoundarySeq,
      );
      const converted = await tx.hostedComputerHandoff.updateMany({
        data: {
          purpose: "login",
          status: "open",
        },
        where: {
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "managed_login",
          runId: input.runId,
          status: "checkpointing",
          updatedAt: input.expectedHandoffUpdatedAt,
        },
      });
      if (converted.count === 0) {
        throw staleRunStateConflictError();
      }
      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });
      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }
      return {
        handoff: mapHandoff(handoff),
        run,
      };
    });
  }

  async claimHandoffForCompletion(input: {
    handoffId: string;
    memberId: string;
  }): Promise<ComputerHandoffRecord | null> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
      });
      const claimed = await tx.hostedComputerHandoff.updateMany({
        data: {
          status: "checkpointing",
        },
        where: {
          id: input.handoffId,
          memberId: input.memberId,
          status: "open",
        },
      });
      if (claimed.count === 0) {
        return null;
      }

      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });

      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }

      return mapHandoff(handoff);
    });
  }

  async claimLoginHandoffForCheckpoint(input: {
    expectedAwaitingReason: HostedComputerAwaitingReason | null;
    expectedKernelSessionId: string | null;
    expectedPausedAt: Date;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
    expectedStatus: "checkpointing" | "completed";
    expectedUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerHandoffRecord | null> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const claimed = await tx.hostedComputerHandoff.updateMany({
        data: {
          status: "checkpointing",
          updatedAt: input.now,
        },
        where: {
          completedAt: { not: null },
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "login",
          run: {
            is: {
              awaitingReason: input.expectedAwaitingReason,
              expiresAt: { gt: input.now },
              id: input.runId,
              kernelSessionId: input.expectedKernelSessionId,
              memberId: input.memberId,
              pausedAt: input.expectedPausedAt,
              pendingHandoffId: input.handoffId,
              resumeAfterMailboxLaneSeq:
                input.expectedResumeAfterMailboxLaneSeq,
              status: "awaiting_user",
            },
          },
          runId: input.runId,
          status: input.expectedStatus,
          updatedAt: input.expectedUpdatedAt,
        },
      });
      if (claimed.count === 0) {
        return null;
      }

      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });
      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }
      return mapHandoff(handoff);
    });
  }

  async reclaimHandoffForCompletion(input: {
    expectedUpdatedAt: Date;
    handoffId: string;
    memberId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord | null> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
      });
      const reclaimed = await tx.hostedComputerHandoff.updateMany({
        data: {
          updatedAt: input.now,
        },
        where: {
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "managed_login",
          status: "checkpointing",
          updatedAt: input.expectedUpdatedAt,
        },
      });
      if (reclaimed.count === 0) {
        return null;
      }
      const handoff = await tx.hostedComputerHandoff.findUnique({
        where: { id: input.handoffId },
      });
      if (!handoff) {
        throw computerUseNotFoundError("Computer handoff was not found.");
      }
      return mapHandoff(handoff);
    });
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
    awaitingMessage: string | null;
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
        resumeAfterMailboxLaneSeq: null,
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

  async attachAwaitingRunHandoff(input: {
    awaitingReason: HostedComputerAwaitingReason;
    expectedPausedAt: Date;
    newPendingHandoffId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        pausedAt: input.now,
        pendingHandoffId: input.newPendingHandoffId,
        resumeAfterMailboxLaneSeq: null,
      },
      where: {
        awaitingReason: input.awaitingReason,
        expiresAt: { gt: input.now },
        id: input.runId,
        kernelSessionId: { not: null },
        pausedAt: input.expectedPausedAt,
        pendingHandoffId: null,
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
        resumeAfterMailboxLaneSeq: null,
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
    expectedHandoffStatus?: HostedComputerHandoffStatus | null;
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string;
    expectedPausedAt: Date;
    expectedPendingHandoffId: string | null;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: Prisma.JsonNull,
        pausedAt: null,
        pendingHandoffId: null,
        resumeAfterMailboxLaneSeq: null,
        status: "running",
        suggestedReply: null,
      },
      where: requireAnyHandoffForRunUpdate({
        expectedHandoffStatus: input.expectedHandoffStatus ?? null,
        expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt ?? null,
        expectedPendingHandoffId: input.expectedPendingHandoffId,
        where: {
          awaitingReason: input.awaitingReason,
          id: input.runId,
          kernelSessionId: input.expectedKernelSessionId,
          pausedAt: input.expectedPausedAt,
          pendingHandoffId: input.expectedPendingHandoffId,
          resumeAfterMailboxLaneSeq: input.expectedResumeAfterMailboxLaneSeq,
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

  async resumeRunAfterLoginCheckpoint(input: {
    awaitingReason: HostedComputerAwaitingReason | null;
    expectedHandoffUpdatedAt: Date;
    expectedKernelSessionId: string;
    expectedPausedAt: Date;
    expectedResumeAfterMailboxLaneSeq: bigint | null;
    handoffId: string;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const updated = await tx.hostedComputerRun.updateMany({
        data: {
          awaitingMessage: null,
          awaitingReason: null,
          metadataJson: Prisma.JsonNull,
          pausedAt: null,
          pendingHandoffId: null,
          resumeAfterMailboxLaneSeq: null,
          status: "running",
          suggestedReply: null,
        },
        where: requireHandoffForBrowserUpdate({
          expectedHandoffStatus: "checkpointing",
          expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt,
          expectedPendingHandoffId: input.handoffId,
          where: {
            awaitingReason: input.awaitingReason,
            id: input.runId,
            kernelSessionId: input.expectedKernelSessionId,
            memberId: input.memberId,
            pausedAt: input.expectedPausedAt,
            pendingHandoffId: input.handoffId,
            resumeAfterMailboxLaneSeq:
              input.expectedResumeAfterMailboxLaneSeq,
            status: "awaiting_user",
          },
        }),
      });
      if (updated.count === 0) {
        throw staleRunStateConflictError();
      }

      const completed = await tx.hostedComputerHandoff.updateMany({
        data: {
          status: "completed",
        },
        where: {
          completedAt: { not: null },
          id: input.handoffId,
          memberId: input.memberId,
          purpose: "login",
          runId: input.runId,
          status: "checkpointing",
          updatedAt: input.expectedHandoffUpdatedAt,
        },
      });
      if (completed.count === 0) {
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
      await lockMemberComputerHandoffAccess(tx, {
        handoffId: input.expectedPendingHandoffId,
        memberId: input.memberId,
        runId: input.runId,
      });
      const where = requireHandoffForBrowserUpdate({
        expectedHandoffStatus: "checkpointing",
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
        const existingRun = await tx.hostedComputerRun.findFirst({
          where: requireHandoffForBrowserUpdate({
            expectedHandoffStatus: "checkpointing",
            expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt ?? null,
            expectedPendingHandoffId: input.expectedPendingHandoffId,
            where: {
              expiresAt: { gt: input.now },
              id: input.runId,
              kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
              kernelSessionId: input.kernelSessionId,
              memberId: input.memberId,
              pendingHandoffId: input.expectedPendingHandoffId,
              status: "awaiting_user",
            },
          }),
        });
        if (existingRun) {
          return mapRun(existingRun);
        }
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
        status: { in: RUNNABLE_COMPUTER_RUN_STATUSES },
      },
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
        resumeAfterMailboxLaneSeq: null,
        suggestedReply: null,
        status: "expired",
      },
      where: {
        id: input.runId,
        kernelSessionId: input.expectedKernelSessionId,
        status: { in: ACTIVE_COMPUTER_RUN_STATUSES },
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
    terminalBrowserCleanupId?: string | null;
  }): Promise<ComputerRunRecord> {
    const updated = await this.prisma.hostedComputerRun.updateMany({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        completedAt: input.now,
        ...(input.terminalBrowserCleanupId
          ? { kernelSessionId: input.terminalBrowserCleanupId }
          : {}),
        lastTitle: null,
        lastUrl: null,
        metadataJson: Prisma.JsonNull,
        pendingHandoffId: null,
        resumeAfterMailboxLaneSeq: null,
        suggestedReply: null,
        status: input.outcome,
      },
      where: requireCompletedHandoffForFinish({
        expectedCompletedHandoffId: input.expectedCompletedHandoffId ?? null,
        where: {
          id: input.runId,
          kernelSessionId: input.expectedKernelSessionId,
          status: input.expectedRunStatus ?? { in: RUNNABLE_COMPUTER_RUN_STATUSES },
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
        status: { in: TERMINAL_COMPUTER_RUN_STATUSES },
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

  async markRunCleanupPending(input: {
    expectedHandoffStatus?: HostedComputerHandoffStatus | null;
    expectedHandoffUpdatedAt?: Date | null;
    expectedKernelSessionId: string | null;
    expectedPendingHandoffId?: string | null;
    expectedRunStatus: HostedComputerRunStatus;
    expectedRunUpdatedAt: Date;
    memberId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMemberComputerUseOwner(tx, input.memberId);
      const hasExpectedPendingHandoffId = Object.hasOwn(input, "expectedPendingHandoffId");
      const updated = await tx.hostedComputerRun.updateMany({
        data: {
          status: "cleanup_pending",
        },
        where: requireAnyHandoffForRunUpdate({
          expectedHandoffStatus: input.expectedHandoffStatus ?? null,
          expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt ?? null,
          expectedPendingHandoffId: hasExpectedPendingHandoffId
            ? input.expectedPendingHandoffId ?? null
            : null,
          where: {
            id: input.runId,
            kernelSessionId: input.expectedKernelSessionId,
            memberId: input.memberId,
            ...(hasExpectedPendingHandoffId
              ? { pendingHandoffId: input.expectedPendingHandoffId ?? null }
              : {}),
            status: input.expectedRunStatus,
            updatedAt: input.expectedRunUpdatedAt,
          },
        }),
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
}

function assertComputerRunOwnerPair(input: {
  ownerKey?: string | null;
  ownerPurpose?: string | null;
}): void {
  const ownerKey = input.ownerKey?.trim() || null;
  const ownerPurpose = input.ownerPurpose?.trim() || null;
  if ((ownerKey === null) !== (ownerPurpose === null)) {
    throw new TypeError("Computer run owner purpose and key must be supplied together.");
  }
  if (
    ownerPurpose !== null
    && ownerPurpose !== MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
  ) {
    throw new TypeError("Computer run owner purpose is invalid.");
  }
}

async function lockMemberComputerRunCreationAvailable(
  prisma: Prisma.TransactionClient,
  input: {
    id: string;
    memberId: string;
    now: Date;
    ownerKey?: string | null;
    ownerPurpose?: string | null;
  },
): Promise<void> {
  if (!input.ownerKey || !input.ownerPurpose) {
    await lockMemberComputerUseAvailable(prisma, input.memberId);
    return;
  }
  await lockMemberComputerUseOwner(prisma, input.memberId);
  await requireMemberOwnedProviderSetupRunAccess(prisma, {
    allowStaleBoundRunReplacement: true,
    allowUnboundRun: true,
    expectedRunId: input.id,
    memberId: input.memberId,
    now: input.now,
    ownerKey: input.ownerKey,
  });
}

async function lockMemberComputerRunMutationAvailable(
  prisma: Prisma.TransactionClient,
  input: { memberId: string; now: Date; runId: string },
): Promise<void> {
  await lockMemberComputerUseOwner(prisma, input.memberId);
  const run = await prisma.hostedComputerRun.findFirst({
    select: { ownerKey: true, ownerPurpose: true },
    where: { id: input.runId, memberId: input.memberId },
  });
  if (!run) {
    throw computerUseNotFoundError();
  }
  if (
    run.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    && run.ownerKey
  ) {
    await requireMemberOwnedProviderSetupRunAccess(prisma, {
      allowStaleBoundRunReplacement: true,
      allowUnboundRun: true,
      expectedRunId: input.runId,
      memberId: input.memberId,
      now: input.now,
      ownerKey: run.ownerKey,
    });
    return;
  }
  await requireMemberComputerUseAvailable(prisma, input.memberId);
}

async function lockMemberComputerHandoffAccess(
  prisma: Prisma.TransactionClient,
  input: {
    handoffId: string | null;
    memberId: string;
    runId?: string;
  },
): Promise<void> {
  await lockMemberComputerUseOwner(prisma, input.memberId);
  if (!input.handoffId) {
    await requireMemberComputerUseAvailable(prisma, input.memberId);
    return;
  }
  const handoff = await prisma.hostedComputerHandoff.findFirst({
    select: {
      run: {
        select: { id: true, memberId: true, ownerKey: true, ownerPurpose: true },
      },
    },
    where: {
      id: input.handoffId,
      memberId: input.memberId,
      ...(input.runId ? { runId: input.runId } : {}),
    },
  });
  if (
    handoff?.run.memberId === input.memberId
    && handoff.run.ownerPurpose === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
    && handoff.run.ownerKey
  ) {
    await requireMemberOwnedProviderSetupRunAccess(prisma, {
      memberId: input.memberId,
      ownerKey: handoff.run.ownerKey,
      runId: handoff.run.id,
    });
    return;
  }
  await requireMemberComputerUseAvailable(prisma, input.memberId);
}

async function requireMemberOwnedProviderSetupRunAccess(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    allowStaleBoundRunReplacement?: boolean;
    allowUnboundRun?: boolean;
    expectedRunId?: string | null;
    memberId: string;
    now?: Date;
    ownerKey: string;
    runId?: string;
  },
): Promise<void> {
  const member = await prisma.hostedMember.findUnique({
    select: { id: true, suspendedAt: true },
    where: { id: input.memberId },
  });
  if (!member) {
    throw computerUseNotFoundError("Hosted member was not found.");
  }
  if (member.suspendedAt !== null) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_MEMBER_SUSPENDED",
      message: "Computer use is not available for this hosted member.",
      retryable: false,
    });
  }

  const setup = await prisma.deviceProviderSetup.findFirst({
    select: { browserRunId: true, status: true },
    where: {
      active: true,
      id: input.ownerKey,
      memberId: input.memberId,
    },
  });
  if (!setup) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      message: "Computer run owner is no longer available.",
      retryable: false,
    });
  }

  const expectedRunId = input.runId ?? input.expectedRunId ?? null;
  let bindingMatches = expectedRunId === null
    ? setup.browserRunId === null
    : setup.browserRunId === expectedRunId
      || (input.allowUnboundRun === true && setup.browserRunId === null);
  if (
    !bindingMatches
    && input.allowStaleBoundRunReplacement === true
    && input.now
    && setup.browserRunId
  ) {
    const staleBoundRun = await prisma.hostedComputerRun.findFirst({
      select: {
        expiresAt: true,
        ownerKey: true,
        ownerPurpose: true,
        status: true,
      },
      where: {
        id: setup.browserRunId,
        memberId: input.memberId,
      },
    });
    bindingMatches = Boolean(
      staleBoundRun
      && staleBoundRun.ownerKey === input.ownerKey
      && staleBoundRun.ownerPurpose
        === MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE
      && !isComputerRunActiveAt(staleBoundRun, input.now),
    );
  }
  if (!bindingMatches) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      message: "Computer run does not match the setup operation.",
      retryable: false,
    });
  }

}

async function requireMemberOwnedProviderSetupAcquisitionRecovery(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    candidateRunId: string;
    expectedRunId: string | null;
    memberId: string;
    now?: Date;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
  },
): Promise<void> {
  if (!input.expectedRunId || !input.now) {
    throw computerUseConflictError({
      code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
      message: "Computer run does not match the setup operation.",
      retryable: false,
    });
  }
  const runs = await prisma.hostedComputerRun.findMany({
    select: {
      expiresAt: true,
      id: true,
      ownerKey: true,
      ownerPurpose: true,
      status: true,
    },
    where: {
      id: { in: [input.expectedRunId, input.candidateRunId] },
      memberId: input.memberId,
    },
  });
  const expected = runs.find((run) => run.id === input.expectedRunId);
  const candidate = runs.find((run) => run.id === input.candidateRunId);
  const exactOwner = (run: typeof candidate) => Boolean(
    run
    && run.ownerKey === input.ownerKey
    && run.ownerPurpose === input.ownerPurpose,
  );
  if (
    exactOwner(expected)
    && exactOwner(candidate)
    && expected
    && candidate
    && !isComputerRunActiveAt(expected, input.now)
    && isComputerRunActiveAt(candidate, input.now)
  ) {
    return;
  }
  throw computerUseConflictError({
    code: "HOSTED_COMPUTER_RUN_OWNERSHIP_CONFLICT",
    message: "Computer run does not match the setup operation.",
    retryable: false,
  });
}

function isComputerRunActiveAt(
  run: Pick<PrismaHostedComputerRun, "expiresAt" | "status">,
  now: Date,
): boolean {
  return run.status === "cleanup_pending"
    || (
      run.expiresAt > now
      && (run.status === "running" || run.status === "awaiting_user")
    );
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

async function lockMemberComputerUseOwner(
  prisma: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${memberId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw computerUseNotFoundError("Hosted member was not found.");
  }
}

async function acquireConversationMailboxReplyBoundarySeq(
  prisma: Prisma.TransactionClient,
  memberId: string,
): Promise<bigint> {
  // Mailbox append locks this row before its item insert can acquire the member
  // foreign-key lock, so callers must take this boundary before the member row.
  // The no-op update serializes without consuming a lane sequence. Mailbox
  // laneSeq is the shared causal order; timestamps remain audit metadata only.
  let rows: Array<{ boundary: bigint }>;
  try {
    rows = await prisma.$queryRaw<Array<{ boundary: bigint }>>`
      INSERT INTO hosted_mailbox_lane_counter (
        user_id,
        lane,
        next_seq,
        consumed_seq,
        updated_at
      )
      VALUES (${memberId}, 'conversation', 1, 0, clock_timestamp())
      ON CONFLICT (user_id, lane)
      DO UPDATE SET next_seq = hosted_mailbox_lane_counter.next_seq
      RETURNING next_seq - 1 AS boundary
    `;
  } catch {
    throw replyBoundaryUnavailableError();
  }

  const boundary = rows[0]?.boundary;
  if (rows.length !== 1 || typeof boundary !== "bigint" || boundary < 0n) {
    throw replyBoundaryUnavailableError();
  }
  return boundary;
}

function replyBoundaryUnavailableError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_REPLY_BOUNDARY_UNAVAILABLE",
    message: "Computer reply boundary is temporarily unavailable.",
    retryable: true,
  });
}

type ManagedLoginTerminalInput = {
  browser: ComputerManagedLoginBrowser | null;
  expectedHandoffUpdatedAt: Date;
  handoffId: string;
  memberId: string;
  now: Date;
  runId: string;
};

async function requireManagedLoginTerminalState(
  prisma: Prisma.TransactionClient,
  input: ManagedLoginTerminalInput,
): Promise<ComputerManagedLoginTerminalResult> {
  const [handoff, run] = await Promise.all([
    prisma.hostedComputerHandoff.findFirst({
      where: {
        id: input.handoffId,
        memberId: input.memberId,
        runId: input.runId,
      },
    }),
    prisma.hostedComputerRun.findFirst({
      where: {
        id: input.runId,
        memberId: input.memberId,
      },
    }),
  ]);
  if (!handoff || !run) {
    throw computerUseNotFoundError("Computer handoff was not found.");
  }
  return {
    handoff: mapHandoff(handoff),
    run: mapRun(run),
  };
}

function assertClaimedManagedLoginTerminalState(
  state: ComputerManagedLoginTerminalResult,
  input: ManagedLoginTerminalInput,
): void {
  if (
    state.handoff.purpose !== "managed_login" ||
    state.handoff.status !== "checkpointing" ||
    state.handoff.updatedAt.getTime() !== input.expectedHandoffUpdatedAt.getTime() ||
    state.run.expiresAt <= input.now ||
    state.run.pendingHandoffId !== input.handoffId ||
    state.run.status !== "awaiting_user"
  ) {
    throw staleRunStateConflictError();
  }
}

function hasManagedLoginBrowser(
  run: ComputerRunRecord,
  browser: ComputerManagedLoginBrowser | null,
): boolean {
  if (!browser) {
    return Boolean(run.kernelSessionId && run.kernelLiveViewUrlEncrypted);
  }
  return run.kernelSessionId === browser.kernelSessionId &&
    run.kernelLiveViewUrlEncrypted === browser.kernelLiveViewUrlEncrypted;
}

async function publishManagedLoginBrowser(
  prisma: Prisma.TransactionClient,
  input: ManagedLoginTerminalInput & { pendingHandoffId: string },
): Promise<ComputerRunRecord> {
  const existing = await prisma.hostedComputerRun.findFirst({
    where: {
      id: input.runId,
      memberId: input.memberId,
      pendingHandoffId: input.pendingHandoffId,
      status: "awaiting_user",
    },
  });
  if (!existing) {
    throw staleRunStateConflictError();
  }
  const existingRun = mapRun(existing);
  if (hasManagedLoginBrowser(existingRun, input.browser)) {
    return existingRun;
  }
  if (!input.browser || existingRun.kernelSessionId) {
    throw staleRunStateConflictError();
  }

  const updated = await prisma.hostedComputerRun.updateMany({
    data: {
      kernelLiveViewUrlEncrypted: input.browser.kernelLiveViewUrlEncrypted,
      kernelSessionId: input.browser.kernelSessionId,
    },
    where: requireHandoffForBrowserUpdate({
      expectedHandoffStatus: "checkpointing",
      expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt,
      expectedPendingHandoffId: input.pendingHandoffId,
      where: {
        expiresAt: { gt: input.now },
        id: input.runId,
        kernelSessionId: null,
        memberId: input.memberId,
        pendingHandoffId: input.pendingHandoffId,
        status: "awaiting_user",
      },
    }),
  });
  if (updated.count === 0) {
    throw staleRunStateConflictError();
  }
  const run = await prisma.hostedComputerRun.findUnique({
    where: { id: input.runId },
  });
  if (!run) {
    throw computerUseNotFoundError();
  }
  return mapRun(run);
}

async function setManagedLoginFallbackReplyBoundary(
  prisma: Prisma.TransactionClient,
  input: ManagedLoginTerminalInput,
  run: ComputerRunRecord,
  replyBoundarySeq: bigint,
): Promise<ComputerRunRecord> {
  const updated = await prisma.hostedComputerRun.updateMany({
    data: {
      pausedAt: input.now,
      resumeAfterMailboxLaneSeq: replyBoundarySeq,
    },
    where: requireHandoffForBrowserUpdate({
      expectedHandoffStatus: "checkpointing",
      expectedHandoffUpdatedAt: input.expectedHandoffUpdatedAt,
      expectedPendingHandoffId: input.handoffId,
      where: {
        expiresAt: { gt: input.now },
        id: input.runId,
        kernelLiveViewUrlEncrypted: run.kernelLiveViewUrlEncrypted,
        kernelSessionId: run.kernelSessionId,
        memberId: input.memberId,
        pausedAt: run.pausedAt,
        pendingHandoffId: input.handoffId,
        resumeAfterMailboxLaneSeq: null,
        status: "awaiting_user",
      },
    }),
  });
  if (updated.count === 0) {
    throw staleRunStateConflictError();
  }
  const rebased = await prisma.hostedComputerRun.findUnique({
    where: { id: input.runId },
  });
  if (!rebased) {
    throw computerUseNotFoundError();
  }
  return mapRun(rebased);
}

function staleRunStateConflictError(): Error {
  return computerUseConflictError({
    code: "HOSTED_COMPUTER_RUN_STATE_CHANGED",
    message: "Computer run state changed; open the browser before retrying.",
    retryable: true,
  });
}

function requireHandoffForBrowserUpdate(input: {
  expectedHandoffStatus: "checkpointing" | "completed";
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
        status: input.expectedHandoffStatus,
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
        status: { in: ["open", "expired", "completed"] },
        updatedAt: input.expectedHandoffUpdatedAt,
      },
    },
  };
}

function requireAnyHandoffForRunUpdate(input: {
  expectedHandoffStatus: HostedComputerHandoffStatus | null;
  expectedHandoffUpdatedAt: Date | null;
  expectedPendingHandoffId: string | null;
  where: Prisma.HostedComputerRunWhereInput;
}): Prisma.HostedComputerRunWhereInput {
  if (
    !input.expectedPendingHandoffId ||
    (!input.expectedHandoffStatus && !input.expectedHandoffUpdatedAt)
  ) {
    return input.where;
  }

  return {
    ...input.where,
    handoffs: {
      some: {
        id: input.expectedPendingHandoffId,
        ...(input.expectedHandoffStatus
          ? { status: input.expectedHandoffStatus }
          : {}),
        ...(input.expectedHandoffUpdatedAt
          ? { updatedAt: input.expectedHandoffUpdatedAt }
          : {}),
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
    lastTitle: run.lastTitle,
    lastUrl: run.lastUrl,
    memberId: run.memberId,
    ownerKey: run.ownerKey,
    ownerPurpose: run.ownerPurpose,
    pausedAt: run.pausedAt,
    pendingHandoffId: run.pendingHandoffId,
    resumeAfterMailboxLaneSeq: run.resumeAfterMailboxLaneSeq,
    status: readRunStatus(run.status),
    suggestedReply: run.suggestedReply,
    updatedAt: run.updatedAt,
  };
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
    createdAt: handoff.createdAt,
    expiresAt: handoff.expiresAt,
    id: handoff.id,
    memberId: handoff.memberId,
    purpose: readHandoffPurpose(handoff.purpose),
    returnContactKind: readHandoffReturnContactKind(handoff.returnContactKind),
    runId: handoff.runId,
    status: readHandoffStatus(handoff.status),
    suggestedReply: handoff.suggestedReply,
    tokenHash: handoff.tokenHash,
    updatedAt: handoff.updatedAt,
  };
}

function readHandoffReturnContactKind(
  value: string | null,
): HostedComputerReturnContactKind | null {
  switch (value) {
    case null:
    case "text":
    case "telegram":
    case "email":
      return value;
    default:
      throw new TypeError("Hosted computer handoff returnContactKind is invalid.");
  }
}

function readRunStatus(value: string): HostedComputerRunStatus {
  switch (value) {
    case "running":
    case "awaiting_user":
    case "cleanup_pending":
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

function readHandoffPurpose(value: string): PersistedComputerHandoffPurpose {
  switch (value) {
    case "screen_inspection":
    case "managed_login":
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
      return value;
    default:
      throw new TypeError("Stored computer handoff status is unsupported.");
  }
}
