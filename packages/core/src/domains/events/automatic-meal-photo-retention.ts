import { type EventAttachment, eventRecordSchema } from "@murphai/contracts";
import { emitAuditRecord } from "../../audit.ts";
import { statAndHashVaultFile } from "../../raw-artifact-integrity.ts";
import { loadPhotoManifestSnapshot } from "./meal-photo-files.ts";
import { VaultError } from "../../errors.ts";
import { buildEventSpineLifecycle, eventSpineRevision, isDeletedEventSpineRecord } from "../../history/event-spine.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import { runLoadedCanonicalWrite } from "../shared.ts";
import { loadEventLedgerShardsById, selectLatestMatchedEvent, toEventLedgerFile } from "./ledger.ts";

export interface RemoveAutomaticMealPhotoInput { eventId: string; now?: Date; vaultRoot: string }
export interface RemoveAutomaticMealPhotoResult { eventId: string; ledgerFile: string; removedPhotoCount: number }

/** Compatibility command: finish photo review; the 90-day media owner deletes bytes. */
export async function removeAutomaticMealPhoto(input: RemoveAutomaticMealPhotoInput): Promise<RemoveAutomaticMealPhotoResult> {
  return withCanonicalWriteLock(input.vaultRoot, async () => {
    const latest = selectLatestMatchedEvent(await loadEventLedgerShardsById(input.vaultRoot, input.eventId));
    if (!latest || isDeletedEventSpineRecord(latest.record)) throw new VaultError("EVENT_MISSING", "Meal event was not found.");
    const record = latest.record;
    if (record.kind !== "meal") throw new VaultError("MEAL_PHOTO_RETENTION_KIND_INVALID", "Photo review requires a meal event.");
    if (record.externalRef?.system !== "meal-photo-capture" || record.externalRef.resourceType !== "photo") {
      throw new VaultError("MEAL_PHOTO_RETENTION_SOURCE_INVALID", "Photo review requires an automatic meal capture.");
    }
    const pending = (record.attachments ?? []).filter(a => a.role === "photo" && a.kind === "photo");
    if (!pending.length) return { eventId: record.id, ledgerFile: latest.relativePath, removedPhotoCount: 0 };
    for (const attachment of pending) await assertReviewPhotoIntegrity(input.vaultRoot, record.mealId, attachment);
    const now = input.now ?? new Date();
    const next = eventRecordSchema.parse({ ...record, photoReviewedAt: now.toISOString(),
      attachments: record.attachments?.map(a => pending.includes(a) ? { ...a, role: "reviewed_photo" } : a),
      lifecycle: buildEventSpineLifecycle(eventSpineRevision(record) + 1), recordedAt: now.toISOString(),
    });
    const ledgerFile = toEventLedgerFile(next.occurredAt);
    return runLoadedCanonicalWrite({ vaultRoot: input.vaultRoot, operationType: "automatic_meal_photo_remove",
      summary: "Complete automatic meal photo review", occurredAt: now,
      mutate: async ({ batch }) => {
        await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(next)}\n`);
        await emitAuditRecord({ vaultRoot: input.vaultRoot, batch, action: "event_upsert", commandName: "core.removeAutomaticMealPhoto",
          summary: "Completed automatic meal photo review; media follows meal retention.", occurredAt: now,
          files: [ledgerFile], targetIds: [record.id, record.mealId] });
        return { eventId: record.id, ledgerFile, removedPhotoCount: pending.length };
      } });
  });
}

async function assertReviewPhotoIntegrity(vaultRoot: string, mealId: string, attachment: EventAttachment) {
  const integrity = await statAndHashVaultFile(vaultRoot, attachment.relativePath);
  if (!integrity || integrity.sha256 !== attachment.sha256) {
    throw new VaultError("MEAL_PHOTO_RETENTION_PRECONDITION_FAILED", "Automatic meal photo bytes changed after canonical capture.");
  }
  const snapshot = await loadPhotoManifestSnapshot({ vaultRoot, mealId, attachmentPath: attachment.relativePath });
  const artifact = snapshot.manifest.artifacts.find(candidate => candidate.relativePath === attachment.relativePath);
  if (!artifact || artifact.byteSize !== integrity.byteSize || artifact.sha256 !== integrity.sha256) {
    throw new VaultError("MEAL_PHOTO_RETENTION_MANIFEST_INVALID", "Automatic meal photo manifest no longer matches the retained image.");
  }
}
