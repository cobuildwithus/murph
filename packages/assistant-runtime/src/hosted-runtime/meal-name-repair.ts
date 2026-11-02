import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "@murphai/contracts/zod-runtime";
import { mealNameViolation, preserveMealNameDetails, mealNamesRepairResultSchema, type MealNamesRepairResult } from "@murphai/contracts";
import { readEvent, upsertEvent } from "@murphai/core";
import { readCanonicalEntityFamilySource } from "@murphai/query";
import { readVersionedJsonStateFile, writeVersionedJsonStateFile } from "@murphai/runtime-state/node";
import { proposeLegacyMealName, type ReadOnlyAssistantAskProviderUsageEvent } from "@murphai/assistant-engine/assistant-ask";
import { HOSTED_ASSISTANT_SOL_MODEL } from "@murphai/hosted-execution/assistant-model";
import { ASSISTANT_USAGE_SCHEMA, createAssistantUsageId, parseAssistantUsageRecord, resolveAssistantUsageCredentialSource } from "@murphai/hosted-execution/assistant-usage";
import { resolveHostedOperatorModelProvider } from "./codex-runtime-env.ts";
import type { HostedRuntimeUsageRecordPort } from "./platform.ts";

const pendingSchema = z.object({ id: z.string(), cursor: z.string(), revision: z.number().int(), name: z.string(), note: z.string() }).strict();
const stateSchema = z.object({
  cursor: z.string().nullable(), through: z.string(),
  counts: mealNamesRepairResultSchema,
  pending: pendingSchema.nullable(),
  results: z.array(mealNamesRepairResultSchema),
}).strict();
type State = z.infer<typeof stateSchema>;

export interface MealNameRepairInput {
  vaultRoot: string;
  batch: number;
  memberId: string;
  env: Readonly<Record<string, string>>;
  modelProvider?: string | null;
  signal?: AbortSignal;
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  userEnvKeys?: readonly string[];
  propose?: typeof proposeLegacyMealName;
}

/** Portable, versioned one-time progress. Canonical events remain the only meal owner. */
export async function repairLegacyMealNames(input: MealNameRepairInput): Promise<MealNamesRepairResult> {
  const filePath = path.join(input.vaultRoot, ".runtime/operations/meal-name-repair/v1.json");
  const envelope = { schema: "meal-name-repair", schemaVersion: 1 };
  let state: State;
  try {
    state = (await readVersionedJsonStateFile({ currentPath: filePath, ...envelope, label: "Meal name repair", parseValue: value => stateSchema.parse(value) })).value;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    state = { cursor: null, through: new Date().toISOString(), pending: null, results: [], counts: {
      kind: "meal.names.repair", version: 1, batch: 0, done: false,
      scanned: 0, renamed: 0, skipped: 0, invalid: 0, changed: 0,
    } };
  }
  const persist = () => writeVersionedJsonStateFile({ filePath, ...envelope, value: state, mode: 0o600 });
  const replay = state.results[input.batch];
  if (replay) return replay;
  if (input.batch !== state.results.length) throw new Error("Meal repair batch is out of sequence.");
  await persist();
  if (state.pending) await settlePending(input, state, persist);
  input.signal?.throwIfAborted();
  // Reuse the canonical event reader; only this bounded page is inspected or sent
  // to the model. Sorting stable IDs avoids edits changing the scan position.
  const rows = (await readCanonicalEntityFamilySource(input.vaultRoot, "event"))
    .filter(row => row.kind === "meal" && (state.cursor === null || row.entityId > state.cursor)
      && (typeof row.attributes.recordedAt !== "string" || row.attributes.recordedAt <= state.through))
    .sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
    .slice(0, 101);
  let proposed = 0;
  let processed = 0;
  for (const row of rows.slice(0, 100)) {
    input.signal?.throwIfAborted();
    if (proposed >= 5) break;
    const { event } = await readEvent({ vaultRoot: input.vaultRoot, eventId: String(row.attributes.id) });
    const oldName = event.title ?? "";
    if (mealNameViolation(oldName) === null) {
      state.counts.skipped += 1;
    } else {
      proposed += 1;
      const name = await proposeName(input, oldName, event.note ?? null);
      input.signal?.throwIfAborted();
      if (!name || mealNameViolation(name) !== null) {
        state.counts.skipped += 1;
        state.counts.invalid += 1;
      } else {
        state.pending = { id: event.id, cursor: row.entityId, revision: event.lifecycle?.revision ?? 1, name,
          note: preserveMealNameDetails(oldName, event.note) };
        await persist();
        await settlePending(input, state, persist);
        processed += 1;
        continue;
      }
    }
    state.counts.scanned += 1;
    state.cursor = row.entityId;
    processed += 1;
    await persist();
  }
  state.counts.done = processed === rows.length;
  state.counts.batch = input.batch + 1;
  state.results.push({ ...state.counts });
  await persist();
  return { ...state.counts };
}

