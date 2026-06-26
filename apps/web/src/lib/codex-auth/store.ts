import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionCodexAuthRequestedWake,
  type HostedCodexAuthAction,
} from "@murphai/hosted-execution";
import type {
  HostedCodexAuthUpdate,
  HostedCodexAuthUpdateResponse,
  HostedCodexAuthUpdateResponseStatus,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

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

type HostedCodexAuthStoreClient = PrismaClient | Prisma.TransactionClient;

interface HostedCodexAuthConnectionRecord {
  attemptId: string;
  state: string;
  updatedAt: Date;
  userCode: string | null;
  verificationUrl: string | null;
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
      if (!current || current.state === "disconnected") {
        return {
          attemptId: null,
          mailboxItemId: null,
          view: { state: "disconnected" },
        };
      }
      if (
        current.state === "disconnecting"
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
        attemptId,
        memberId: input.memberId,
        state,
        updatedAt: now,
        userCode: null,
        verificationUrl: null,
      },
      update: {
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
  memberId: string;
  prisma?: HostedCodexAuthStoreClient;
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
          });
    }
    case "connected": {
      const result = await prisma.hostedCodexAuthConnection.updateMany({
        data: {
          state: "connected",
          userCode: null,
          verificationUrl: null,
        },
        where: {
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          state: { in: ["connecting", "connect_error"] },
        },
      });
      return result.count === 1
        ? createHostedCodexAuthUpdateResponse("applied")
        : await resolveHostedCodexAuthCallbackMiss({
            alreadyAppliedStates: ["connected"],
            attemptId: input.update.attemptId,
            memberId: input.memberId,
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

async function resolveHostedCodexAuthCallbackMiss(input: {
  alreadyAppliedStates: readonly HostedCodexAuthConnectionState[];
  attemptId: string;
  memberId: string;
  prisma: HostedCodexAuthStoreClient;
}): Promise<HostedCodexAuthUpdateResponse> {
  return await hostedCodexAuthAttemptIsAlreadyInState({
    attemptId: input.attemptId,
    memberId: input.memberId,
    prisma: input.prisma,
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
  if (state !== "connecting" && state !== "disconnecting") {
    return "superseded";
  }

  const errorState = state === "disconnecting" ? "disconnect_error" : "connect_error";
  const result = await input.prisma.hostedCodexAuthConnection.updateMany({
    data: {
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
  states: readonly HostedCodexAuthConnectionState[];
}): Promise<boolean> {
  const current = await input.prisma.hostedCodexAuthConnection.findUnique({
    where: { memberId: input.memberId },
  });
  return current?.attemptId === input.attemptId
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
