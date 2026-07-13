import type {
  HostedPhoneCall,
  HostedPhoneCallStatus,
  Prisma,
} from "@prisma/client";
import { HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS } from "@murphai/hosted-execution/phone-calls";

export const HOSTED_PHONE_CALL_ACTIVE_STATUSES = [
  "starting",
  "calling",
] as const satisfies readonly HostedPhoneCallStatus[];

export function isHostedPhoneCallProviderCleanupPending(
  call: Pick<
    HostedPhoneCall,
    "analyzedAt" | "endedAt" | "provider" | "providerCallId" | "status"
  >,
): boolean {
  return call.provider === "retell"
    && call.status === "failed"
    && call.providerCallId !== null
    && call.endedAt === null
    && call.analyzedAt === null;
}

export function hostedPhoneCallNewRequestBlockerWhere(
  memberId: string,
): Prisma.HostedPhoneCallWhereInput {
  return {
    memberId,
    OR: [
      {
        analyzedAt: null,
        endedAt: null,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
      {
        analyzedAt: null,
        endedAt: null,
        provider: "retell",
        providerCallId: { not: null },
        status: "failed",
      },
    ],
  };
}

export function isHostedPhoneCallNewRequestBlocker(
  call: Pick<
    HostedPhoneCall,
    "analyzedAt" | "endedAt" | "provider" | "providerCallId" | "status"
  >,
): boolean {
  return (
    call.provider === "retell"
    && call.status === "starting"
    && call.providerCallId === null
    && call.endedAt === null
    && call.analyzedAt === null
  ) || isHostedPhoneCallProviderCleanupPending(call);
}

export function isHostedPhoneCallReadyForProviderReconciliation(
  call: Pick<
    HostedPhoneCall,
    "analyzedAt" | "endedAt" | "providerCallId" | "status" | "updatedAt"
  >,
  now = new Date(),
): boolean {
  return call.status === "starting"
    && call.providerCallId === null
    && call.endedAt === null
    && call.analyzedAt === null
    && now.getTime() - call.updatedAt.getTime() >= HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS;
}
