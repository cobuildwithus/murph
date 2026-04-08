import { readdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { ensureAssistantState } from '../store/persistence.js'
import { resolveAssistantStatePaths } from '../store.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from '../shared.js'
import {
  resolveAssistantOutboxIntentPath,
  resolveAssistantOutboxQuarantineDirectory,
} from './intents.js'
import { normalizeAssistantDeliveryError } from './retry-policy.js'

export async function readAssistantOutboxIntent(
  vault: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  return readAssistantOutboxIntentAtPath(
    resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
  )
}

export async function saveAssistantOutboxIntent(
  vault: string,
  intent: AssistantOutboxIntent,
): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantOutboxIntentSchema.parse(intent)
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, parsed.intentId),
      parsed,
    )
    return parsed
  })
}

export async function listAssistantOutboxIntentsLocal(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const entries = await readdir(paths.outboxDirectory, {
    withFileTypes: true,
  })
  const intents: AssistantOutboxIntent[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const intent = await readAssistantOutboxIntentInventoryEntry(
      vault,
      path.join(paths.outboxDirectory, entry.name),
    )
    if (intent) {
      intents.push(intent)
    }
  }

  return intents.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function findAssistantOutboxIntentByDedupeKey(
  vault: string,
  dedupeKey: string,
): Promise<AssistantOutboxIntent | null> {
  const intents = await listAssistantOutboxIntentsLocal(vault)
  return (
    intents.find((intent) => {
      if (intent.dedupeKey !== dedupeKey) {
        return false
      }

      return intent.status !== 'failed' && intent.status !== 'abandoned'
    }) ?? null
  )
}

export async function readAssistantOutboxIntentAtPath(
  intentPath: string,
): Promise<AssistantOutboxIntent | null> {
  try {
    const parsed = JSON.parse(await readFile(intentPath, 'utf8')) as unknown
    return assistantOutboxIntentSchema.parse(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

export async function readAssistantOutboxIntentInventoryEntry(
  vault: string,
  intentPath: string,
): Promise<AssistantOutboxIntent | null> {
  try {
    return await readAssistantOutboxIntentAtPath(intentPath)
  } catch (error) {
    await quarantineAssistantOutboxIntentFile({
      error,
      intentPath,
      vault,
    })
    return null
  }
}

export async function quarantineAssistantOutboxIntentFile(input: {
  error: unknown
  intentPath: string
  vault: string
}): Promise<void> {
  const paths = resolveAssistantStatePaths(input.vault)
  const quarantineDirectory = resolveAssistantOutboxQuarantineDirectory(
    paths.outboxDirectory,
  )
  const basename = path.basename(input.intentPath, '.json')
  const quarantinePath = path.join(
    quarantineDirectory,
    `${basename}.${Date.now()}.invalid.json`,
  )

  try {
    await ensureAssistantStateDirectory(quarantineDirectory)
    await rename(input.intentPath, quarantinePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    throw error
  }

  try {
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'outbox',
      kind: 'outbox.intent.quarantined',
      level: 'warn',
      message: normalizeAssistantDeliveryError(input.error).message,
    })
  } catch {}
}
