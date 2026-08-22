import type { HostedPhoneCall } from "@prisma/client";
import {
  HOSTED_PHONE_CALL_STATUS_MAX_ITEMS,
  hostedPhoneCallStatusResponseSchema,
  type HostedPhoneCallStatusResponse,
} from "@murphai/hosted-execution/phone-calls";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { getPrisma } from "../prisma";
import {
  hostedPhoneCallCrypto,
  readHostedPhoneCallResults,
  type HostedPhoneCallCrypto,
} from "./crypto";

type HostedPhoneCallStatusRecord = Pick<
  HostedPhoneCall,
  | "analyzedAt"
  | "createdAt"
  | "endedAt"
  | "id"
  | "memberId"
  | "resultEncrypted"
  | "resultJson"
  | "status"
  | "stopRequestedAt"
  | "updatedAt"
>;

interface HostedPhoneCallStatusStore {
  hostedPhoneCall: {
    findMany(input: {
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ];
      select: {
        analyzedAt: true;
        createdAt: true;
        endedAt: true;
        id: true;
        memberId: true;
        resultEncrypted: true;
        resultJson: true;
        status: true;
        stopRequestedAt: true;
        updatedAt: true;
      };
      take: number;
      where: {
        id?: string;
        memberId: string;
      };
    }): Promise<HostedPhoneCallStatusRecord[]>;
  };
}

const HOSTED_PHONE_CALL_STATUS_SELECT = {
  analyzedAt: true,
  createdAt: true,
  endedAt: true,
  id: true,
  memberId: true,
  resultEncrypted: true,
  resultJson: true,
  status: true,
  stopRequestedAt: true,
  updatedAt: true,
} as const;

export async function readHostedPhoneCallStatus(input: {
  crypto?: HostedPhoneCallCrypto;
  memberId: string;
  phoneCallId?: string;
  prisma?: HostedPhoneCallStatusStore;
  signal?: AbortSignal;
}): Promise<HostedPhoneCallStatusResponse> {
  const store = input.prisma ?? resolveHostedPhoneCallStatusStore();
  const crypto = input.crypto ?? hostedPhoneCallCrypto;

  return runWithHostedDomainRootUnwrapCache(async () => {
    const calls = await store.hostedPhoneCall.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: HOSTED_PHONE_CALL_STATUS_SELECT,
      take: input.phoneCallId ? 1 : HOSTED_PHONE_CALL_STATUS_MAX_ITEMS,
      where: {
        ...(input.phoneCallId ? { id: input.phoneCallId } : {}),
        memberId: input.memberId,
      },
    });

    const results = await readHostedPhoneCallResults({
      calls,
      ...(input.crypto ? { crypto } : {}),
      signal: input.signal,
    });
    return hostedPhoneCallStatusResponseSchema.parse({
      calls: calls.map((call, index) => ({
        analyzedAt: call.analyzedAt?.toISOString() ?? null,
        createdAt: call.createdAt.toISOString(),
        endedAt: call.endedAt?.toISOString() ?? null,
        phoneCallId: call.id,
        result: results[index] ?? null,
        status: call.status,
        stopRequestedAt: call.stopRequestedAt?.toISOString() ?? null,
        updatedAt: call.updatedAt.toISOString(),
      })),
    });
  });
}

function resolveHostedPhoneCallStatusStore(): HostedPhoneCallStatusStore {
  const prisma = getPrisma();
  return {
    hostedPhoneCall: {
      findMany: (input) => prisma.hostedPhoneCall.findMany(input),
    },
  };
}
