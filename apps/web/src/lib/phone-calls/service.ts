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
        resultJson?: HostedPhoneCallResult;
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
  memberId: string;
  prisma?: HostedPhoneCallStore;
  requestKey: string;
  resultNotificationRouteResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<void>;
  runtime?: PhoneCallRuntime;
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
    return {
      phoneCallId: existing.id,
      status: toStartResponseStatus(existing.status),
    };
  }

  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    await requireResultNotificationRoute({
      memberId: input.memberId,
    });
    started = await runtime.start({
      brief: input.brief,
      id: call.id,
      memberId: input.memberId,
      transferNumber: input.brief.allowTransferToUser
        ? await resolveTransferNumber({
            memberId: input.memberId,
          })
        : null,
    });
  } catch (error) {
    const updated = await prisma.hostedPhoneCall.updateMany({
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
      const current = await prisma.hostedPhoneCall.findUniqueOrThrow({
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

  const updated = await prisma.hostedPhoneCall.updateMany({
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
    const current = await prisma.hostedPhoneCall.findUniqueOrThrow({
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
