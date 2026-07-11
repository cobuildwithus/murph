import { randomUUID } from "node:crypto";

import {
  Prisma,
  type HostedPhoneCall,
} from "@prisma/client";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallResult,
  HostedPhoneCallStartResponse,
} from "@murphai/hosted-execution/phone-calls";
import {
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import {
  activeHostedMemberAccessWithParticipantsWhere,
} from "../hosted-onboarding/member-access";
import {
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  requireHostedPhoneCallResultNotificationRoute,
} from "./notification-route";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import { resolveVerifiedMemberTransferNumber } from "./transfer";
import {
  isPhoneCallRuntimeStartRejectedError,
  type PhoneCallRuntime,
} from "./types";

const HOSTED_PHONE_CALL_UNSTARTED_REPLAY_GRACE_MS = 2 * 60 * 1_000;
const HOSTED_PHONE_CALL_START_FAILED_RESULT: HostedPhoneCallResult = {
  outcome: "not_completed",
  summary: "Murph could not start the phone call.",
};

interface HostedPhoneCallPreflightInput {
  memberId: string;
  prisma: HostedPhoneCallTransactionStore;
}

type HostedPhoneCallBeforeStart = (resolverInput: HostedPhoneCallPreflightInput & {
  phoneCallId: string;
}) => Promise<boolean>;

type HostedPhoneCallProviderStartGuard = (
  attemptedAt: Date,
) => Prisma.HostedPhoneCallWhereInput | null;

interface HostedPhoneCallDataStore {
  hostedPhoneCall: {
    create(input: {
      data: {
        briefJson: HostedPhoneCallBrief;
        id: string;
        memberId: string;
        provider: "retell";
        requestKey: string;
        status: "starting";
      };
    }): Promise<HostedPhoneCall>;
    findUniqueOrThrow(input: {
      where:
        | { id: string }
        | {
            memberId_requestKey: {
              memberId: string;
              requestKey: string;
            };
          };
    }): Promise<HostedPhoneCall>;
    updateMany(input: {
      data: {
        providerCallId?: string;
        providerStartAttemptedAt?: Date;
        resultJson?: HostedPhoneCallResult;
        status?: HostedPhoneCall["status"];
      };
      where: Prisma.HostedPhoneCallWhereInput;
    }): Promise<{ count: number }>;
  };
}

type HostedPhoneCallTransactionStore = Prisma.TransactionClient;

interface HostedPhoneCallStore extends HostedPhoneCallDataStore {
  $transaction<T>(
    callback: (tx: HostedPhoneCallTransactionStore) => Promise<T>,
  ): Promise<T>;
}

interface HostedPhoneCallUpdateStore {
  hostedPhoneCall: Pick<HostedPhoneCallDataStore["hostedPhoneCall"], "updateMany">;
}

export async function createHostedPhoneCall(input: {
  beforeStart?: HostedPhoneCallBeforeStart;
  brief: HostedPhoneCallBrief;
  memberId: string;
  prisma?: HostedPhoneCallStore;
  requestKey: string;
  providerStartGuardWhere?: HostedPhoneCallProviderStartGuard;
  providerStartMemberIds?: readonly string[];
  resultNotificationRouteResolver?: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<void>;
  runtime?: PhoneCallRuntime;
  runtimeOptions?: {
    openingLine?: string | null;
    retellAgentId?: string | null;
    retellAgentVersion?: string | null;
  };
  transferNumberResolver?: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<string | null>;
}): Promise<HostedPhoneCallStartResponse> {
  const prisma = input.prisma ?? getPrisma();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const resolveTransferNumber =
    input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber;
  const requireResultNotificationRoute: NonNullable<
    typeof input.resultNotificationRouteResolver
  > =
    input.resultNotificationRouteResolver
    ?? (async ({ memberId, prisma: transactionPrisma }) => {
      await requireHostedPhoneCallResultNotificationRoute({
        memberId,
        prisma: transactionPrisma,
      });
    });

  let call: HostedPhoneCall;
  try {
    call = await prisma.hostedPhoneCall.create({
      data: {
        briefJson: input.brief,
        id: createHostedPhoneCallId(),
        memberId: input.memberId,
        provider: "retell",
        requestKey: input.requestKey,
        status: "starting",
      },
    });
  } catch (error) {
    if (!isRequestKeyUniqueConstraintError(error)) {
      throw error;
    }
    const existing = await prisma.hostedPhoneCall.findUniqueOrThrow({
      where: {
        memberId_requestKey: {
          memberId: input.memberId,
          requestKey: input.requestKey,
        },
      },
    });
    if (existing.memberId !== input.memberId) {
      throw new Error("Hosted phone call request key collision.");
    }
    assertHostedPhoneCallBriefMatches({
      actual: existing.briefJson,
      expected: input.brief,
    });
    if (
      input.beforeStart
      && isUnstartedPhoneCallReservation(existing)
    ) {
      if (!isStaleUnstartedPhoneCallReservation(existing)) {
        return {
          phoneCallId: existing.id,
          status: toStartResponseStatus(existing.status),
        };
      }
      if (hasProviderStartAttemptMarker(existing)) {
        return {
          phoneCallId: existing.id,
          status: toStartResponseStatus(existing.status),
        };
      }
      return await startHostedPhoneCallReservation({
        beforeStart: input.beforeStart,
        brief: input.brief,
        call: existing,
        memberId: input.memberId,
        prisma,
        providerStartGuardWhere: input.providerStartGuardWhere,
        providerStartMemberIds: sortHostedPhoneCallProviderStartMemberIds({
          memberId: input.memberId,
          memberIds: input.providerStartMemberIds,
        }),
        requireResultNotificationRoute,
        resolveTransferNumber,
        runtime,
        runtimeOptions: input.runtimeOptions,
      });
    }

    const replayed = await failStaleUnstartedPhoneCallReservation({
      call: existing,
      prisma,
    });
    return {
      phoneCallId: replayed.id,
      status: toStartResponseStatus(replayed.status),
    };
  }

  return await startHostedPhoneCallReservation({
    beforeStart: input.beforeStart,
    brief: input.brief,
    call,
    memberId: input.memberId,
    prisma,
    providerStartGuardWhere: input.providerStartGuardWhere,
    providerStartMemberIds: sortHostedPhoneCallProviderStartMemberIds({
      memberId: input.memberId,
      memberIds: input.providerStartMemberIds,
    }),
    requireResultNotificationRoute,
    resolveTransferNumber,
    runtime,
    runtimeOptions: input.runtimeOptions,
  });
}

async function startHostedPhoneCallReservation(input: {
  beforeStart?: HostedPhoneCallBeforeStart;
  brief: HostedPhoneCallBrief;
  call: HostedPhoneCall;
  memberId: string;
  prisma: HostedPhoneCallStore;
  providerStartGuardWhere?: HostedPhoneCallProviderStartGuard;
  providerStartMemberIds: readonly string[];
  requireResultNotificationRoute: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<void>;
  resolveTransferNumber: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<string | null>;
  runtime: PhoneCallRuntime;
  runtimeOptions?: {
    openingLine?: string | null;
    retellAgentId?: string | null;
    retellAgentVersion?: string | null;
  };
}): Promise<HostedPhoneCallStartResponse> {
  let call = input.call;
  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    const prepared = await input.prisma.$transaction(async (tx) => {
      for (const memberId of input.providerStartMemberIds) {
        await lockHostedMemberRow(tx, memberId);
      }
      await input.requireResultNotificationRoute({
        memberId: input.memberId,
        prisma: tx,
      });
      if (
        input.beforeStart &&
        !await input.beforeStart({
          memberId: input.memberId,
          phoneCallId: call.id,
          prisma: tx,
        })
      ) {
        throw new Error("Hosted phone call start aborted.");
      }
      const transferNumber = input.brief.allowTransferToUser
        ? await input.resolveTransferNumber({
            memberId: input.memberId,
            prisma: tx,
          })
        : null;
      const runtimeRecord = {
        brief: input.brief,
        id: call.id,
        memberId: input.memberId,
        openingLine: input.runtimeOptions?.openingLine ?? null,
        retellAgentId: input.runtimeOptions?.retellAgentId ?? null,
        retellAgentVersion: input.runtimeOptions?.retellAgentVersion ?? null,
        transferNumber,
      };
      await input.runtime.validateStart?.(runtimeRecord);
      const providerStartAttempt = await markHostedPhoneCallProviderStartAttempt({
        call,
        prisma: tx,
        providerStartGuardWhere: input.providerStartGuardWhere,
      });
      return { providerStartAttempt, runtimeRecord };
    });
    if (!prepared.providerStartAttempt.marked) {
      return {
        phoneCallId: prepared.providerStartAttempt.call.id,
        status: toStartResponseStatus(prepared.providerStartAttempt.call.status),
      };
    }
    call = prepared.providerStartAttempt.call;
    started = await input.runtime.start(prepared.runtimeRecord);
  } catch (error) {
    if (hasProviderStartAttemptMarker(call)) {
      if (isPhoneCallRuntimeStartRejectedError(error)) {
        if (error.providerCallId) {
          await retainHostedPhoneCallProviderIdForCleanup({
            call,
            prisma: input.prisma,
            providerCallId: error.providerCallId,
            runtime: input.runtime,
          });
          throw error.cause ?? error;
        }
        const failed = await failDefiniteUnstartedPhoneCallReservation({
          call,
          prisma: input.prisma,
        });
        return {
          phoneCallId: failed.id,
          status: toStartResponseStatus(failed.status),
        };
      }
      return {
        phoneCallId: call.id,
        status: toStartResponseStatus(call.status),
      };
    }

    const updated = await input.prisma.hostedPhoneCall.updateMany({
      data: {
        resultJson: {
          outcome: "not_completed",
          summary: "Murph could not start the phone call.",
        },
        status: "failed",
      },
      where: hostedPhoneCallUnstartedAndUnattemptedWhere(call.id),
    });

    if (updated.count === 0) {
      const current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
      if (hasPhoneCallAdvancedBeyondStart(current)) {
        return {
          phoneCallId: current.id,
          status: toStartResponseStatus(current.status),
        };
      }
    }

    throw error;
  }

  let current: HostedPhoneCall | null = null;
  try {
    const updated = await input.prisma.hostedPhoneCall.updateMany({
      data: {
        providerCallId: started.providerCallId,
        status: "calling",
      },
      where: {
        analyzedAt: null,
        id: call.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });

    if (updated.count === 0) {
      current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
    }
  } catch (error) {
    try {
      await input.runtime.stop(started.providerCallId);
    } catch {
      await retainHostedPhoneCallProviderIdForCleanup({
        call,
        prisma: input.prisma,
        providerCallId: started.providerCallId,
        runtime: input.runtime,
      });
    }
    throw error;
  }

  if (current) {
    if (current.providerCallId !== started.providerCallId) {
      await input.runtime.stop(started.providerCallId);
    }
    return {
      phoneCallId: current.id,
      status: toStartResponseStatus(current.status),
    };
  }

  return {
    phoneCallId: call.id,
    status: "calling",
  };
}

async function retainHostedPhoneCallProviderIdForCleanup(input: {
  call: HostedPhoneCall;
  prisma: HostedPhoneCallStore;
  providerCallId: string;
  runtime: PhoneCallRuntime;
}): Promise<void> {
  const retained = await input.prisma.hostedPhoneCall.updateMany({
    data: { providerCallId: input.providerCallId },
    where: {
      analyzedAt: null,
      id: input.call.id,
      provider: "retell",
      providerCallId: null,
      status: "starting",
    },
  });
  if (retained.count > 0) return;

  const current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
    where: { id: input.call.id },
  });
  if (current.providerCallId === input.providerCallId) return;
  await input.runtime.stop(input.providerCallId);
}

