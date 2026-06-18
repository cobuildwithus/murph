import type {
  HostedComputerHandoff as PrismaHostedComputerHandoff,
  HostedComputerProfile as PrismaHostedComputerProfile,
  HostedComputerRun as PrismaHostedComputerRun,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import type {
  HostedComputerAwaitingReason,
  HostedComputerFinishOutcome,
  HostedComputerHandoffPurpose,
  HostedComputerHandoffStatus,
  HostedComputerProfileKey,
  HostedComputerRunStatus,
  HostedComputerTaskKind,
} from "@murphai/hosted-execution/computer-use";

import { getPrisma } from "../prisma";
import { computerUseNotFoundError } from "./errors";
import { createComputerId } from "./ids";

const PENDING_RUNNING_WINDOW_MS = 30 * 60 * 1000;

export interface ComputerProfileRecord {
  id: string;
  kernelProfileName: string;
  lastAuthenticatedAt: Date | null;
  lastCheckpointAt: Date | null;
  memberId: string;
  profileKey: string;
}

export interface ComputerRunRecord {
  awaitingMessage: string | null;
  awaitingReason: HostedComputerAwaitingReason | null;
  completedAt: Date | null;
  expiresAt: Date;
  goal: string;
  id: string;
  kernelLiveViewUrlEncrypted: string | null;
  kernelSessionId: string | null;
  lastTitle: string | null;
  lastUrl: string | null;
  memberId: string;
  pausedAt: Date | null;
  pendingHandoffId: string | null;
  profileId: string;
  resumedAt: Date | null;
  status: HostedComputerRunStatus;
  suggestedReply: string | null;
  taskKind: HostedComputerTaskKind;
  updatedAt: Date;
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

export interface ComputerResumeMailboxItemRecord {
  createdAt: Date;
  id: string;
}

export interface ComputerUseStore {
  claimHandoffForCompletion(input: {
    handoffId: string;
  }): Promise<ComputerHandoffRecord | null>;
  completeHandoff(input: {
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
    goal: string;
    id: string;
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    profileId: string;
    startUrl: string | null;
    taskKind: HostedComputerTaskKind;
  }): Promise<ComputerRunRecord>;
  findActiveRunForProfile(input: {
    memberId: string;
    now: Date;
    profileId: string;
  }): Promise<ComputerRunRecord | null>;
  findLatestPendingComputerRun(input: {
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord | null>;
  findLatestConversationMessageAfter(input: {
    after: Date;
    memberId: string;
    now: Date;
  }): Promise<ComputerResumeMailboxItemRecord | null>;
  findOpenHandoffByRun(input: {
    handoffId: string;
    runId: string;
  }): Promise<ComputerHandoffRecord | null>;
  listStaleActiveRuns(input: {
    now: Date;
  }): Promise<ComputerRunRecord[]>;
  listStaleActiveRunsForProfile(input: {
    memberId: string;
    now: Date;
    profileId: string;
  }): Promise<ComputerRunRecord[]>;
  listMemberProfiles(input: {
    memberId: string;
  }): Promise<ComputerProfileRecord[]>;
  listMemberRuns(input: {
    memberId: string;
  }): Promise<ComputerRunRecord[]>;
  markHandoffOpened(input: {
    handoffId: string;
    now: Date;
  }): Promise<void>;
  markHandoffExpired(input: {
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord>;
  clearRunBrowser(input: {
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  markProfileCheckpointed(input: {
    authenticated: boolean;
    now: Date;
    profileId: string;
  }): Promise<void>;
  markRunAwaitingUser(input: {
    awaitingMessage: string;
    awaitingReason: HostedComputerAwaitingReason;
    now: Date;
    pendingHandoffId: string | null;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerRunRecord>;
  markRunExpired(input: {
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  markRunRunning(input: {
    now: Date;
    resumeMailboxItem: ComputerResumeMailboxItemRecord & {
      awaitingReason: HostedComputerAwaitingReason | null;
      source: "conversation_message";
    };
    runId: string;
  }): Promise<ComputerRunRecord>;
  replaceRunBrowser(input: {
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord>;
  requireHandoffByTokenHash(input: {
    tokenHash: string;
  }): Promise<ComputerHandoffRecord>;
  releaseHandoffClaim(input: {
    handoffId: string;
  }): Promise<void>;
  requireOwnedProfile(profileId: string): Promise<ComputerProfileRecord>;
  requireOwnedRun(input: {
    memberId: string;
    runId: string;
  }): Promise<ComputerRunRecord>;
  upsertProfile(input: {
    kernelProfileName: string;
    memberId: string;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerProfileRecord>;
  updateRunBrowserState(input: {
    lastTitle: string | null;
    lastUrl: string | null;
    runId: string;
  }): Promise<void>;
  finishRun(input: {
    now: Date;
    outcome: HostedComputerFinishOutcome;
    runId: string;
    summary: string | null;
  }): Promise<ComputerRunRecord>;
  withMemberComputerUseLock<T>(input: {
    memberId: string;
    run: (store: ComputerUseStore) => Promise<T>;
  }): Promise<T>;
}

export class PrismaComputerUseStore implements ComputerUseStore {
  private readonly prisma: PrismaClient | Prisma.TransactionClient;

  constructor(prisma: PrismaClient | Prisma.TransactionClient = getPrisma()) {
    this.prisma = prisma;
  }

  async withMemberComputerUseLock<T>(input: {
    memberId: string;
    run: (store: ComputerUseStore) => Promise<T>;
  }): Promise<T> {
    if (hasTransaction(this.prisma)) {
      return await this.prisma.$transaction(async (tx) => {
        await lockMemberForComputerUse(tx, input.memberId);
        return await input.run(new PrismaComputerUseStore(tx));
      });
    }

    await lockMemberForComputerUse(this.prisma, input.memberId);
    return await input.run(this);
  }

  async upsertProfile(input: {
    kernelProfileName: string;
    memberId: string;
    profileKey: HostedComputerProfileKey;
  }): Promise<ComputerProfileRecord> {
    const profile = await this.prisma.hostedComputerProfile.upsert({
      create: {
        id: createComputerId("hcp"),
        kernelProfileName: input.kernelProfileName,
        memberId: input.memberId,
        profileKey: input.profileKey,
      },
      update: {
        kernelProfileName: input.kernelProfileName,
      },
      where: {
        memberId_profileKey: {
          memberId: input.memberId,
          profileKey: input.profileKey,
        },
      },
    });

    return mapProfile(profile);
  }

  async findActiveRunForProfile(input: {
    memberId: string;
    now: Date;
    profileId: string;
  }): Promise<ComputerRunRecord | null> {
    const run = await this.prisma.hostedComputerRun.findFirst({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        expiresAt: { gt: input.now },
        memberId: input.memberId,
        profileId: input.profileId,
        status: { in: ["running", "awaiting_user"] },
      },
    });

    return run ? mapRun(run) : null;
  }

  async listStaleActiveRunsForProfile(input: {
    memberId: string;
    now: Date;
    profileId: string;
  }): Promise<ComputerRunRecord[]> {
    const runs = await this.prisma.hostedComputerRun.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        expiresAt: { lte: input.now },
        memberId: input.memberId,
        profileId: input.profileId,
        status: { in: ["running", "awaiting_user"] },
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
        expiresAt: { lte: input.now },
        status: { in: ["running", "awaiting_user"] },
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

  async listMemberProfiles(input: {
    memberId: string;
  }): Promise<ComputerProfileRecord[]> {
    const profiles = await this.prisma.hostedComputerProfile.findMany({
      orderBy: {
        updatedAt: "asc",
      },
      where: {
        memberId: input.memberId,
      },
    });

    return profiles.map(mapProfile);
  }

  async findLatestPendingComputerRun(input: {
    memberId: string;
    now: Date;
  }): Promise<ComputerRunRecord | null> {
    const completedHandoffRun = await this.prisma.hostedComputerRun.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        expiresAt: { gt: input.now },
        handoffs: { some: { status: "completed" } },
        memberId: input.memberId,
        pendingHandoffId: { not: null },
        status: "awaiting_user",
      },
    });
    if (completedHandoffRun) {
      return mapRun(completedHandoffRun);
    }

    const awaitingConfirmationRun = await this.prisma.hostedComputerRun.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        awaitingReason: "final_confirmation",
        expiresAt: { gt: input.now },
        memberId: input.memberId,
        status: "awaiting_user",
      },
    });
    if (awaitingConfirmationRun) {
      return mapRun(awaitingConfirmationRun);
    }

    const recentlyRunningRun = await this.prisma.hostedComputerRun.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        expiresAt: { gt: input.now },
        memberId: input.memberId,
        status: "running",
        updatedAt: { gt: new Date(input.now.getTime() - PENDING_RUNNING_WINDOW_MS) },
      },
    });

    return recentlyRunningRun ? mapRun(recentlyRunningRun) : null;
  }

  async findLatestConversationMessageAfter(input: {
    after: Date;
    memberId: string;
    now: Date;
  }): Promise<ComputerResumeMailboxItemRecord | null> {
    const row = await this.prisma.hostedMailboxItem.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
        id: true,
      },
      where: {
        createdAt: { gt: input.after, lte: input.now },
        kind: "conversation.message",
        lane: "conversation",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: input.now } },
        ],
        userId: input.memberId,
      },
    });

    return row;
  }

  async createRun(input: {
    expiresAt: Date;
    goal: string;
    id: string;
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    memberId: string;
    profileId: string;
    startUrl: string | null;
    taskKind: HostedComputerTaskKind;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.create({
      data: {
        expiresAt: input.expiresAt,
        goal: input.goal,
        id: input.id,
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
        lastUrl: input.startUrl,
        memberId: input.memberId,
        profileId: input.profileId,
        taskKind: input.taskKind,
      },
    });

    return mapRun(run);
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

  async requireOwnedProfile(profileId: string): Promise<ComputerProfileRecord> {
    const profile = await this.prisma.hostedComputerProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw computerUseNotFoundError("Computer profile was not found.");
    }

    return mapProfile(profile);
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

  async findOpenHandoffByRun(input: {
    handoffId: string;
    runId: string;
  }): Promise<ComputerHandoffRecord | null> {
    const handoff = await this.prisma.hostedComputerHandoff.findFirst({
      where: {
        id: input.handoffId,
        runId: input.runId,
        status: { in: ["open", "checkpointing"] },
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
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord> {
    await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        status: "expired",
      },
      where: {
        id: input.handoffId,
        status: { in: ["open", "checkpointing"] },
      },
    });
    const handoff = await this.prisma.hostedComputerHandoff.findUnique({
      where: { id: input.handoffId },
    });

    if (!handoff) {
      throw computerUseNotFoundError("Computer handoff was not found.");
    }

    return mapHandoff(handoff);
  }

  async clearRunBrowser(input: {
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }

  async completeHandoff(input: {
    handoffId: string;
    now: Date;
  }): Promise<ComputerHandoffRecord> {
    await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        completedAt: input.now,
        status: "completed",
      },
      where: {
        id: input.handoffId,
        status: "checkpointing",
      },
    });
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
    handoffId: string;
  }): Promise<void> {
    await this.prisma.hostedComputerHandoff.updateMany({
      data: {
        status: "open",
      },
      where: {
        id: input.handoffId,
        status: "checkpointing",
      },
    });
  }

  async markRunAwaitingUser(input: {
    awaitingMessage: string;
    awaitingReason: HostedComputerAwaitingReason;
    now: Date;
    pendingHandoffId: string | null;
    runId: string;
    suggestedReply: string | null;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        awaitingMessage: input.awaitingMessage,
        awaitingReason: input.awaitingReason,
        pausedAt: input.now,
        pendingHandoffId: input.pendingHandoffId,
        status: "awaiting_user",
        suggestedReply: input.suggestedReply,
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }

  async markRunRunning(input: {
    now: Date;
    resumeMailboxItem: ComputerResumeMailboxItemRecord & {
      awaitingReason: HostedComputerAwaitingReason | null;
      source: "conversation_message";
    };
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        awaitingMessage: null,
        awaitingReason: null,
        metadataJson: {
          resume: {
            awaitingReason: input.resumeMailboxItem.awaitingReason,
            confirmedAt: input.now.toISOString(),
            mailboxCreatedAt: input.resumeMailboxItem.createdAt.toISOString(),
            mailboxItemId: input.resumeMailboxItem.id,
            source: input.resumeMailboxItem.source,
          },
        },
        pausedAt: null,
        pendingHandoffId: null,
        resumedAt: input.now,
        status: "running",
        suggestedReply: null,
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }

  async replaceRunBrowser(input: {
    kernelLiveViewUrlEncrypted: string;
    kernelSessionId: string;
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        kernelLiveViewUrlEncrypted: input.kernelLiveViewUrlEncrypted,
        kernelSessionId: input.kernelSessionId,
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }

  async updateRunBrowserState(input: {
    lastTitle: string | null;
    lastUrl: string | null;
    runId: string;
  }): Promise<void> {
    await this.prisma.hostedComputerRun.update({
      data: {
        lastTitle: input.lastTitle,
        lastUrl: input.lastUrl,
      },
      where: { id: input.runId },
    });
  }

  async markProfileCheckpointed(input: {
    authenticated: boolean;
    now: Date;
    profileId: string;
  }): Promise<void> {
    await this.prisma.hostedComputerProfile.update({
      data: {
        lastCheckpointAt: input.now,
        ...(input.authenticated ? { lastAuthenticatedAt: input.now } : {}),
      },
      where: { id: input.profileId },
    });
  }

  async markRunExpired(input: {
    now: Date;
    runId: string;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        completedAt: input.now,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        status: "expired",
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }

  async finishRun(input: {
    now: Date;
    outcome: HostedComputerFinishOutcome;
    runId: string;
    summary: string | null;
  }): Promise<ComputerRunRecord> {
    const run = await this.prisma.hostedComputerRun.update({
      data: {
        completedAt: input.now,
        kernelLiveViewUrlEncrypted: null,
        kernelSessionId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        metadataJson: input.summary ? { summary: input.summary } : undefined,
        status: input.outcome,
      },
      where: { id: input.runId },
    });

    return mapRun(run);
  }
}

function hasTransaction(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return typeof (prisma as { $transaction?: unknown }).$transaction === "function";
}

async function lockMemberForComputerUse(
  prisma: PrismaClient | Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM hosted_member
    WHERE id = ${memberId}
    FOR KEY SHARE
  `;

  if (rows.length === 0) {
    throw computerUseNotFoundError("Hosted member was not found.");
  }
}

function mapProfile(profile: PrismaHostedComputerProfile): ComputerProfileRecord {
  return {
    id: profile.id,
    kernelProfileName: profile.kernelProfileName,
    lastAuthenticatedAt: profile.lastAuthenticatedAt,
    lastCheckpointAt: profile.lastCheckpointAt,
    memberId: profile.memberId,
    profileKey: profile.profileKey,
  };
}

function mapRun(run: PrismaHostedComputerRun): ComputerRunRecord {
  return {
    awaitingMessage: run.awaitingMessage,
    awaitingReason: readAwaitingReason(run.awaitingReason),
    completedAt: run.completedAt,
    expiresAt: run.expiresAt,
    goal: run.goal,
    id: run.id,
    kernelLiveViewUrlEncrypted: run.kernelLiveViewUrlEncrypted,
    kernelSessionId: run.kernelSessionId,
    lastTitle: run.lastTitle,
    lastUrl: run.lastUrl,
    memberId: run.memberId,
    pausedAt: run.pausedAt,
    pendingHandoffId: run.pendingHandoffId,
    profileId: run.profileId,
    resumedAt: run.resumedAt,
    status: readRunStatus(run.status),
    suggestedReply: run.suggestedReply,
    taskKind: readTaskKind(run.taskKind),
    updatedAt: run.updatedAt,
  };
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

function readTaskKind(value: string): HostedComputerTaskKind {
  switch (value) {
    case "purchase":
    case "appointment":
    case "auth":
    case "generic":
      return value;
    default:
      throw new TypeError("Stored computer task kind is unsupported.");
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
