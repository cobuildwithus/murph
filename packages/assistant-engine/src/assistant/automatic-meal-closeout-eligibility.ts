import { formatTimeZoneDateTimeParts } from '@murphai/contracts'
import { listAutomaticMealPhotoCloseoutWorkRecords } from '@murphai/vault-usecases/records'

import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION } from './managed-automations.js'

export async function canSkipManagedAutomaticMealCloseout(input: {
  automationId: string
  instructions: string
  occurrenceAt: string
  signal?: AbortSignal | null
  timeZone: string | null
  vaultRoot: string
}): Promise<boolean> {
  const managed = MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION
  if (input.automationId !== managed.automationId
    || input.instructions !== managed.instructions
    || !input.timeZone) return false
  input.signal?.throwIfAborted()
  try {
    const work = await listAutomaticMealPhotoCloseoutWorkRecords({
      limit: 1,
      occurrenceAt: input.occurrenceAt,
      to: formatTimeZoneDateTimeParts(input.occurrenceAt, input.timeZone).dayKey,
      vault: input.vaultRoot,
    })
    input.signal?.throwIfAborted()
    return work.items.length === 0
  } catch {
    input.signal?.throwIfAborted()
    // Unreadable evidence is not an empty queue. Preserve the normal recovery
    // path, including revisions whose photos were removed earlier in this run.
    return false
  }
}