async function failDefiniteUnstartedPhoneCallReservation(input: {
  call: HostedPhoneCall;
  prisma: HostedPhoneCallStore;
}): Promise<HostedPhoneCall> {
  const updated = await input.prisma.hostedPhoneCall.updateMany({
    data: {
      resultJson: HOSTED_PHONE_CALL_START_FAILED_RESULT,
      status: "failed",
    },
    where: hostedPhoneCallUnstartedWhere(input.call.id),
  });
  if (updated.count === 0) {
    return await input.prisma.hostedPhoneCall.findUniqueOrThrow({
      where: { id: input.call.id },
    });
  }

  return {
    ...input.call,
    resultJson: HOSTED_PHONE_CALL_START_FAILED_RESULT,
    status: "failed",
  };
}

export async function terminalizeUnstartedHostedPhoneCall(input: {
  phoneCallId: string;
  prisma?: HostedPhoneCallUpdateStore;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const updated = await prisma.hostedPhoneCall.updateMany({
    data: {
      resultJson: HOSTED_PHONE_CALL_START_FAILED_RESULT,
      status: "failed",
    },
    where: hostedPhoneCallUnstartedAndUnattemptedWhere(input.phoneCallId),
  });
  return updated.count > 0;
}

function createHostedPhoneCallId(): string {
  return `hpc_${randomUUID().replaceAll("-", "")}`;
}

function toStartResponseStatus(status: HostedPhoneCall["status"]): HostedPhoneCallStartResponse["status"] {
  switch (status) {
    case "calling":
      return "calling";
    case "failed":
      return "failed";
    default:
      return "starting";
  }
}

function hasPhoneCallAdvancedBeyondStart(call: HostedPhoneCall): boolean {
  return call.status !== "starting"
    || call.providerCallId !== null
    || call.providerStartAttemptedAt !== null
    || call.endedAt !== null
    || call.analyzedAt !== null;
}

function isUnstartedPhoneCallReservation(call: HostedPhoneCall): boolean {
  return call.status === "starting"
    && call.providerCallId === null
    && call.endedAt === null
    && call.analyzedAt === null;
}

function isStaleUnstartedPhoneCallReservation(call: HostedPhoneCall): boolean {
  return isUnstartedPhoneCallReservation(call)
    && Date.now() - call.updatedAt.getTime() >= HOSTED_PHONE_CALL_UNSTARTED_REPLAY_GRACE_MS;
}

function hasProviderStartAttemptMarker(call: HostedPhoneCall): boolean {
  return call.providerStartAttemptedAt !== null;
}

async function markHostedPhoneCallProviderStartAttempt(input: {
  call: HostedPhoneCall;
  prisma: HostedPhoneCallTransactionStore;
  providerStartGuardWhere?: HostedPhoneCallProviderStartGuard;
}): Promise<
  | { call: HostedPhoneCall; marked: true }
  | { call: HostedPhoneCall; marked: false }
> {
  const markedAt = new Date();
  const baseWhere = hostedPhoneCallUnstartedAndUnattemptedWhere(input.call.id);
  const authorityWhere: Prisma.HostedPhoneCallWhereInput[] = [
    baseWhere,
    {
      member: {
        is: activeHostedMemberAccessWithParticipantsWhere(),
      },
    },
  ];
  const providerStartGuardWhere = input.providerStartGuardWhere?.(markedAt);
  if (providerStartGuardWhere) {
    authorityWhere.push(providerStartGuardWhere);
  }
  const updated = input.providerStartGuardWhere && !providerStartGuardWhere
    ? { count: 0 }
    : await input.prisma.hostedPhoneCall.updateMany({
        data: { providerStartAttemptedAt: markedAt },
        where: { AND: authorityWhere },
      });
  if (updated.count === 0) {
    let current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
      where: { id: input.call.id },
    });
    if (
      isUnstartedPhoneCallReservation(current)
      && !hasProviderStartAttemptMarker(current)
      && await terminalizeUnstartedHostedPhoneCall({
        phoneCallId: current.id,
        prisma: input.prisma,
      })
    ) {
      current = {
        ...current,
        resultJson: HOSTED_PHONE_CALL_START_FAILED_RESULT,
        status: "failed",
      };
    } else if (
      isUnstartedPhoneCallReservation(current)
      && !hasProviderStartAttemptMarker(current)
    ) {
      current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
        where: { id: input.call.id },
      });
    }
    return {
      call: current,
      marked: false,
    };
  }

  return {
    call: {
      ...input.call,
      providerStartAttemptedAt: markedAt,
    },
    marked: true,
  };
}

