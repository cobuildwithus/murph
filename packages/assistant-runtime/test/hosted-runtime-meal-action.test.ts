import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { addMeal, upsertEvent, initializeVault } from "@murphai/core";
import { readMealNutritionTotals } from "@murphai/query";
import { createBrowserVaultReplica, readVault } from "@murphai/query/browser-replica-server";
import { memberActionRequestV1Schema } from "@murphai/contracts";
import { executeHostedMemberActionWake } from "../src/hosted-runtime/events/member-action.ts";

it.each([false, true])("tombstones nutrition and safely handles redelivery (corrected import: %s)", async corrected => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-meal-action-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const removed = await addMeal({ vaultRoot, occurredAt: "2026-11-01T12:00:00Z", note: "Synthetic grain bowl", nutrition: { totals: { calories: 500, proteinGrams: 25 } },
      ...(corrected ? { source: "device", externalRef: { system: "synthetic-provider", resourceType: "meal", resourceId: "synthetic-meal", version: "2026-11-01T12:00:00Z" } } : {}),
    });
    await upsertEvent({ vaultRoot, allowSpecializedKindRewrite: true, payload: { ...removed.event, uploadId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243" } });
    if (corrected) {
      await upsertEvent({ vaultRoot, allowSpecializedKindRewrite: true, payload: {
        ...removed.event, uploadId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243", occurredAt: "2026-11-01T12:30:00Z",
        externalRef: { ...removed.event.externalRef, version: "2026-11-01T12:30:00Z" },
      } });
    }
    await addMeal({ vaultRoot, occurredAt: "2026-11-01T13:00:00Z", note: "Synthetic snack", nutrition: { totals: { calories: 100 } } });
    expect(await readMealNutritionTotals(vaultRoot)).toMatchObject({ mealCount: 2, totals: { calories: { total: 600 } } });
    const request = memberActionRequestV1Schema.parse({
      schemaVersion: 1, actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243", requestedAt: "2026-11-01T14:00:00Z",
      action: { kind: "meal.delete", version: 1, mealId: removed.mealId },
    });
    const wake = { kind: "member.action.requested" as const, eventId: `member.action.requested:${request.actionId}`, occurredAt: request.requestedAt, request, userId: "member_fixture" };
    expect(await executeHostedMemberActionWake({ vaultRoot, wake })).toMatchObject({
      conversationMetrics: null, mailboxLane: "member-action",
      postCheckpointRecord: { kind: "member-action.outcome-recorded", outcome: { status: "applied", reason: null } },
    });
    expect(await readMealNutritionTotals(vaultRoot)).toMatchObject({ mealCount: 1, totals: { calories: { total: 100 } } });
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: [], sourceBundleHash: "a".repeat(64) });
    expect(replica.meals?.days).toHaveLength(1);
    expect(replica.meals?.days[0]).toMatchObject({ calories: 100, mealCount: 1 });
    expect(replica.meals?.days[0]?.meals.some(meal => meal.id === removed.mealId)).toBe(false);
    expect(await executeHostedMemberActionWake({ vaultRoot, wake })).toMatchObject({
      postCheckpointRecord: { outcome: { status: "rejected", reason: "meal_not_found" } },
    });
    expect(await readMealNutritionTotals(vaultRoot)).toMatchObject({ mealCount: 1, totals: { calories: { total: 100 } } });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
