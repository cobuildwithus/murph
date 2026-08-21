import type { EventRecord } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { toExactEventQueryRecord } from '../commands/query-record-command-helpers.js'
import type { QueryCanonicalEntity } from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { toVaultCliError } from './vault-usecase-helpers.js'

interface ExactEventCoreRuntime {
  readEvent(input: {
    vaultRoot: string
    eventId: string
  }): Promise<{
    eventId: string
    ledgerFile: string
    event: EventRecord
  }>
  readOwnedEvent(input: {
    vaultRoot: string
    kind: 'document' | 'meal'
    ownerId: string
  }): Promise<{
    eventId: string
    ledgerFile: string
    event: EventRecord
  }>
}

export interface ExactEventRecord {
  event: EventRecord
  ledgerFile: string
  record: QueryCanonicalEntity
}

export function isExactEventLookup(lookup: string): boolean {
  return /^evt_[0-9A-Za-z]+$/u.test(lookup.trim())
}

function normalizedVisibility(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

/**
 * Preserve the default query surface's visibility rule without hydrating the
 * query projection. Raw device metric observations stay available to metric
 * projections, but exact public event commands must not expose them unless
 * they were explicitly promoted to display-grade evidence.
 */
function isDefaultVisibleEvent(event: EventRecord): boolean {
  if (event.kind !== 'observation') {
    return true
  }

  const attributes = event as unknown as Record<string, unknown>
  const isMetricObservation =
    typeof attributes.metric === 'string'
    && typeof attributes.value === 'number'
    && Number.isFinite(attributes.value)
  if (!isMetricObservation) {
    return true
  }

  return normalizedVisibility(attributes.visibility) === 'display'
    || normalizedVisibility(attributes.queryVisibility) === 'default'
    || attributes.canonicalFact === true
}

export async function readExactEventRecord(input: {
  vault: string
  lookup: string
  entityLabel: string
  expectedKinds?: readonly string[]
}): Promise<ExactEventRecord> {
  const eventId = input.lookup.trim()
  if (!isExactEventLookup(eventId)) {
    throw notFound(input.entityLabel, input.lookup)
  }

  const core = await loadRuntimeModule<ExactEventCoreRuntime>('@murphai/core')
  try {
    const exact = await core.readEvent({ vaultRoot: input.vault, eventId })
    if (
      !isDefaultVisibleEvent(exact.event)
      || (
        input.expectedKinds
        && input.expectedKinds.length > 0
        && !input.expectedKinds.includes(exact.event.kind)
      )
    ) {
      throw notFound(input.entityLabel, input.lookup)
    }
    return {
      event: exact.event,
      ledgerFile: exact.ledgerFile,
      record: toExactEventQueryRecord(exact.event, exact.ledgerFile),
    }
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_MISSING: {
        code: 'not_found',
        message: `No ${input.entityLabel} found for "${input.lookup}".`,
      },
    })
  }
}

export async function readOwnedEventRecord(input: {
  vault: string
  lookup: string
  kind: 'document' | 'meal'
}): Promise<ExactEventRecord> {
  const ownerId = input.lookup.trim()
  const core = await loadRuntimeModule<ExactEventCoreRuntime>('@murphai/core')
  try {
    const exact = await core.readOwnedEvent({
      vaultRoot: input.vault,
      kind: input.kind,
      ownerId,
    })
    return {
      event: exact.event,
      ledgerFile: exact.ledgerFile,
      record: toExactEventQueryRecord(exact.event, exact.ledgerFile),
    }
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_MISSING: {
        code: 'not_found',
        message: `No ${input.kind} found for "${input.lookup}".`,
      },
      EVENT_OWNER_AMBIGUOUS: {
        code: 'conflict',
        message: `Multiple ${input.kind} records use "${input.lookup}". Resolve the duplicate canonical owners before retrying.`,
      },
    })
  }
}

function notFound(entityLabel: string, lookup: string) {
  return new VaultCliError(
    'not_found',
    `No ${entityLabel} found for "${lookup}".`,
  )
}
