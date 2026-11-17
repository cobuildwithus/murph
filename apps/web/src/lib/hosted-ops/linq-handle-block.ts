import "server-only";
import { getPrisma } from "../prisma";
import { blockHostedLinqHandle, listHostedLinqHandleBlocks, parseHostedLinqBlockContact, unblockHostedLinqHandle,
  type LinqHandleBlockReason } from "../hosted-routing/linq-handle-block";

export function readHostedOpsLinqHandleBlocks(input: { after?: string }) {
  return listHostedLinqHandleBlocks({ ...input, prisma: getPrisma() });
}
export async function updateHostedOpsLinqHandleBlock(input: { operation: "block" | "unblock"; contact: string; reason?: LinqHandleBlockReason }) {
  const contact = parseHostedLinqBlockContact(input.contact), prisma = getPrisma();
  if (input.operation === "block") await blockHostedLinqHandle({ contact, reason: input.reason ?? "operator", prisma });
  else await unblockHostedLinqHandle({ contact, prisma });
  return { ok: true };
}