async function settlePending(input: MealNameRepairInput, state: State, persist: () => Promise<void>): Promise<void> {
  const pending = state.pending!;
  try {
    const { event } = await readEvent({ vaultRoot: input.vaultRoot, eventId: pending.id });
    const alreadyApplied = (event.lifecycle?.revision ?? 1) === pending.revision + 1
      && event.title === pending.name && event.note === pending.note;
    if (!alreadyApplied) {
      if ((event.lifecycle?.revision ?? 1) !== pending.revision) throw Object.assign(new Error("Changed meal"), { code: "REPAIR_CHANGED" });
      await upsertEvent({ vaultRoot: input.vaultRoot, expectedRevision: pending.revision,
        allowSpecializedKindRewrite: true, payload: { ...event, title: pending.name, note: pending.note } });
    }
    state.counts.renamed += 1;
  } catch (error) {
    // Only known disappearance/revision conflicts are terminal skips. Storage,
    // fencing and infrastructure failures retain the pending write for replay.
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "REPAIR_CHANGED" && code !== "EVENT_REVISION_CONFLICT" && code !== "EVENT_MISSING") throw error;
    state.counts.skipped += 1;
    state.counts.changed += 1;
  }
  state.counts.scanned += 1;
  state.cursor = pending.cursor;
  state.pending = null;
  await persist();
}

async function proposeName(input: MealNameRepairInput, name: string, note: string | null): Promise<string | null> {
  // Overlarge evidence is skipped intact rather than silently truncating details.
  if (name.length + (note?.length ?? 0) > 16_000) return null;
  const usages: ReadOnlyAssistantAskProviderUsageEvent[] = [];
  const attemptId = randomUUID();
  try {
    return await (input.propose ?? proposeLegacyMealName)({
      name, note, env: { ...input.env }, codexHome: input.env.CODEX_HOME,
      model: HOSTED_ASSISTANT_SOL_MODEL,
      modelProvider: resolveHostedOperatorModelProvider(input.modelProvider),
      reasoningEffort: "low", abortSignal: input.signal,
      onProviderUsage: event => { usages.push(event); },
    });
  } finally {
    for (const event of usages) {
      if (!input.usageRecordPort) continue;
      const usage = event.usage.usage;
      const turnId = `turn_meal_name_repair_${attemptId}`;
      await input.usageRecordPort.recordUsage(parseAssistantUsageRecord({
        ...usage, credentialSource: resolveAssistantUsageCredentialSource({ apiKeyEnv: usage.apiKeyEnv,
          effectiveEnv: input.env, provider: event.usage.provider, userEnvKeys: input.userEnvKeys ?? [] }),
        attemptCount: 1, featureKey: "meal_name_repair", gatewayTags: [], memberId: input.memberId,
        occurredAt: event.usage.occurredAt, provider: event.usage.provider,
        providerRequestOrdinal: event.usage.providerRequestOrdinal,
        providerRequestOutcome: event.usage.providerRequestOutcome ?? "succeeded",
        reportingUserId: null, routeId: null, schema: ASSISTANT_USAGE_SCHEMA,
        sessionId: attemptId, stripeMeterSource: "murph", surface: "hosted-runtime",
        triggerKind: "meal-name-repair", turnId,
        usageId: createAssistantUsageId({ attemptCount: 1, providerRequestOrdinal: event.usage.providerRequestOrdinal, turnId }),
      }), null);
    }
  }
}
