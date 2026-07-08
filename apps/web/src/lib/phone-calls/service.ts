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
  requireHostedPhoneCallResultNotificationRoute,
} from "./notification-route";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import { resolveVerifiedMemberTransferNumber } from "./transfer";
import type { PhoneCallRuntime } from "./types";

const HOSTED_PHONE_CALL_UNSTARTED_REPLAY_GRACE_MS = 2 * 60 * 1_000;

type HostedPhoneCallBeforeStart = (resolverInput: {
  memberId: string;
  phoneCallId: string;
}) => Promise<boolean>;

interface HostedPhoneCallStore {
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
      where: {
        analyzedAt?: null;
        endedAt?: null;
        id: string;
        provider: "retell";
        providerCallId: null;
        providerStartAttemptedAt?: null;
        status: "starting";
      };
    }): Promise<{ count: number }>;
  };
}

export async function createHostedPhoneCall(input: {
  beforeStart?: (resolverInput: {
    memberId: string;
    phoneCallId: string;
  }) => Promise<boolean>;
  brief: HostedPhoneCallBrief;
  memberId: string;
  prisma?: HostedPhoneCallStore;
  requestKey: string;
  resultNotificationRouteResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<void>;
  runtime?: PhoneCallRuntime;
  runtimeOptions?: {
    openingLine?: string | null;
    retellAgentId?: string | null;
    retellAgentVersion?: string | null;
  };
  transferNumberResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
}): Promise<HostedPhoneCallStartResponse> {
  const prisma = input.prisma ?? getPrisma();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const resolveTransferNumber =
    input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber;
  const requireResultNotificationRoute: NonNullable<
    typeof input.resultNotificationRouteResolver
  > =
    input.resultNotificationRouteResolver
    ?? (async ({ memberId }) => {
      await requireHostedPhoneCallResultNotificationRoute({ memberId });
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
  requireResultNotificationRoute: (resolverInput: {
    memberId: string;
  }) => Promise<void>;
  resolveTransferNumber: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
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
    await input.requireResultNotificationRoute({
      memberId: input.memberId,
    });
    if (
      input.beforeStart &&
      !await input.beforeStart({
        memberId: input.memberId,
        phoneCallId: call.id,
      })
    ) {
      throw new Error("Hosted phone call start aborted.");
    }
    const transferNumber = input.brief.allowTransferToUser
      ? await input.resolveTransferNumber({
          memberId: input.memberId,
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
      prisma: input.prisma,
    });
    if (!providerStartAttempt.marked) {
      return {
        phoneCallId: providerStartAttempt.call.id,
        status: toStartResponseStatus(providerStartAttempt.call.status),
      };
    }
    call = providerStartAttempt.call;
    started = await input.runtime.start(runtimeRecord);
  } catch (error) {
    if (hasProviderStartAttemptMarker(call)) {
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
      where: {
        analyzedAt: null,
        id: call.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
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
    const current = await input.prisma.hostedPhoneCall.findUniqueOrThrow({
      where: { id: call.id },
    });
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
  prisma: HostedPhoneCallStore;
}): Promise<
  | { call: HostedPhoneCall; marked: true }
  | { call: HostedPhoneCall; marked: false }
> {
  const markedAt = new Date();
  const updated = await input.prisma.hostedPhoneCall.updateMany({
    data: { providerStartAttemptedAt: markedAt },
    where: {
      analyzedAt: null,
      endedAt: null,
      id: input.call.id,
      provider: "retell",
      providerCallId: null,
      providerStartAttemptedAt: null,
      status: "starting",
    },
  });
  if (updated.count === 0) {
    return {
      call: await input.prisma.hostedPhoneCall.findUniqueOrThrow({
        where: { id: input.call.id },
      }),
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

async function failStaleUnstartedPhoneCallReservation(input: {
  call: HostedPhoneCall;
  prisma: HostedPhoneCallStore;
}): Promise<HostedPhoneCall> {
  const resultJson: HostedPhoneCallResult = {
    outcome: "not_completed",
    summary: "Murph could not start the phone call.",
  };
  if (
    !isStaleUnstartedPhoneCallReservation(input.call)
    || hasProviderStartAttemptMarker(input.call)
  ) {
    return input.call;
  }

  const updated = await input.prisma.hostedPhoneCall.updateMany({
    data: {
      resultJson,
      status: "failed",
    },
    where: {
      analyzedAt: null,
      id: input.call.id,
      provider: "retell",
      providerCallId: null,
      status: "starting",
    },
  });
  if (updated.count === 0) {
    return input.prisma.hostedPhoneCall.findUniqueOrThrow({
      where: { id: input.call.id },
    });
  }

  return {
    ...input.call,
    resultJson,
    status: "failed",
  };
}

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