function sortHostedPhoneCallProviderStartMemberIds(input: {
  memberId: string;
  memberIds?: readonly string[];
}): string[] {
  return [...new Set([input.memberId, ...(input.memberIds ?? [])])].sort();
}

async function failStaleUnstartedPhoneCallReservation(input: {
  call: HostedPhoneCall;
  prisma: HostedPhoneCallStore;
}): Promise<HostedPhoneCall> {
  if (
    !isStaleUnstartedPhoneCallReservation(input.call)
    || hasProviderStartAttemptMarker(input.call)
  ) {
    return input.call;
  }

  const terminalized = await terminalizeUnstartedHostedPhoneCall({
    phoneCallId: input.call.id,
    prisma: input.prisma,
  });
  if (!terminalized) {
    return input.prisma.hostedPhoneCall.findUniqueOrThrow({
      where: { id: input.call.id },
    });
  }

  return {
    ...input.call,
    resultJson: HOSTED_PHONE_CALL_START_FAILED_RESULT,
    status: "failed",
  };
}

function hostedPhoneCallUnstartedAndUnattemptedWhere(
  callId: string,
): PhoneCallUpdateManyWhere {
  return {
    ...hostedPhoneCallUnstartedWhere(callId),
    providerStartAttemptedAt: null,
  };
}

