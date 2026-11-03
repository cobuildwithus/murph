import { createBrowserVaultReplica, readVault } from "@murphai/query/browser-replica-server";
import { getVaultLocalStatePortability } from "@murphai/runtime-state/node";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeVault, addMeal, readEvent, readOwnedEvent, upsertEvent } from "@murphai/core";
import { readCanonicalEntityFamilySource } from "@murphai/query";
import { repairLegacyMealNames } from "../src/hosted-runtime/meal-name-repair.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(names: string[]) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-repair-")); roots.push(vaultRoot);
  await initializeVault({ vaultRoot, timezone: "UTC" });
  for (const name of names) {
    const meal = await addMeal({ vaultRoot, name: "Bean tacos", note: "One plate", occurredAt: "2026-10-20T12:00:00Z",
      nutrition: { totals: { calories: 450, proteinGrams: 25 } } });
    const { event } = await readOwnedEvent({ vaultRoot, kind: "meal", ownerId: meal.mealId });
    // Seed an actual pre-policy record without weakening the production writer.
    await upsertEvent({ vaultRoot, allowSpecializedKindRewrite: true, payload: { ...event, title: name } });
  }
  return { vaultRoot, memberId: "synthetic-member", env: {}, batch: 0 };
}

it("renames canonical titles, preserves every other field, validates proposals and replays exact counts", async () => {
  expect(getVaultLocalStatePortability(".runtime/operations/meal-name-repair/v1.json")).toBe("portable");
  const input = await fixture(["turkey, rice and peas", "Greek salad", "Estimated trout meal"]);
  const before = await readCanonicalEntityFamilySource(input.vaultRoot, "event");
  const propose = vi.fn(async ({ name }: { name: string }) => name.startsWith("turkey") ? "Turkey rice bowl" : "still, an, invalid list");
  const result = await repairLegacyMealNames({ ...input, propose });
  expect(result).toMatchObject({ scanned: 3, renamed: 1, skipped: 2, invalid: 1, changed: 0, done: true, batch: 1 });
  expect(propose).toHaveBeenCalledTimes(2);
  const replica = await createBrowserVaultReplica({ vault: await readVault(input.vaultRoot), metricPoints: [], generatedAt: new Date().toISOString(), sourceBundleHash: "a".repeat(64) });
  expect(replica.meals?.days.flatMap(day => day.meals)).toContainEqual(expect.objectContaining({ name: "Turkey rice bowl", calories: 450, proteinGrams: 25 }));
  const after = await readCanonicalEntityFamilySource(input.vaultRoot, "event");
  for (const original of before) {
    const current = after.find(row => row.entityId === original.entityId)!;
    if (original.title === "turkey, rice and peas") {
      expect(current.title).toBe("Turkey rice bowl");
      expect(current.attributes.note).toBe("One plate\nturkey, rice and peas");
      const { title: _t, note: _n, lifecycle: _l, ...preserved } = current.attributes;
      const { title: _ot, note: _on, lifecycle: _ol, ...originalFields } = original.attributes;
      expect(preserved).toEqual(originalFields);
    } else expect(current).toEqual(original);
  }
  expect(await repairLegacyMealNames({ ...input, propose })).toEqual(result);
  expect(propose).toHaveBeenCalledTimes(2);
});

it("resumes bounded batches and preserves counts across a failed proposal", async () => {
  const input = await fixture(Array.from({ length: 7 }, (_, i) => `Estimated bean plate ${i}`));
  let calls = 0;
  const interrupted = vi.fn(async () => { if (++calls === 3) throw new Error("Synthetic provider unavailable"); return "Bean plate"; });
  await expect(repairLegacyMealNames({ ...input, propose: interrupted })).rejects.toThrow("Synthetic provider unavailable");
  const propose = vi.fn(async () => "Bean plate");
  const result = await repairLegacyMealNames({ ...input, propose });
  expect(result).toMatchObject({ scanned: 7, renamed: 7, skipped: 0, done: true });
  expect(propose).toHaveBeenCalledTimes(5);
  expect(await repairLegacyMealNames({ ...input, propose })).toEqual(result);
});

it("reconciles a canonical write that preceded its progress receipt without another write", async () => {
  const input = await fixture(["Estimated bean plate"]);
  const original = (await readCanonicalEntityFamilySource(input.vaultRoot, "event"))[0]!;
  const result = await repairLegacyMealNames({ ...input, propose: async () => "Bean plate" });
  const statePath = path.join(input.vaultRoot, ".runtime/operations/meal-name-repair/v1.json");
  const envelope = JSON.parse(await readFile(statePath, "utf8"));
  const current = (await readEvent({ vaultRoot: input.vaultRoot, eventId: String(original.attributes.id) })).event;
  envelope.value.results = []; envelope.value.cursor = null;
  envelope.value.counts = { ...result, scanned: 0, renamed: 0, done: false, batch: 0 };
  envelope.value.pending = { id: current.id, cursor: original.entityId, revision: current.lifecycle!.revision - 1, name: current.title, note: current.note };
  await writeFile(statePath, JSON.stringify(envelope));
  expect(await repairLegacyMealNames({ ...input, propose: async () => { throw new Error("Must not propose again"); } })).toEqual(result);
  expect((await readEvent({ vaultRoot: input.vaultRoot, eventId: current.id })).event).toEqual(current);
});

it("skips concurrent edits without overwriting their note or nutrition", async () => {
  const input = await fixture(["Estimated bean plate"]);
  const row = (await readCanonicalEntityFamilySource(input.vaultRoot, "event"))[0]!;
  const result = await repairLegacyMealNames({ ...input, propose: async () => {
    const { event } = await readEvent({ vaultRoot: input.vaultRoot, eventId: String(row.attributes.id) });
    await upsertEvent({ vaultRoot: input.vaultRoot, allowSpecializedKindRewrite: true,
      payload: { ...event, title: "Roasted bean plate", note: "Updated portion" } });
    return "Bean plate";
  } });
  expect(result).toMatchObject({ scanned: 1, renamed: 0, skipped: 1, changed: 1 });
  expect((await readEvent({ vaultRoot: input.vaultRoot, eventId: String(row.attributes.id) })).event.note).toBe("Updated portion");
});

it("records model usage with member notice delivery explicitly disabled", async () => {
  const input = await fixture(["Estimated bean plate"]);
  const recordUsage = vi.fn(async () => ({ recorded: true, usageId: "synthetic", platformAiUsageAllowedAfter: true }));
  await repairLegacyMealNames({ ...input, usageRecordPort: { recordUsage }, propose: async proposal => {
    expect(proposal.model).toBe("gpt-6.1-sol");
    expect(proposal.reasoningEffort).toBe("low");
    proposal.onProviderUsage?.({ stage: "answer", usage: {
      occurredAt: new Date().toISOString(), provider: "codex-cli", providerRequestOrdinal: 0, providerRequestOutcome: "succeeded",
      usage: { apiKeyEnv: null, baseUrl: null, cacheWriteTokens: null, cachedInputTokens: null, inputTokens: 20, outputTokens: 5,
        providerMetadataJson: null, providerName: "hosted-openai", providerRequestId: null,
        rawUsageJson: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }, reasoningTokens: null,
        requestedModel: "gpt-6.1-sol", servedModel: "gpt-6.1-sol", tokenPricingBasis: "standard", totalTokens: 25,
        turnProfileJson: null, usageExtractionSourcePath: "test.usage", usageExtractionVersion: "test-v1" },
    } });
    return "Bean plate";
  } });
  expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ featureKey: "meal_name_repair", inputTokens: 20 }), null);
});
