import "server-only";
import type { Prisma } from "@prisma/client";
import { companionPresence } from "@murphai/hosted-execution/companion-presence";
import { getPrisma } from "../prisma";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { requirePersonalMember } from "./member-access";

const transactionOptions = { maxWait: 5_000, timeout: 5_000 };

export async function recordCompanionHeartbeat(memberId: string, state: "foreground" | "background"): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    await requirePersonalMember(tx, memberId);
    // Receipt time is sampled after the member lock. Concurrent requests cannot
    // move it backward, and clients cannot manufacture freshness timestamps.
    const now = new Date();
    await tx.hostedMember.update({
      where: { id: memberId }, data: { companionLastContactAt: now,
        ...(state === "foreground" ? { companionLastForegroundAt: now } : {}),
      },
    });
  }, transactionOptions);
}

export async function readCompanionPresenceTx(tx: Prisma.TransactionClient, memberId: string, now = new Date()) {
  const member = await tx.hostedMember.findUniqueOrThrow({
    where: { id: memberId }, select: { companionLastContactAt: true, companionLastForegroundAt: true },
  });
  return companionPresence(member.companionLastContactAt, member.companionLastForegroundAt, now);
}

export async function readRuntimeCompanionPresence(memberId: string, runtimeIdentity: HostedRuntimeIdentity | null) {
  return getPrisma().$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, memberId, runtimeIdentity);
    await requirePersonalMember(tx, memberId);
    return readCompanionPresenceTx(tx, memberId);
  }, transactionOptions);
}
