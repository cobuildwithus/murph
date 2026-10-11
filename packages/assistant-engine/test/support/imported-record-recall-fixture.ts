import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { addMeal, deterministicContractId, ID_PREFIXES } from '@murphai/core'

// Entirely synthetic processed capture. Deliberately inserted outside the
// conversation so the assistant must retrieve it rather than echo chat text.
export const SYNTHETIC_IMPORTED_MEAL = 'Buckwheat bowl with plum'

export async function seedImportedRecallMeal(vaultRoot: string, occurredAt: string): Promise<void> {
  await addMeal({
    vaultRoot,
    occurredAt,
    source: 'device',
    note: SYNTHETIC_IMPORTED_MEAL,
    externalRef: {
      system: 'meal-photo-capture', resourceType: 'photo',
      resourceId: 'capture_synthetic_recall', version: 'a'.repeat(64),
    },
  })
}

// Public repository sample, never a member image. Match the importer's canonical
// photo-only shape, including deterministic IDs and content-hash provenance.
export async function seedImportedRecallPhoto(vaultRoot: string, occurredAt: string, captureId: string): Promise<Awaited<ReturnType<typeof addMeal>>> {
  const photoPath = fileURLToPath(new URL('../../../../apps/web/public/meal-snap-2.jpg', import.meta.url))
  const version = createHash('sha256').update(await readFile(photoPath)).digest('hex')
  return addMeal({
    vaultRoot, occurredAt, photoPath, source: 'device',
    eventId: deterministicContractId(ID_PREFIXES.event, `meal-photo-capture:event:${captureId}`),
    mealId: deterministicContractId(ID_PREFIXES.meal, `meal-photo-capture:meal:${captureId}`),
    externalRef: { system: 'meal-photo-capture', resourceType: 'photo', resourceId: captureId, version },
  })
}
