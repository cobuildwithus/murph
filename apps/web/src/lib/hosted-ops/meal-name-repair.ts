import "server-only";
import { createHash } from "node:crypto";
import { submitMemberAction } from "../member-actions/submit";
import { readMemberActionStatus } from "../member-actions/outcome";
import { getPrisma } from "../prisma";

/** Fixed migration + member + batch identity makes restarts replay accepted work. */
export function mealNameRepairActionId(memberId: string, batch: number): string {
  const hex = createHash("sha256").update(`meal-name-repair-v1:${memberId}:${batch}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function readMealNameRepairStatus(memberId: string, batch: number) {
  return readMemberActionStatus({ memberId, actionId: mealNameRepairActionId(memberId, batch), prisma: getPrisma() });
}

export async function queueMealNameRepair(memberId: string, batch: number) {
  return submitMemberAction({ memberId, prisma: getPrisma(), request: {
    actionId: mealNameRepairActionId(memberId, batch),
    // Stable request shape, including requestedAt, is required for mailbox replay.
    requestedAt: "2026-11-02T00:00:00.000Z", schemaVersion: 1,
    action: { kind: "meal.names.repair", version: 1, batch },
  } });
}
