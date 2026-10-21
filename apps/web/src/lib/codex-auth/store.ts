import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedCodexAuthUpdate,
  HostedCodexAuthUpdateResponse,
  HostedCodexAuthUpdateResponseStatus,
} from "@murphai/hosted-execution/runtime-control";

import { getPrisma } from "../prisma";

type HostedCodexAuthStoreClient = PrismaClient | Prisma.TransactionClient;

type HostedCodexAuthConnectionState =
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "connect_error"
  | "disconnect_error"
  | "error";

// Consumer only: deployed old runners still finish accepted auth attempts.
// Removal requires the drain proof in hosted-runtime-protocol.md.
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
