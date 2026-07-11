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
  HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS,
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  hostedPhoneCallCrypto,
  readHostedPhoneCallBrief,
  type HostedPhoneCallCrypto,
} from "./crypto";
import {
  requireHostedPhoneCallResultNotificationRoute,
} from "./notification-route";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import { resolveVerifiedMemberTransferNumber } from "./transfer";
import {
  hasPhoneCallRuntimeNoActiveEffect,
  markPhoneCallRuntimeNoActiveEffect,
  type PhoneCallRuntime,
} from "./types";

interface HostedPhoneCallReservationData {
  briefEncrypted: string;
  id: string;
  memberId: string;
  provider: "retell";
  requestKey: string;
  status: "starting";
}

interface HostedPhoneCallStore {
  reserve(input: {
    data: HostedPhoneCallReservationData;
  }): Promise<{
    call: HostedPhoneCall;
    created: boolean;
  }>;
  hostedPhoneCall: {
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
        resultEncrypted?: string;
        resultJson?: Prisma.NullTypes.DbNull;
        status: HostedPhoneCall["status"];
      };
      where: {
        analyzedAt?: null;
        id: string;
        provider: "retell";
        providerCallId: null;
        status: "starting";
      };
    }): Promise<{ count: number }>;
  };
}

export async function createHostedPhoneCall(input: {
  brief: HostedPhoneCallBrief;
  crypto?: HostedPhoneCallCrypto;
  memberId: string;
  prisma?: HostedPhoneCallStore;
  requestKey: string;
  resultNotificationRouteResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<void>;
  runtime?: PhoneCallRuntime;
  signal?: AbortSignal;
  transferNumberResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
}): Promise<HostedPhoneCallStartResponse> {
  const serviceSignal = input.signal
    ? AbortSignal.any([
        input.signal,
        AbortSignal.timeout(HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS);
  return runWithHostedDomainRootUnwrapCache(() => createHostedPhoneCallWithinDeadline({
    ...input,
    signal: serviceSignal,
  }));
}

async function createHostedPhoneCallWithinDeadline(input: Parameters<
  typeof createHostedPhoneCall
>[0] & { signal: AbortSignal }): Promise<HostedPhoneCallStartResponse> {
  const store = resolveHostedPhoneCallStore(input.prisma);
  const crypto = input.crypto ?? hostedPhoneCallCrypto;
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

  input.signal.throwIfAborted();
  await requireResultNotificationRoute({
    memberId: input.memberId,
  });
  input.signal.throwIfAborted();
  const transferNumber = input.brief.allowTransferToUser
    ? await resolveTransferNumber({
        memberId: input.memberId,
      })
    : null;
  input.signal.throwIfAborted();

  const callId = createHostedPhoneCallId();
  const briefEncrypted = await crypto.encryptBrief({
    callId,
    memberId: input.memberId,
    signal: input.signal,
    value: input.brief,
  });
  input.signal.throwIfAborted();
  const reservation = await store.reserve({
    data: {
      briefEncrypted,
      id: callId,
      memberId: input.memberId,
      provider: "retell",
      requestKey: input.requestKey,
      status: "starting",
    },
  });
  const call = reservation.call;
  if (!reservation.created) {
    const existing = reservation.call;
    if (existing.memberId !== input.memberId) {
      throw new Error("Hosted phone call request key collision.");
    }
    assertHostedPhoneCallBriefMatches({
      actual: await readHostedPhoneCallBrief({ call: existing, crypto }),
      expected: input.brief,
    });
    if (hasPhoneCallAdvancedBeyondStart(existing)) {
      return {
        phoneCallId: existing.id,
        status: toStartResponseStatus(existing.status),
      };
    }
    return {
      phoneCallId: existing.id,
      status: "starting",
    };
  }

  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    try {
      input.signal.throwIfAborted();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }
    started = await runtime.start({
      brief: input.brief,
      id: call.id,
      memberId: input.memberId,
      transferNumber,
    }, {
      signal: input.signal,
    });
  } catch (error) {
    if (!hasPhoneCallRuntimeNoActiveEffect(error)) {
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
    const failedResult: HostedPhoneCallResult = {
      outcome: "not_completed",
      summary: "Murph could not start the phone call.",
    };
    const updated = await store.hostedPhoneCall.updateMany({
      data: {
        resultEncrypted: await crypto.encryptResult({
          callId: call.id,
          memberId: call.memberId,
          value: failedResult,
        }),
        resultJson: Prisma.DbNull,
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
      const current = await store.hostedPhoneCall.findUniqueOrThrow({
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

  const updated = await store.hostedPhoneCall.updateMany({
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
    const current = await store.hostedPhoneCall.findUniqueOrThrow({
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

function resolveHostedPhoneCallStore(
  provided: HostedPhoneCallStore | undefined,
): HostedPhoneCallStore {
  if (provided) {
    return provided;
  }

  const prisma = getPrisma();
  return {
    reserve: async (input) => prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.data.memberId);
      await assertActiveHostedMemberAccessAllowed({
        memberId: input.data.memberId,
        prisma: tx,
      });
      const existing = await tx.hostedPhoneCall.findUnique({
        where: {
          memberId_requestKey: {
            memberId: input.data.memberId,
            requestKey: input.data.requestKey,
          },
        },
      });
      if (existing) {
        return {
          call: existing,
          created: false,
        };
      }

      return {
        call: await tx.hostedPhoneCall.create({ data: input.data }),
        created: true,
      };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
    hostedPhoneCall: {
      findUniqueOrThrow: async (input) => prisma.hostedPhoneCall.findUniqueOrThrow(input),
      updateMany: async (input) => prisma.hostedPhoneCall.updateMany(input),
    },
  };
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
