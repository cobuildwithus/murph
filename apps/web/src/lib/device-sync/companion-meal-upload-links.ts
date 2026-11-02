import "server-only";

import type { CompanionMealsProjection } from "@murphai/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

/** Recover only links proven by canonical provenance AND this member's ingress. */
export async function recoverCompanionMealUploadIds(input: {
  memberId: string;
  prisma: Pick<PrismaClient, "$queryRaw">;
  projection: CompanionMealsProjection;
  entities: Array<{ family: string; kind: string; attributes: Record<string, unknown> }>;
}): Promise<void> {
  const meals = new Map(input.projection.days.flatMap(day => day.meals)
    .filter(meal => meal.uploadId === null).map(meal => [meal.id, meal]));
  const candidates = new Map<string, string>();
  for (const entity of input.entities) {
    if (entity.family !== "event" || entity.kind !== "meal") continue;
    const { mealId, source, externalRef } = entity.attributes;
    if (source !== "device" || typeof mealId !== "string" || !meals.has(mealId)) continue;
    if (!externalRef || typeof externalRef !== "object" || Array.isArray(externalRef)) continue;
    const ref = externalRef as Record<string, unknown>;
    if (ref.system === "meal-photo-capture" && ref.resourceType === "photo"
      && typeof ref.resourceId === "string" && /^[a-f0-9]{64}$/u.test(ref.resourceId)) {
      candidates.set(mealId, ref.resourceId);
    }
  }
  const captureIds = [...new Set(candidates.values())];
  if (!captureIds.length) return;
  // The (user_id, kind, created_at) index confines the scan to this member's
  // capture metadata. DISTINCT + candidate membership bounds output by meals.
  // Manual hashes are deliberately excluded; no ciphertext or timestamps read.
  const rows = await input.prisma.$queryRaw<Array<{ captureId: string }>>(Prisma.sql`
    SELECT DISTINCT split_part(dedupe_key, ':', 3) AS "captureId"
    FROM hosted_mailbox_item
    WHERE user_id = ${input.memberId} AND kind = 'meal-photo.captured'
      AND dedupe_key ~ '^meal-photo:[^:]+:[a-f0-9]{64}$'
      AND split_part(dedupe_key, ':', 2) <> 'manual'
      AND split_part(dedupe_key, ':', 3) = ANY(${captureIds}::text[])
  `);
  const confirmed = new Set(rows.map(row => row.captureId));
  for (const [mealId, captureId] of candidates) {
    if (confirmed.has(captureId)) meals.get(mealId)!.uploadId = captureId;
  }
}
