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
      where: {
        requestKey: string;
      };
    }): Promise<HostedPhoneCall>;
    update(input: {
      data: {
        providerCallId?: string;
        resultJson?: HostedPhoneCallResult;
        status: HostedPhoneCall["status"];
      };
      where: {
        id: string;
      };
    }): Promise<HostedPhoneCall>;
  };
}

export async function createHostedPhoneCall(input: {
  brief: HostedPhoneCallBrief;
  memberId: string;
  prisma?: HostedPhoneCallStore;
  requestKey: string;
  runtime?: PhoneCallRuntime;
  transferNumberResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
}): Promise<HostedPhoneCallStartResponse> {
  const prisma = input.prisma ?? getPrisma();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const resolveTransferNumber =
    input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber;

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
      where: { requestKey: input.requestKey },
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
    await prisma.hostedPhoneCall.update({
      data: {
        resultJson: {
          outcome: "not_completed",
          summary: "Murph could not start the phone call.",
        },
        status: "failed",
      },
      where: { id: call.id },
    });
    throw error;
  }

  await prisma.hostedPhoneCall.update({
    data: {
      providerCallId: started.providerCallId,
      status: "calling",
    },
    where: { id: call.id },
  });

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
