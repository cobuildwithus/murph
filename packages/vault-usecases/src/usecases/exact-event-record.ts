import type { EventRecord } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { isDefaultProjectedEventRecord } from '@murphai/query/query-visibility'

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

const storedEventReadErrorMappings = {
  EVENT_CONTRACT_INVALID: {
    code: 'contract_invalid',
    message: 'Stored event data does not match the event contract.',
    details: {
      retryable: false,
      stage: 'read',
      hint: 'Run vault validate, then repair or restore the event ledger before retrying.',
    },
    preserveDetails: false,
  },
  VAULT_INVALID_JSONL: {
    code: 'contract_invalid',
    message: 'The stored event ledger is not valid JSONL.',
    details: {
      retryable: false,
      stage: 'read',
      hint: 'Run vault validate, then repair or restore the event ledger before retrying.',
    },
    preserveDetails: false,
  },
} as const

export interface ExactEventRecord {
  event: EventRecord
  ledgerFile: string
  record: QueryCanonicalEntity
}

export function isExactEventLookup(lookup: string): boolean {
  return /^evt_[0-9A-Za-z]+$/u.test(lookup.trim())
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
      !isDefaultProjectedEventRecord({
        attributes: exact.event as unknown as Record<string, unknown>,
        kind: exact.event.kind,
      })
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
      ...storedEventReadErrorMappings,
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
      ...storedEventReadErrorMappings,
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
