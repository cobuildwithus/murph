import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionCodexAuthRequestedWake,
  type HostedCodexAuthAction,
} from "@murphai/hosted-execution";
import type {
  HostedCodexAuthSeedResponse,
  HostedCodexAuthUpdate,
  HostedCodexAuthUpdateResponse,
  HostedCodexAuthUpdateResponseStatus,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";
import {
  assertHostedCodexAuthAccessSeedHasUsableLifetime,
  HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS,
  HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS,
  hostedCodexAuthAccessSeedCrypto,
  hostedCodexAuthAccessSeedHasUsableLifetime,
  isHostedCodexAuthAccessSeedPayloadError,
  type HostedCodexAuthAccessSeedCrypto,
  type HostedCodexAuthAccessSeedSubmission,
} from "./access-seed";

const HOSTED_CODEX_AUTH_ATTEMPT_STALE_MS = 15 * 60 * 1000;
const HOSTED_CODEX_AUTH_ATTEMPT_ID_PREFIX = "hca_";
const HOSTED_CODEX_AUTH_ATTEMPT_ID_BYTES = 18;

export type HostedCodexAuthConnectionState =
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "connect_error"
  | "disconnect_error"
  | "error";

export type HostedCodexAuthConnectionView =
  | { state: "disconnected" }
  | {
      state: "connecting";
      userCode: string | null;
      verificationUrl: string | null;
    }
  | { state: "connected" }
  | { state: "disconnecting" }
  | { state: "connect_error" }
  | { state: "disconnect_error" }
  | { state: "error" };

export interface HostedCodexAuthAttemptResult {
  attemptId: string | null;
  mailboxItemId: string | null;
  view: HostedCodexAuthConnectionView;
}

export type HostedCodexAuthCompanionConnectionState =
  | "off"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "needs_attention";

export interface HostedCodexAuthCompanionView {
  connectionVersion: string | null;
  expiresAt: string | null;
  schemaVersion: 1;
  state: HostedCodexAuthCompanionConnectionState;
}

export interface HostedCodexAuthAccessSeedAttemptResult {
  attemptId: string;
  view: HostedCodexAuthCompanionView;
}

export type HostedCodexAuthAccessSeedReadResult = HostedCodexAuthSeedResponse;

type HostedCodexAuthStoreClient = PrismaClient | Prisma.TransactionClient;

interface HostedCodexAuthConnectionRecord {
  accessSeedEncrypted: string | null;
  accessSeedExpiresAt: Date | null;
  attemptId: string;
  state: string;
  updatedAt: Date;
  userCode: string | null;
  verificationUrl: string | null;
}

export async function readHostedCodexAuthCompanionView(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedCodexAuthStoreClient;
}): Promise<HostedCodexAuthCompanionView> {
  const prisma = input.prisma ?? getPrisma();
  const record = await prisma.hostedCodexAuthConnection.findUnique({
    where: { memberId: input.memberId },
  });
  return projectHostedCodexAuthCompanionConnection(record, input.now ?? new Date());
}

