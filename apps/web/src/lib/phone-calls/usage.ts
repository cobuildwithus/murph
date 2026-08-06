import {
  type HostedPhoneCall,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { recordHostedRetellPhoneCallUsageTx } from "../hosted-execution/usage";
import { getPrisma } from "../prisma";
import {
  readRetellCallStartAt,
  readRetellTransferEndAt,
  type RetellCallPayload,
} from "./retell-payloads";
import {
  readRetellWebhookCallTarget,
  type RetellWebhookCallTargetStore,
} from "./webhook-target";
import type { HostedPhoneCallProviderUsage } from "./types";

const USD_MICROS_PER_CENT = 10_000;

interface RetellPhoneCallUsageTx extends RetellWebhookCallTargetStore {
  recordUsage(input: {
    call: HostedPhoneCall;
    usage: HostedPhoneCallProviderUsage;
  }): Promise<void>;
}

interface RetellPhoneCallUsageStore {
  $transaction<T>(callback: (tx: RetellPhoneCallUsageTx) => Promise<T>): Promise<T>;
}

export type RetellPhoneCallUsageAccountingResult =
  | "accounted"
  | "not_ready"
  | "not_found";

export async function accountRetellPhoneCallUsage(input: {
  call: RetellCallPayload;
  prisma?: RetellPhoneCallUsageStore;
}): Promise<RetellPhoneCallUsageAccountingResult> {
  const cost = readRetellCombinedCostUsdMicros(input.call);
  const occurredAt = readRetellCallStartAt(input.call);
  if (
    cost === null
    || occurredAt === null
    || isRetellTransferStillActive(input.call)
  ) {
    return "not_ready";
  }

  const prisma = input.prisma ?? resolveRetellPhoneCallUsageStore();
  return prisma.$transaction(async (tx) => {
    const target = await readRetellWebhookCallTarget({
      call: input.call,
      prisma: tx,
    });
    if (!target) {
      return "not_found";
    }

    await tx.recordUsage({
      call: target.call,
      usage: {
        combinedCostUsdMicros: cost,
        occurredAt,
        providerCallId: input.call.call_id,
      },
    });
    return "accounted";
  });
}

export function readRetellTerminalProviderUsage(
  call: RetellCallPayload,
): { state: "pending" } | { state: "ready"; usage: HostedPhoneCallProviderUsage } {
  const combinedCostUsdMicros = readRetellCombinedCostUsdMicros(call);
  const occurredAt = readRetellCallStartAt(call);
  if (
    combinedCostUsdMicros === null
    || occurredAt === null
    || isRetellTransferStillActive(call)
  ) {
    return { state: "pending" };
  }

  return {
    state: "ready",
    usage: {
      combinedCostUsdMicros,
      occurredAt,
      providerCallId: call.call_id,
    },
  };
}

export async function recordRetellPhoneCallProviderUsage(input: {
  call: HostedPhoneCall;
  prisma?: PrismaClient;
  usage: HostedPhoneCallProviderUsage;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  await prisma.$transaction(async (tx) => {
    await recordRetellPhoneCallProviderUsageTx({
      call: input.call,
      tx,
      usage: input.usage,
    });
  });
}

async function recordRetellPhoneCallProviderUsageTx(input: {
  call: HostedPhoneCall;
  tx: Prisma.TransactionClient;
  usage: HostedPhoneCallProviderUsage;
}): Promise<void> {
  if (
    input.call.provider !== "retell"
    || (input.call.providerCallId !== null
      && input.call.providerCallId !== input.usage.providerCallId)
  ) {
    throw new TypeError("Retell usage does not match the hosted phone call authority.");
  }
  await recordHostedRetellPhoneCallUsageTx({
    ...input.usage,
    memberId: input.call.memberId,
    phoneCallId: input.call.id,
    tx: input.tx,
  });
}

function readRetellCombinedCostUsdMicros(call: RetellCallPayload): number | null {
  const combinedCostCents = call.call_cost?.combined_cost;
  if (combinedCostCents === undefined || combinedCostCents === null) {
    return null;
  }
  const combinedCostUsdMicros = Math.round(combinedCostCents * USD_MICROS_PER_CENT);
  if (!Number.isSafeInteger(combinedCostUsdMicros) || combinedCostUsdMicros < 0) {
    throw new TypeError("Retell combined call cost exceeds the supported range.");
  }
  return combinedCostUsdMicros;
}

function isRetellTransferStillActive(call: RetellCallPayload): boolean {
  return call.disconnection_reason?.trim().toLowerCase() === "call_transfer"
    && readRetellTransferEndAt(call) === null;
}

function resolveRetellPhoneCallUsageStore(): RetellPhoneCallUsageStore {
  const prisma = getPrisma();
  return {
    $transaction: async (callback) => prisma.$transaction(async (tx) => callback({
      hostedPhoneCall: {
        findUnique: async (input) => {
          if ("id" in input.where) {
            return tx.hostedPhoneCall.findUnique({
              where: { id: input.where.id },
            });
          }
          return tx.hostedPhoneCall.findUnique({
            where: { providerCallId: input.where.providerCallId },
          });
        },
      },
      recordUsage: async ({ call, usage }) => recordRetellPhoneCallProviderUsageTx({
        call,
        tx,
        usage,
      }),
    })),
  };
}