function hostedPhoneCallUnstartedWhere(
  callId: string,
): PhoneCallUpdateManyWhere {
  return {
    analyzedAt: null,
    endedAt: null,
    id: callId,
    provider: "retell",
    providerCallId: null,
    status: "starting",
  };
}

type PhoneCallUpdateManyWhere =
  Parameters<HostedPhoneCallStore["hostedPhoneCall"]["updateMany"]>[0]["where"];

function isRequestKeyUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some(isRequestKeyUniqueConstraintTarget);
  }
  return isRequestKeyUniqueConstraintTarget(target);
}

function isRequestKeyUniqueConstraintTarget(value: unknown): boolean {
  return typeof value === "string" && (
    value === "requestKey"
    || value === "request_key"
    || value.includes("requestKey")
    || value.includes("request_key")
  );
}

function assertHostedPhoneCallBriefMatches(input: {
  actual: unknown;
  expected: HostedPhoneCallBrief;
}): void {
  const actual = hostedPhoneCallBriefSchema.safeParse(input.actual);
  if (!actual.success || stableJson(actual.data) !== stableJson(input.expected)) {
    throw new Error("Hosted phone call request key collision.");
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(stabilizeJsonValue(value));
}

function stabilizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilizeJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stabilizeJsonValue(entryValue)]),
  );
}