export async function beginHostedCodexAuthAccessSeedAttempt(input: {
  crypto?: HostedCodexAuthAccessSeedCrypto;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  seed: HostedCodexAuthAccessSeedSubmission;
}): Promise<HostedCodexAuthAccessSeedAttemptResult> {
  const prisma = input.prisma ?? getPrisma();
  const crypto = input.crypto ?? hostedCodexAuthAccessSeedCrypto;

  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await lockHostedMemberSponsoredAccessRows(tx, input.memberId);
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: tx,
    });
    await assertHostedLaunchRequiredConsentGranted({
      memberId: input.memberId,
      prisma: tx,
    });

    const attemptId = createHostedCodexAuthAttemptId();
    const accessSeedEncrypted = await crypto.encrypt({
      attemptId,
      memberId: input.memberId,
      prisma: tx,
      value: {
        accessToken: input.seed.accessToken,
        chatgptAccountId: input.seed.chatgptAccountId,
        schemaVersion: 1,
      },
    });
    const writeNow = input.now ?? new Date();
    assertHostedCodexAuthAccessSeedHasUsableLifetime(input.seed.expiresAt, writeNow);
    const record = await tx.hostedCodexAuthConnection.upsert({
      create: {
        accessSeedEncrypted,
        accessSeedExpiresAt: input.seed.expiresAt,
        attemptId,
        memberId: input.memberId,
        state: "connecting",
        updatedAt: writeNow,
        userCode: null,
        verificationUrl: null,
      },
      update: {
        accessSeedEncrypted,
        accessSeedExpiresAt: input.seed.expiresAt,
        attemptId,
        state: "connecting",
        updatedAt: writeNow,
        userCode: null,
        verificationUrl: null,
      },
      where: { memberId: input.memberId },
    });

    return {
      attemptId,
      view: projectHostedCodexAuthCompanionConnection(record, writeNow),
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function markHostedCodexAuthAccessSeedReady(input: {
  attemptId: string;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedCodexAuthCompanionView | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedCodexAuthConnection.updateMany({
      data: {
        state: "connected",
        updatedAt: now,
      },
      where: {
        accessSeedEncrypted: { not: null },
        accessSeedExpiresAt: {
          gte: new Date(now.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS),
          lte: new Date(now.getTime() + HOSTED_CODEX_AUTH_ACCESS_SEED_MAX_REMAINING_MS),
        },
        attemptId: input.attemptId,
        memberId: input.memberId,
        state: "connecting",
      },
    });
    const current = await tx.hostedCodexAuthConnection.findUnique({
      where: { memberId: input.memberId },
    });
    const view = projectHostedCodexAuthCompanionConnection(current, now);
    return view.connectionVersion === input.attemptId && view.state === "connected"
      ? view
      : null;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function disconnectHostedCodexAuthAccessSeed(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedCodexAuthAccessSeedAttemptResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const attemptId = createHostedCodexAuthAttemptId();
    const record = await tx.hostedCodexAuthConnection.upsert({
      create: {
        accessSeedEncrypted: null,
        accessSeedExpiresAt: null,
        attemptId,
        memberId: input.memberId,
        state: "disconnecting",
        updatedAt: now,
        userCode: null,
        verificationUrl: null,
      },
      update: {
        accessSeedEncrypted: null,
        accessSeedExpiresAt: null,
        attemptId,
        state: "disconnecting",
        updatedAt: now,
        userCode: null,
        verificationUrl: null,
      },
      where: { memberId: input.memberId },
    });

    return {
      attemptId,
      view: projectHostedCodexAuthCompanionConnection(record, now),
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function markHostedCodexAuthAccessSeedDisconnected(input: {
  attemptId: string;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedCodexAuthCompanionView | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedCodexAuthConnection.updateMany({
      data: {
        state: "disconnected",
        updatedAt: now,
      },
      where: {
        accessSeedEncrypted: null,
        accessSeedExpiresAt: null,
        attemptId: input.attemptId,
        memberId: input.memberId,
        state: "disconnecting",
      },
    });
    const current = await tx.hostedCodexAuthConnection.findUnique({
      where: { memberId: input.memberId },
    });
    const view = projectHostedCodexAuthCompanionConnection(current, now);
    return view.connectionVersion === input.attemptId && view.state === "off"
      ? view
      : null;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function readHostedCodexAuthAccessSeedForRuntime(input: {
  clock?: () => Date;
  crypto?: HostedCodexAuthAccessSeedCrypto;
  includeCredentials: boolean;
  knownConnectionVersion: string | null;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedCodexAuthAccessSeedReadResult> {
  const prisma = input.prisma ?? getPrisma();
  const crypto = input.crypto ?? hostedCodexAuthAccessSeedCrypto;
  const clock = input.clock ?? (() => input.now ?? new Date());

  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await lockHostedMemberSponsoredAccessRows(tx, input.memberId);

    const record = await tx.hostedCodexAuthConnection.findUnique({
      where: { memberId: input.memberId },
    });
    if (!record) {
      return {
        connectionVersion: null,
        reason: "unconfigured",
        schemaVersion: 1,
        status: "unavailable",
      };
    }
    if (!await hostedCodexAuthRuntimeReadPolicyAllows({
      memberId: input.memberId,
      prisma: tx,
    })) {
      return {
        connectionVersion: record?.attemptId ?? null,
        reason: "needs_attention",
        schemaVersion: 1,
        status: "unavailable",
      };
    }

    const unavailableReason = hostedCodexAuthAccessSeedUnavailableReason(record, clock());
    if (unavailableReason) {
      return {
        connectionVersion: record.attemptId,
        reason: unavailableReason,
        schemaVersion: 1,
        status: "unavailable",
      };
    }
    const accessSeedEncrypted = record.accessSeedEncrypted;
    const accessSeedExpiresAt = record.accessSeedExpiresAt;
    if (!accessSeedEncrypted || !accessSeedExpiresAt) {
      return {
        connectionVersion: record.attemptId,
        reason: "needs_attention",
        schemaVersion: 1,
        status: "unavailable",
      };
    }
    if (!input.includeCredentials) {
      return {
        connectionVersion: record.attemptId,
        schemaVersion: 1,
        status: "available_metadata",
      };
    }

    try {
      const seed = await crypto.decrypt({
        attemptId: record.attemptId,
        memberId: input.memberId,
        prisma: tx,
        value: accessSeedEncrypted,
      });
      if (!hostedCodexAuthAccessSeedHasUsableLifetime(accessSeedExpiresAt, clock())) {
        return {
          connectionVersion: record.attemptId,
          reason: "expired",
          schemaVersion: 1,
          status: "unavailable",
        };
      }
      if (input.knownConnectionVersion === record.attemptId) {
        return {
          connectionVersion: record.attemptId,
          schemaVersion: 1,
          status: "unchanged",
        };
      }
      return {
        accessToken: seed.accessToken,
        chatgptAccountId: seed.chatgptAccountId,
        connectionVersion: record.attemptId,
        expiresAt: accessSeedExpiresAt.toISOString(),
        schemaVersion: 1,
        status: "available",
      };
    } catch (error) {
      if (!isHostedCodexAuthAccessSeedPayloadError(error)) {
        throw error;
      }
      return {
        connectionVersion: record.attemptId,
        reason: "needs_attention",
        schemaVersion: 1,
        status: "unavailable",
      };
    }
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function hostedCodexAuthRuntimeReadPolicyAllows(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  try {
    await assertActiveHostedMemberAccessAllowed(input);
    await assertHostedLaunchRequiredConsentGranted(input);
    return true;
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && (
        error.code === "HOSTED_ACCESS_REQUIRED"
        || error.code === "HOSTED_CONSENT_REQUIRED"
        || error.code === "HOSTED_MEMBER_SUSPENDED"
      )
    ) {
      return false;
    }
    throw error;
  }
}

export async function readHostedCodexAuthConnectionView(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedCodexAuthStoreClient;
}): Promise<HostedCodexAuthConnectionView> {
  const prisma = input.prisma ?? getPrisma();
  const record = await prisma.hostedCodexAuthConnection.findUnique({
    where: { memberId: input.memberId },
  });
  return projectHostedCodexAuthConnection(record, input.now ?? new Date());
}

export async function beginHostedCodexAuthAttempt(input: {
  action: HostedCodexAuthAction;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedCodexAuthAttemptResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const current = await tx.hostedCodexAuthConnection.findUnique({
      where: { memberId: input.memberId },
    });

    if (input.action === "connect") {
      if (current?.state === "connected") {
        return {
          attemptId: null,
          mailboxItemId: null,
          view: { state: "connected" },
        };
      }
      if (
        current?.state === "connecting"
        && current.accessSeedEncrypted === null
        && current.accessSeedExpiresAt === null
        && !hostedCodexAuthAttemptIsStale(current.updatedAt, now)
      ) {
        return {
          attemptId: current.attemptId,
          mailboxItemId: await readHostedCodexAuthAttemptMailboxItemId({
            action: input.action,
            attemptId: current.attemptId,
            memberId: input.memberId,
            prisma: tx,
          }),
          view: projectHostedCodexAuthConnection(current, now),
        };
      }
    } else {
      const currentHasNoAccessSeed = !current
        || (current.accessSeedEncrypted === null && current.accessSeedExpiresAt === null);
      if ((!current || current.state === "disconnected") && currentHasNoAccessSeed) {
        return {
          attemptId: null,
          mailboxItemId: null,
          view: { state: "disconnected" },
        };
      }
      if (
        current?.state === "disconnecting"
        && currentHasNoAccessSeed
        && !hostedCodexAuthAttemptIsStale(current.updatedAt, now)
      ) {
        return {
          attemptId: current.attemptId,
          mailboxItemId: await readHostedCodexAuthAttemptMailboxItemId({
            action: input.action,
            attemptId: current.attemptId,
            memberId: input.memberId,
            prisma: tx,
          }),
          view: { state: "disconnecting" },
        };
      }
    }

    const attemptId = createHostedCodexAuthAttemptId();
    const state = input.action === "connect" ? "connecting" : "disconnecting";
    await tx.hostedCodexAuthConnection.upsert({
      create: {
        accessSeedEncrypted: null,
        accessSeedExpiresAt: null,
        attemptId,
        memberId: input.memberId,
        state,
        updatedAt: now,
        userCode: null,
        verificationUrl: null,
      },
      update: {
        accessSeedEncrypted: null,
        accessSeedExpiresAt: null,
        attemptId,
        state,
        updatedAt: now,
        userCode: null,
        verificationUrl: null,
      },
      where: { memberId: input.memberId },
    });

    const mailbox = await appendHostedMailboxEnvelopeTx({
      envelope: buildHostedExecutionCodexAuthRequestedWake({
        action: input.action,
        attemptId,
        eventId: buildHostedCodexAuthAttemptEventId(input.action, attemptId),
        occurredAt: now.toISOString(),
        userId: input.memberId,
      }),
      tx,
    });

    return {
      attemptId,
      mailboxItemId: mailbox.item.id,
      view: state === "connecting"
        ? { state, userCode: null, verificationUrl: null }
        : { state },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function markHostedCodexAuthAttemptError(input: {
  attemptId: string;
  memberId: string;
  prisma?: HostedCodexAuthStoreClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const status = await markHostedCodexAuthAttemptErrorStatus({
    attemptId: input.attemptId,
    memberId: input.memberId,
    prisma,
  });
  return status !== "superseded";
}

export async function applyHostedCodexAuthUpdate(input: {
  crypto?: HostedCodexAuthAccessSeedCrypto;
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  update: HostedCodexAuthUpdate;
}): Promise<HostedCodexAuthUpdateResponse> {
  const prisma = input.prisma ?? getPrisma();

  switch (input.update.phase) {
    case "device_code": {
      const result = await prisma.hostedCodexAuthConnection.updateMany({
        data: {
          state: "connecting",
          userCode: input.update.userCode,
          verificationUrl: input.update.verificationUrl,
        },
        where: {
          accessSeedEncrypted: null,
          accessSeedExpiresAt: null,
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          state: { in: ["connecting", "connect_error"] },
        },
      });
      return result.count === 1
        ? createHostedCodexAuthUpdateResponse("applied")
        : await resolveHostedCodexAuthCallbackMiss({
            alreadyAppliedStates: ["connecting", "connected"],
            attemptId: input.update.attemptId,
            memberId: input.memberId,
            prisma,
            requiresEmptyAccessSeed: true,
          });
    }
    case "connected": {
      return await applyHostedCodexAuthConnectedUpdate({
        attemptId: input.update.attemptId,
        crypto: input.crypto ?? hostedCodexAuthAccessSeedCrypto,
        memberId: input.memberId,
        now: input.now ?? new Date(),
        prisma,
      });
    }
    case "failed": {
      return createHostedCodexAuthUpdateResponse(
        await markHostedCodexAuthAttemptErrorStatus({
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          prisma,
        }),
      );
    }
    case "disconnected": {
      const result = await prisma.hostedCodexAuthConnection.updateMany({
        data: {
          accessSeedEncrypted: null,
          accessSeedExpiresAt: null,
          state: "disconnected",
          userCode: null,
          verificationUrl: null,
        },
        where: {
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          state: { in: ["disconnecting", "disconnect_error"] },
        },
      });
      return result.count === 1
        ? createHostedCodexAuthUpdateResponse("applied")
        : await resolveHostedCodexAuthCallbackMiss({
            alreadyAppliedStates: ["disconnected"],
            attemptId: input.update.attemptId,
            memberId: input.memberId,
            prisma,
          });
    }
  }
}

async function applyHostedCodexAuthConnectedUpdate(input: {
  attemptId: string;
  crypto: HostedCodexAuthAccessSeedCrypto;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedCodexAuthUpdateResponse> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await lockHostedMemberSponsoredAccessRows(tx, input.memberId);

    const current = await tx.hostedCodexAuthConnection.findUnique({
      where: { memberId: input.memberId },
    });
    if (current?.attemptId !== input.attemptId) {
      return createHostedCodexAuthUpdateResponse("superseded");
    }

    const hasEncryptedSeed = current.accessSeedEncrypted !== null;
    const hasSeedExpiry = current.accessSeedExpiresAt !== null;
    if (hasEncryptedSeed !== hasSeedExpiry) {
      return createHostedCodexAuthUpdateResponse("superseded");
    }

    const state = parseHostedCodexAuthConnectionState(current.state);
    const seeded = hasEncryptedSeed && hasSeedExpiry;
    const canApply = seeded
      ? state === "connecting"
      : state === "connecting" || state === "connect_error";
    if (!canApply && state !== "connected") {
      return createHostedCodexAuthUpdateResponse("superseded");
    }
    if (!await hostedCodexAuthRuntimeReadPolicyAllows({
      memberId: input.memberId,
      prisma: tx,
    })) {
      return createHostedCodexAuthUpdateResponse("superseded");
    }
    if (seeded) {
      const accessSeedEncrypted = current.accessSeedEncrypted;
      const accessSeedExpiresAt = current.accessSeedExpiresAt;
      if (
        !accessSeedEncrypted
        || !accessSeedExpiresAt
        || !hostedCodexAuthAccessSeedHasUsableLifetime(accessSeedExpiresAt, input.now)
      ) {
        return createHostedCodexAuthUpdateResponse("superseded");
      }
      try {
        await input.crypto.decrypt({
          attemptId: current.attemptId,
          memberId: input.memberId,
          prisma: tx,
          value: accessSeedEncrypted,
        });
      } catch (error) {
        if (!isHostedCodexAuthAccessSeedPayloadError(error)) {
          throw error;
        }
        return createHostedCodexAuthUpdateResponse("superseded");
      }
    }
    if (state === "connected") {
      return createHostedCodexAuthUpdateResponse("already_applied");
    }

    const result = await tx.hostedCodexAuthConnection.updateMany({
      data: {
        state: "connected",
        userCode: null,
        verificationUrl: null,
      },
      where: {
        accessSeedEncrypted: seeded ? { not: null } : null,
        accessSeedExpiresAt: seeded ? { not: null } : null,
        attemptId: input.attemptId,
        memberId: input.memberId,
        state,
      },
    });
    return createHostedCodexAuthUpdateResponse(
      result.count === 1 ? "applied" : "superseded",
    );
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function resolveHostedCodexAuthCallbackMiss(input: {
  alreadyAppliedStates: readonly HostedCodexAuthConnectionState[];
  attemptId: string;
  memberId: string;
  prisma: HostedCodexAuthStoreClient;
  requiresEmptyAccessSeed?: boolean;
}): Promise<HostedCodexAuthUpdateResponse> {
  return await hostedCodexAuthAttemptIsAlreadyInState({
    attemptId: input.attemptId,
    memberId: input.memberId,
    prisma: input.prisma,
    requiresEmptyAccessSeed: input.requiresEmptyAccessSeed,
    states: input.alreadyAppliedStates,
  })
    ? createHostedCodexAuthUpdateResponse("already_applied")
    : createHostedCodexAuthUpdateResponse("superseded");
}

async function markHostedCodexAuthAttemptErrorStatus(input: {
  attemptId: string;
  memberId: string;
  prisma: HostedCodexAuthStoreClient;
}): Promise<HostedCodexAuthUpdateResponseStatus> {
  const current = await input.prisma.hostedCodexAuthConnection.findUnique({
    where: { memberId: input.memberId },
  });
  if (current?.attemptId !== input.attemptId) {
    return "superseded";
  }

  const state = parseHostedCodexAuthConnectionState(current.state);
  if (state === "connect_error" || state === "disconnect_error" || state === "error") {
    return "already_applied";
  }
  const isSeededConnected = state === "connected"
    && current.accessSeedEncrypted !== null
    && current.accessSeedExpiresAt !== null;
  if (state !== "connecting" && state !== "disconnecting" && !isSeededConnected) {
    return "superseded";
  }

  const hasAccessSeed = current.accessSeedEncrypted !== null
    || current.accessSeedExpiresAt !== null;
  const errorState = state === "disconnecting"
    ? "disconnect_error"
    : hasAccessSeed
    ? "error"
    : "connect_error";
  const result = await input.prisma.hostedCodexAuthConnection.updateMany({
    data: {
      accessSeedEncrypted: null,
      accessSeedExpiresAt: null,
      state: errorState,
      userCode: null,
      verificationUrl: null,
    },
    where: {
      attemptId: input.attemptId,
      memberId: input.memberId,
      state,
    },
  });
  if (result.count === 1) {
    return "applied";
  }
  return await hostedCodexAuthAttemptIsAlreadyInState({
    attemptId: input.attemptId,
    memberId: input.memberId,
    prisma: input.prisma,
    states: [errorState, "error"],
  })
    ? "already_applied"
    : "superseded";
}

async function hostedCodexAuthAttemptIsAlreadyInState(input: {
  attemptId: string;
  memberId: string;
  prisma: HostedCodexAuthStoreClient;
  requiresEmptyAccessSeed?: boolean;
  states: readonly HostedCodexAuthConnectionState[];
}): Promise<boolean> {
  const current = await input.prisma.hostedCodexAuthConnection.findUnique({
    where: { memberId: input.memberId },
  });
  return current?.attemptId === input.attemptId
    && (!input.requiresEmptyAccessSeed
      || (current.accessSeedEncrypted === null && current.accessSeedExpiresAt === null))
    && input.states.includes(parseHostedCodexAuthConnectionState(current.state));
}

function createHostedCodexAuthUpdateResponse(
  status: HostedCodexAuthUpdateResponseStatus,
): HostedCodexAuthUpdateResponse {
  return {
    applied: status !== "superseded",
    status,
  };
}

function projectHostedCodexAuthConnection(
  record: HostedCodexAuthConnectionRecord | null,
  now: Date,
): HostedCodexAuthConnectionView {
  if (!record) {
    return { state: "disconnected" };
  }
  const state = parseHostedCodexAuthConnectionState(record.state);
  if (
    (state === "connecting" || state === "disconnecting")
    && hostedCodexAuthAttemptIsStale(record.updatedAt, now)
  ) {
    return { state: state === "disconnecting" ? "disconnect_error" : "connect_error" };
  }
  if (state === "connecting") {
    return {
      state,
      userCode: record.userCode,
      verificationUrl: record.verificationUrl,
    };
  }
  return { state };
}

function projectHostedCodexAuthCompanionConnection(
  record: HostedCodexAuthConnectionRecord | null,
  now: Date,
): HostedCodexAuthCompanionView {
  if (!record) {
    return {
      connectionVersion: null,
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    };
  }

  const expiresAt = record.accessSeedExpiresAt;
  const safeExpiresAt = expiresAt && Number.isFinite(expiresAt.getTime())
    ? expiresAt.toISOString()
    : null;
  let state: HostedCodexAuthConnectionState;
  try {
    state = parseHostedCodexAuthConnectionState(record.state);
  } catch {
    return {
      connectionVersion: record.attemptId,
      expiresAt: safeExpiresAt,
      schemaVersion: 1,
      state: "needs_attention",
    };
  }

  if (state === "disconnected") {
    return {
      connectionVersion: record.attemptId,
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    };
  }
  if (state === "disconnecting") {
    return {
      connectionVersion: record.attemptId,
      expiresAt: null,
      schemaVersion: 1,
      state: "disconnecting",
    };
  }
  const unavailableReason = hostedCodexAuthAccessSeedUnavailableReason(record, now);
  if (unavailableReason === "expired") {
    return {
      connectionVersion: record.attemptId,
      expiresAt: null,
      schemaVersion: 1,
      state: "off",
    };
  }
  if (
    state === "connect_error"
    || state === "disconnect_error"
    || state === "error"
    || unavailableReason !== null
  ) {
    return {
      connectionVersion: record.attemptId,
      expiresAt: safeExpiresAt,
      schemaVersion: 1,
      state: "needs_attention",
    };
  }

  return {
    connectionVersion: record.attemptId,
    expiresAt: safeExpiresAt,
    schemaVersion: 1,
    state,
  };
}

function hostedCodexAuthAccessSeedUnavailableReason(
  record: HostedCodexAuthConnectionRecord,
  now: Date,
): "disconnected" | "expired" | "legacy_device_code" | "needs_attention" | null {
  let state: HostedCodexAuthConnectionState;
  try {
    state = parseHostedCodexAuthConnectionState(record.state);
  } catch {
    return "needs_attention";
  }
  if (state === "disconnected" || state === "disconnecting") {
    return "disconnected";
  }
  if (state !== "connecting" && state !== "connected") {
    return "needs_attention";
  }
  if (state === "connecting" && hostedCodexAuthAttemptIsStale(record.updatedAt, now)) {
    return "needs_attention";
  }
  if (!record.accessSeedEncrypted && !record.accessSeedExpiresAt) {
    return "legacy_device_code";
  }
  if (!record.accessSeedEncrypted || !record.accessSeedExpiresAt) {
    return "needs_attention";
  }
  if (!hostedCodexAuthAccessSeedHasUsableLifetime(record.accessSeedExpiresAt, now)) {
    const remainingMs = record.accessSeedExpiresAt.getTime() - now.getTime();
    return Number.isFinite(remainingMs)
      && remainingMs < HOSTED_CODEX_AUTH_ACCESS_SEED_MIN_REMAINING_MS
      ? "expired"
      : "needs_attention";
  }
  return null;
}

function parseHostedCodexAuthConnectionState(value: string): HostedCodexAuthConnectionState {
  if (
    value === "connecting"
    || value === "connected"
    || value === "disconnecting"
    || value === "disconnected"
    || value === "connect_error"
    || value === "disconnect_error"
    || value === "error"
  ) {
    return value;
  }
  throw new TypeError("Hosted Codex auth connection state is invalid.");
}

function hostedCodexAuthAttemptIsStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= HOSTED_CODEX_AUTH_ATTEMPT_STALE_MS;
}

async function readHostedCodexAuthAttemptMailboxItemId(input: {
  action: HostedCodexAuthAction;
  attemptId: string;
  memberId: string;
  prisma: HostedCodexAuthStoreClient;
}): Promise<string | null> {
  const item = await readHostedMailboxItemByDedupeKey({
    dedupeKey: buildHostedCodexAuthAttemptEventId(input.action, input.attemptId),
    prisma: input.prisma,
    userId: input.memberId,
  });
  return item?.id ?? null;
}

function buildHostedCodexAuthAttemptEventId(
  action: HostedCodexAuthAction,
  attemptId: string,
): string {
  return `codex-auth:${action}:${attemptId}`;
}

function createHostedCodexAuthAttemptId(): string {
  return `${HOSTED_CODEX_AUTH_ATTEMPT_ID_PREFIX}${randomBytes(
    HOSTED_CODEX_AUTH_ATTEMPT_ID_BYTES,
  ).toString("base64url")}`;
}
