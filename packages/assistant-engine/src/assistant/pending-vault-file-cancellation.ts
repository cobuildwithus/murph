import type { Dirent, Stats } from 'node:fs'
import { lstat, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  adoptAssistantStateFile,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  isAssistantGeneratedDeliveryRef,
} from './generated-delivery-files.js'
import {
  listAssistantOutboxIntents,
  saveAssistantOutboxIntentIfUnchanged,
} from './outbox.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError } from './shared.js'
import { resolveAssistantStatePaths } from './store.js'
import {
  readAssistantVaultFileMedia,
} from './vault-file-send.js'

const MAX_PENDING_GENERATED_VAULT_FILE_SENDS = 20
const VAULT_FILE_SEND_CANCELLED_CODE = 'ASSISTANT_VAULT_FILE_SEND_CANCELLED'
const OUTBOX_INTENT_ID_PATTERN = /^outbox_[0-9a-f]{32}$/u

export interface AssistantPendingGeneratedVaultFileSend {
  createdAt: string
  filename: string
  intentId: string
  sizeBytes: number
}

export interface AssistantGeneratedVaultFileSendCancellation
  extends AssistantPendingGeneratedVaultFileSend {
  fileStatus: 'deleted' | 'missing' | 'retained'
  status: 'already_cancelled' | 'cancelled'
}

export interface AssistantGeneratedVaultFileSendCancellationResult {
  results: AssistantGeneratedVaultFileSendCancellation[]
  skippedIntentIds: string[]
}

export async function listPendingAssistantGeneratedVaultFileSends(input: {
  vault: string
}): Promise<{
  pending: AssistantPendingGeneratedVaultFileSend[]
  totalCount: number
}> {
  const candidates = (await listAssistantOutboxIntents(input.vault))
    .map(readPendingGeneratedVaultFileSend)
    .filter((
      candidate,
    ): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) =>
      left.intent.createdAt.localeCompare(right.intent.createdAt)
      || left.intent.intentId.localeCompare(right.intent.intentId)
    )

  return {
    pending: candidates
      .slice(0, MAX_PENDING_GENERATED_VAULT_FILE_SENDS)
      .map(({ descriptor }) => descriptor),
    totalCount: candidates.length,
  }
}

export async function cancelPendingAssistantGeneratedVaultFileSends(input: {
  intentIds: readonly string[]
  now?: Date
  vault: string
}): Promise<AssistantGeneratedVaultFileSendCancellationResult> {
  const intentIds = requireCancellationIntentIds(input.intentIds)
  const intents = await listAssistantOutboxIntents(input.vault)
  const intentsById = new Map(
    intents.map((intent) => [intent.intentId, intent] as const),
  )
  const now = input.now ?? new Date()
  const cancelled: Array<{
    descriptor: AssistantPendingGeneratedVaultFileSend
    file: AssistantVaultFileResponseMedia
    status: AssistantGeneratedVaultFileSendCancellation['status']
  }> = []
  const skippedIntentIds: string[] = []

  for (const intentId of intentIds) {
    const intent = intentsById.get(intentId)
    const file = intent ? readGeneratedVaultFileMedia(intent) : null
    if (!intent || !file) {
      skippedIntentIds.push(intentId)
      continue
    }

    if (isCancelledGeneratedVaultFileSend(intent)) {
      cancelled.push({
        descriptor: buildPendingGeneratedVaultFileSend(intent, file),
        file,
        status: 'already_cancelled',
      })
      continue
    }
    if (intent.status !== 'awaiting_approval') {
      skippedIntentIds.push(intentId)
      continue
    }

    const cancelledIntent = assistantOutboxIntentSchema.parse({
      ...intent,
      lastError: {
        code: VAULT_FILE_SEND_CANCELLED_CODE,
        message: 'Pending generated-file delivery was cancelled.',
      },
      nextAttemptAt: null,
      status: 'abandoned',
      updatedAt: nextCancellationTimestamp(intent.updatedAt, now),
    })
    const persisted = await saveAssistantOutboxIntentIfUnchanged({
      expectedDedupeKey: intent.dedupeKey,
      expectedStatus: intent.status,
      expectedUpdatedAt: intent.updatedAt,
      intent: cancelledIntent,
      vault: input.vault,
    })
    if (!isCancelledGeneratedVaultFileSend(persisted)) {
      skippedIntentIds.push(intentId)
      continue
    }

    const persistedFile = readGeneratedVaultFileMedia(persisted) ?? file
    cancelled.push({
      descriptor: buildPendingGeneratedVaultFileSend(persisted, persistedFile),
      file: persistedFile,
      status: 'cancelled',
    })
  }

  const fileStatusByRef = new Map<
    string,
    AssistantGeneratedVaultFileSendCancellation['fileStatus']
  >()
  for (const ref of new Set(cancelled.map(({ file }) => file.ref))) {
    fileStatusByRef.set(
      ref,
      await deleteUnclaimedGeneratedVaultFile({
        ref,
        vault: input.vault,
      }),
    )
  }

  return {
    results: cancelled.map(({ descriptor, file, status }) => ({
      ...descriptor,
      fileStatus: fileStatusByRef.get(file.ref) ?? 'retained',
      status,
    })),
    skippedIntentIds,
  }
}

function readPendingGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
): {
  descriptor: AssistantPendingGeneratedVaultFileSend
  file: AssistantVaultFileResponseMedia
  intent: AssistantOutboxIntent
} | null {
  if (intent.status !== 'awaiting_approval') {
    return null
  }
  const file = readGeneratedVaultFileMedia(intent)
  return file
    ? {
        descriptor: buildPendingGeneratedVaultFileSend(intent, file),
        file,
        intent,
      }
    : null
}

function readGeneratedVaultFileMedia(
  intent: AssistantOutboxIntent,
): AssistantVaultFileResponseMedia | null {
  try {
    const file = readAssistantVaultFileMedia(intent)
    return file && isAssistantGeneratedDeliveryRef(file.ref) ? file : null
  } catch {
    return null
  }
}

function buildPendingGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
  file: AssistantVaultFileResponseMedia,
): AssistantPendingGeneratedVaultFileSend {
  return {
    createdAt: intent.createdAt,
    filename: file.filename,
    intentId: intent.intentId,
    sizeBytes: file.sizeBytes,
  }
}

function isCancelledGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.status === 'abandoned'
    && intent.lastError?.code === VAULT_FILE_SEND_CANCELLED_CODE
}

function requireCancellationIntentIds(values: readonly string[]): string[] {
  const intentIds = values.map((value) => value.trim())
  if (
    intentIds.length === 0
    || intentIds.length > MAX_PENDING_GENERATED_VAULT_FILE_SENDS
    || new Set(intentIds).size !== intentIds.length
    || intentIds.some((intentId) => !OUTBOX_INTENT_ID_PATTERN.test(intentId))
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_CANCEL_REQUEST_INVALID',
      `Pending generated-file cancellation requires 1-${MAX_PENDING_GENERATED_VAULT_FILE_SENDS} unique exact outbox intent ids.`,
    )
  }
  return intentIds
}

function nextCancellationTimestamp(current: string, now: Date): string {
  const currentMs = Date.parse(current)
  return new Date(
    Number.isFinite(currentMs)
      ? Math.max(now.getTime(), currentMs + 1)
      : now.getTime(),
  ).toISOString()
}

async function deleteUnclaimedGeneratedVaultFile(input: {
  ref: string
  vault: string
}): Promise<AssistantGeneratedVaultFileSendCancellation['fileStatus']> {
  return withAssistantRuntimeWriteLock(input.vault, async () => {
    if (!isAssistantGeneratedDeliveryRef(input.ref)) {
      return 'retained'
    }

    // Match quiescent residue cleanup's fail-closed ownership rule: one
    // unreadable or unexpected outbox entry means the ref is not proven free.
    const intents = await readTrustedOutboxIntents(input.vault)
    if (
      !intents
      || intents.some((intent) =>
        isActiveIntent(intent)
        && intent.media.some(
          (media) =>
            media.kind === 'vault_file' && media.ref === input.ref,
        )
      )
    ) {
      return 'retained'
    }

    try {
      const absolutePath = await resolveAssistantVaultPath(
        input.vault,
        input.ref,
        'file path',
      )
      await adoptAssistantStateFile(absolutePath)
      const before = await lstat(absolutePath)
      if (!isSafeGeneratedFile(before)) {
        return 'retained'
      }

      const resolvedPath = await resolveAssistantVaultPath(
        input.vault,
        input.ref,
        'file path',
      )
      const after = await lstat(resolvedPath)
      if (
        resolvedPath !== absolutePath
        || !isSafeGeneratedFile(after)
        || !sameFileSnapshot(before, after)
      ) {
        return 'retained'
      }

      await unlink(absolutePath)
      return 'deleted'
    } catch (error) {
      return isMissingFileError(error) ? 'missing' : 'retained'
    }
  })
}

async function readTrustedOutboxIntents(
  vault: string,
): Promise<AssistantOutboxIntent[] | null> {
  const { outboxDirectory } = resolveAssistantStatePaths(vault)
  let entries: Dirent[]
  try {
    entries = await readdir(outboxDirectory, { withFileTypes: true })
  } catch (error) {
    return isMissingFileError(error) ? [] : null
  }

  const intents: AssistantOutboxIntent[] = []
  for (const entry of entries) {
    const entryPath = path.join(outboxDirectory, entry.name)
    if (!entry.name.endsWith('.json')) {
      if (
        entry.name === '.quarantine'
        && await isSafeDirectory(entryPath, entry)
      ) {
        continue
      }
      return null
    }
    if (!entry.isFile()) {
      return null
    }

    try {
      const intent = assistantOutboxIntentSchema.parse(
        JSON.parse(await readFile(entryPath, 'utf8')),
      )
      intents.push(intent)
    } catch {
      return null
    }
  }
  return intents
}

async function isSafeDirectory(
  filePath: string,
  entry: Dirent,
): Promise<boolean> {
  try {
    const metadata = await lstat(filePath)
    return entry.isDirectory()
      && metadata.isDirectory()
      && !metadata.isSymbolicLink()
  } catch {
    return false
  }
}

function isActiveIntent(intent: AssistantOutboxIntent): boolean {
  return intent.status !== 'sent'
    && intent.status !== 'failed'
    && intent.status !== 'abandoned'
}

function isSafeGeneratedFile(metadata: Stats): boolean {
  return metadata.isFile()
    && !metadata.isSymbolicLink()
    && metadata.nlink === 1
    && (metadata.mode & 0o777) === 0o600
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}
