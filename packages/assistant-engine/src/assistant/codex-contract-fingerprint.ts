import { createHash } from 'node:crypto'

import { MURPH_CODEX_BASE_INSTRUCTIONS } from './codex-base-instructions.js'
import { normalizeNullableString } from './shared.js'
import { stableJsonStringify } from './stable-json-stringify.js'

export function buildAssistantCodexContractFingerprint(input: {
  developerInstructions: string | null
  dynamicTools: readonly unknown[]
  routeFingerprint: string
}): string {
  return createHash('sha256')
    .update(stableJsonStringify({
      baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
      developerInstructions: normalizeNullableString(input.developerInstructions),
      dynamicTools: input.dynamicTools,
      routeFingerprint: input.routeFingerprint,
    }))
    .digest('hex')
}
