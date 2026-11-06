import path from "node:path";
import type { HostedWorkspaceState } from "@murphai/hosted-execution/runtime-control";
import { readFile } from "node:fs/promises";
import { collectEventRawReferencePaths, compareEventRevisionPriority, eventRecordSchema, type EventRecord } from "@murphai/contracts";
import {
  inferRawAssetOwnerFromDirectory, listEventLedgerShardPathsInterruptible,
  visitEventLedgerShardRecordsInterruptible, statAndHashVaultFileInterruptible,
  resolveVaultPathOnDisk, withCanonicalWriteLock,
  canonicalRawArtifactMatches,
} from "@murphai/core";
import { raceHostedRuntimeCancellation } from "../hosted-workspace-restore-preparation.ts";
import { HostedRuntimeMediaWriteError, type HostedRuntimeMediaStore } from "./platform.ts";
import {
  isHostedPendingMealMedia, readHostedMediaReferenceCatalogue, writeHostedMediaReferenceCatalogue,
  type HostedMediaReference,
  hostedPhotoIntentIsCommitted, hostedPhotoNeedsRetry, hostedPhotoReferenceMayBeLive,
} from "./media-references.ts";

export const HOSTED_MEAL_MEDIA_RETRY_MS = 60 * 60_000;
export interface HostedMealMediaBudget { remaining: number; deadlineMs: number | null; uploaded: number; fullPhotosRetired: number; pending: number | null }
export function createHostedMealMediaBudget(): HostedMealMediaBudget { return { remaining: 10, deadlineMs: null, uploaded: 0, fullPhotosRetired: 0, pending: null }; }
export async function hasHostedPendingMealMedia(vaultRoot: string): Promise<boolean> {
  return (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(isHostedPendingMealMedia);
}

export async function hasHostedPhotoRetry(vaultRoot: string): Promise<boolean> {
  return (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(hostedPhotoNeedsRetry);
}

// One invocation owns this budget, including repeated retention-only slices.
// The caller supplies a durable retry CAS and the idle foreground-wake signal.
export async function runHostedMealMediaMaintenance(input: {
  budget: HostedMealMediaBudget;
  mediaStore: HostedRuntimeMediaStore;
  persistRetry: (retryAt: string, signal: AbortSignal) => Promise<void>;
  projectedDeadlineMs?: number;
  signal: AbortSignal;
  vaultRoot: string;
}): Promise<{ uploaded: number; retired: number; failed: number; pending: number; failure?: unknown }> {
  const result: { uploaded: number; retired: number; failed: number; pending: number; failure?: unknown } = { uploaded: 0, retired: 0, failed: 0, pending: input.budget.pending ?? 1 };
  const freshWindow = input.budget.deadlineMs === null;
  const deliveryDeadlineMs = input.budget.deadlineMs ?? Date.now() + 2_000;
  const projectedDeadlineMs = input.projectedDeadlineMs ?? Infinity;
  const deadlineMs = projectedDeadlineMs > Date.now() ? Math.min(deliveryDeadlineMs, projectedDeadlineMs) : deliveryDeadlineMs;
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineMs - Date.now()));
  const live = () => { signal.throwIfAborted(); if (Date.now() >= deadlineMs) { controller.abort(); signal.throwIfAborted(); } };
  const step = async <T>(work: () => Promise<T>): Promise<T> => {
    live(); const value = await raceHostedRuntimeCancellation(work(), signal); live(); return value;
  };
  try {
    const catalogue = await step(() => readHostedMediaReferenceCatalogue(input));
    const pending = catalogue.entries.filter(isHostedPendingMealMedia).sort((a, b) => a.mediaId.localeCompare(b.mediaId));
    result.pending = pending.length;
    if (!pending.length || input.budget.remaining <= 0) return result;
    input.budget.deadlineMs = deliveryDeadlineMs;
    const cursor = catalogue.mealUploadCursor ?? "";
    const eligible = pending.filter(entry => hostedPhotoIntentIsCommitted(input.vaultRoot, entry.mediaId));
    const selected = [...eligible.filter(entry => entry.mediaId > cursor), ...eligible.filter(entry => entry.mediaId <= cursor)]
      .slice(0, input.budget.remaining);
    if (!selected.length) return result;
    // A fresh head pays for discovery or a stall; partial windows do not charge a new head.
    const chargedHead = freshWindow ? selected[0] : undefined;
    if (chargedHead) {
      input.budget.remaining -= 1;
      await step(() => updateCatalogue(input.vaultRoot, chargedHead, signal, "attempt"));
    }
    if (pending.some(hostedPhotoNeedsRetry)) {
      await step(() => input.persistRetry(new Date(Date.now() + HOSTED_MEAL_MEDIA_RETRY_MS).toISOString(), signal));
    }
    const proven = await readSelectedPhotoTombstones(input.vaultRoot, selected, step);
    let holders: Map<string, EventRecord> | undefined;
    const readHolder = async (entry: HostedMediaReference) => {
      const owner = inferRawAssetOwnerFromDirectory(path.posix.dirname(entry.relativePath));
      if (!owner) throw new Error("Invalid pending photo owner.");
      if (proven.has(entry)) return undefined;
      holders ??= await step(() => readSelectedPhotoHolders(input.vaultRoot, selected, signal));
      return holders.get(owner.id);
    };
    for (const entry of [...selected.filter(entry => proven.has(entry)), ...selected.filter(entry => !proven.has(entry))]) {
      if (entry !== chargedHead) input.budget.remaining -= 1;
      try {
        const action = await settleEntry(entry, await readHolder(entry), input, signal, step);
        await step(() => updateCatalogue(input.vaultRoot, entry, signal, action));
        if (action === "delivered") result.uploaded += 1;
        else result.retired += 1;
        result.pending -= 1;
      } catch (error) {
        live();
        result.failed += 1;
        result.failure = error;
        // Owner loss is control flow, not a per-item media failure.
        if (!(error instanceof HostedRuntimeMediaWriteError)) throw error;
        if (entry !== chargedHead) await step(() => updateCatalogue(input.vaultRoot, entry, signal, "attempt"));
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    // Keep intent on time limit; an external wake is returned to its idle owner.
    input.signal.throwIfAborted();
    result.pending = Math.max(1, result.pending);
  } finally { clearTimeout(timer); input.budget.uploaded += result.uploaded; input.budget.pending = result.pending; }
  return result;
}

async function readSelectedPhotoTombstones(
  vaultRoot: string, selected: HostedMediaReference[],
  step: <T>(work: () => Promise<T>) => Promise<T>,
) {
  const proven = new Set<HostedMediaReference>();
  for (const entry of selected) {
    if (!await step(() => hostedPhotoReferenceMayBeLive(vaultRoot, entry))) proven.add(entry);
  }
  return proven;
}

async function settleEntry(
  entry: HostedMediaReference, holder: EventRecord | undefined,
  input: { vaultRoot: string; mediaStore: HostedRuntimeMediaStore }, signal: AbortSignal,
  step: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<"delivered" | "retired"> {
  // Measurement deletion retains its raw evidence. Meal retirement replaces
  // canonical identity, so an old cleanup pointer cannot authorize another PUT.
  const retained = holder && (holder.kind !== "meal" || holder.lifecycle?.state !== "deleted")
    && collectEventRawReferencePaths(holder).includes(entry.relativePath)
    && (entry.expiresAt === null || Date.parse(entry.expiresAt) > Date.now())
    && await step(() => canonicalRawArtifactMatches({ vaultRoot: input.vaultRoot, ...entry }));
  if (retained) {
    await deliver(entry, input, signal, step);
    return "delivered";
  }
  // Never promote obsolete intent. A lost/rejected finite registration still
  // permits retire; only retirement acknowledgement completes cleanup.
  try { await step(() => input.mediaStore.record!({ ...entry, expiresAt: new Date(0).toISOString() }, { signal })); }
  catch (error) { signal.throwIfAborted(); if (!(error instanceof HostedRuntimeMediaWriteError)) throw error; }
  await step(() => input.mediaStore.delete!({ mediaId: entry.mediaId }, { signal }));
  return "retired";
}

async function deliver(
  entry: HostedMediaReference,
  input: { vaultRoot: string; mediaStore: HostedRuntimeMediaStore }, signal: AbortSignal,
  step: <T>(work: () => Promise<T>) => Promise<T>,
): Promise<void> {
  const integrity = await step(() => statAndHashVaultFileInterruptible(input.vaultRoot, entry.relativePath, { shouldContinue: () => !signal.aborted }));
  if (integrity.kind !== "ok" || integrity.integrity.sha256 !== entry.sha256 || integrity.integrity.byteSize !== entry.byteSize) {
    throw new HostedRuntimeMediaWriteError({ cause: new Error("Pending photo bytes are unavailable or invalid."), retryable: false });
  }
  const resolved = await step(() => resolveVaultPathOnDisk(input.vaultRoot, entry.relativePath));
  const bytes = await step(() => readFile(resolved.absolutePath, { signal }));
  if (!input.mediaStore.record || !input.mediaStore.delete) throw new Error("Meal media lifecycle is unavailable.");
  await step(() => input.mediaStore.record!(entry, { signal }));
  await step(() => input.mediaStore.put({ ...entry, bytes }, { signal }));
}

// Selected holder IDs bound retained memory. Scan every revision before deciding
// that a holder is live or absent; a later shard can delete/replace an early hit.
async function readSelectedPhotoHolders(vaultRoot: string, entries: HostedMediaReference[], signal: AbortSignal) {
  const selected = new Set(entries.map(entry => inferRawAssetOwnerFromDirectory(path.posix.dirname(entry.relativePath))?.id));
  const latest = new Map<string, { record: EventRecord; relativePath: string }>();
  const shards = await listEventLedgerShardPathsInterruptible({ vaultRoot, signal });
  if (shards.interrupted) throw new Error("Meal holder discovery interrupted.");
  for (const relativePath of shards.relativePaths) {
    const visited = await visitEventLedgerShardRecordsInterruptible({ vaultRoot, relativePath, signal, visit(row) {
      const id = row.kind === "meal" ? row.mealId
        : row.kind === "measurement" || row.kind === "body_measurement" ? row.id : null;
      if (typeof id !== "string" || !selected.has(id)) return;
      const record = eventRecordSchema.parse(row);
      const old = latest.get(id);
      if (!old || compareEventRevisionPriority({ ...record, relativePath }, { ...old.record, relativePath: old.relativePath }) > 0) {
        latest.set(id, { record, relativePath });
      }
    } });
    if (visited.interrupted) throw new Error("Meal holder discovery interrupted.");
  }
  signal.throwIfAborted();
  return new Map([...latest].map(([id, entry]) => [id, entry.record]));
}

async function updateCatalogue(vaultRoot: string, entry: HostedMediaReference, signal: AbortSignal, action: "attempt" | "delivered" | "retired") {
  await withCanonicalWriteLock(vaultRoot, async () => {
    signal.throwIfAborted();
    const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
    signal.throwIfAborted();
    const current = catalogue.entries.find(value => value.relativePath === entry.relativePath && value.mediaId === entry.mediaId);
    if (!current) return;
    if (action === "attempt") {
      catalogue.mealUploadCursor = entry.mediaId;
      current.uploadAttempts = (current.uploadAttempts ?? 0) + 1;
    }
    else if (action === "delivered") current.pendingUpload = false;
    else catalogue.entries = catalogue.entries.filter(value => value !== current);
    await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
  });
}

export async function withHostedMealMediaRetry(workspace: HostedWorkspaceState | null, vaultRoot: string): Promise<HostedWorkspaceState | null> {
  if (!workspace || !await hasHostedPhotoRetry(vaultRoot)) return workspace;
  return mergeHostedMealMediaRetry(workspace, new Date(Date.now() + HOSTED_MEAL_MEDIA_RETRY_MS).toISOString());
}
export function mergeHostedMealMediaRetry(workspace: HostedWorkspaceState, retryAt: string): HostedWorkspaceState {
  return { ...workspace, inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt
    && Date.parse(workspace.inboxMediaRetentionWakeAt) <= Date.parse(retryAt) ? workspace.inboxMediaRetentionWakeAt : retryAt };
}


// The existing idle owner supplies lifecycle authority and the retry CAS.
export function createHostedMealMediaMaintenance(input: {
  budget: HostedMealMediaBudget;
  disabled?: boolean;
  mediaStore?: HostedRuntimeMediaStore | null;
  persistRetry: Parameters<typeof runHostedMealMediaMaintenance>[0]["persistRetry"];
  projectedWakeAt?: string | null;
}) {
  if (input.disabled || !input.mediaStore) return undefined;
  return { budget: input.budget, mediaStore: input.mediaStore, persistRetry: input.persistRetry,
    projectedDeadlineMs: input.projectedWakeAt ? Date.parse(input.projectedWakeAt) : undefined };
}

// A dirty runtime needs an idle checkpoint timer; pending media is the only dirt
// here, so arm it before the caller's checkpoint loop reads the flag.
export async function needsHostedMealMediaCheckpoint(input: {
  armIdleCheckpoint: () => void; dirty: boolean; recoveryFailed: boolean; vaultRoot: string;
}): Promise<boolean> {
  if (input.dirty || input.recoveryFailed) return input.dirty;
  if (!await hasHostedPendingMealMedia(input.vaultRoot)) return false;
  input.armIdleCheckpoint();
  return true;
}
