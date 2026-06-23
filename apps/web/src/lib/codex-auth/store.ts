import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionCodexAuthRequestedWake,
  type HostedCodexAuthAction,
} from "@murphai/hosted-execution";
import type { HostedCodexAuthUpdate } from "@murphai/hosted-execution/runtime-control";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
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
          mailboxItemId: null,
          view: projectHostedCodexAuthConnection(current, now),
        };
      }
    } else {
      if (!current) {
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
          mailboxItemId: null,
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
        eventId: `codex-auth:${input.action}:${attemptId}`,
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
  const result = await prisma.hostedCodexAuthConnection.updateMany({
    data: {
      state: "error",
      userCode: null,
      verificationUrl: null,
    },
    where: {
      attemptId: input.attemptId,
      memberId: input.memberId,
      state: { in: ["connecting", "disconnecting"] },
    },
  });
  return result.count === 1;
}

export async function applyHostedCodexAuthUpdate(input: {
  memberId: string;
  prisma?: HostedCodexAuthStoreClient;
  update: HostedCodexAuthUpdate;
}): Promise<{ applied: boolean }> {
  const prisma = input.prisma ?? getPrisma();

  switch (input.update.phase) {
    case "device_code": {
      const result = await prisma.hostedCodexAuthConnection.updateMany({
        data: {
          userCode: input.update.userCode,
          verificationUrl: input.update.verificationUrl,
        },
        where: {
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          state: "connecting",
        },
      });
      return { applied: result.count === 1 };
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
          state: "connecting",
        },
      });
      return { applied: result.count === 1 };
    }
    case "failed": {
      return {
        applied: await markHostedCodexAuthAttemptError({
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          prisma,
        }),
      };
    }
    case "disconnected": {
      const result = await prisma.hostedCodexAuthConnection.deleteMany({
        where: {
          attemptId: input.update.attemptId,
          memberId: input.memberId,
          state: "disconnecting",
        },
      });
      return { applied: result.count === 1 };
    }
  }
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
    return { state: "error" };
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
    || value === "error"
  ) {
    return value;
  }
  throw new TypeError("Hosted Codex auth connection state is invalid.");
}

function hostedCodexAuthAttemptIsStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= HOSTED_CODEX_AUTH_ATTEMPT_STALE_MS;
}

function createHostedCodexAuthAttemptId(): string {
  return `${HOSTED_CODEX_AUTH_ATTEMPT_ID_PREFIX}${randomBytes(
    HOSTED_CODEX_AUTH_ATTEMPT_ID_BYTES,
  ).toString("base64url")}`;
}
