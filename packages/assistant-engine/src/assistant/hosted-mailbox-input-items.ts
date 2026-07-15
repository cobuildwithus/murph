import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAssistantStatePathHasNoSymlinks,
  ensureAssistantStateDir,
  parseVersionedJsonStateEnvelope,
  writeAssistantStateVersionedJson,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
} from '@murphai/hosted-execution/contracts'
import { isMissingFileError, normalizeNullableString } from './shared.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'

const ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA =
  'murph.assistant-hosted-mailbox-input-item.v1'
const ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA_VERSION = 1
const ASSISTANT_INPUT_EVENT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u
const ASSISTANT_HOSTED_MAILBOX_ITEM_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u

export interface HostedMailboxAssistantInputItem {
  groupParticipantAdded?: true
  groupReactionContext?: string
  inputId: string
  mailboxItemId: string
}

export interface HostedMailboxAssistantInputItemInventoryEntry {
  filePath: string
  inputId: string
}

export interface HostedMailboxAssistantInputItemInventory {
  records: HostedMailboxAssistantInputItemInventoryEntry[]
  trusted: boolean
}

export async function recordHostedMailboxAssistantInputItem(input: {
  groupParticipantAdded?: true
  groupReactionContext?: string
  inputId: string
  mailboxItemId: string
  vault: string
}): Promise<void> {
  const paths = resolveAssistantStatePaths(input.vault)
  await withAssistantRuntimeWriteLock(input.vault, async () => {
    const item = normalizeHostedMailboxAssistantInputItem(input)
    await ensureAssistantState(paths)
    await ensureAssistantStateDir(
      resolveHostedMailboxAssistantInputItemsDirectory(paths),
    )
    await writeAssistantStateVersionedJson({
      filePath: resolveHostedMailboxAssistantInputItemPath({
        inputId: item.inputId,
        paths,
      }),
      schema: ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA,
      schemaVersion: ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA_VERSION,
      value: item,
    })
  })
}

export async function readHostedMailboxAssistantInputItemDetails(input: {
  inputIds: readonly string[]
  vault: string
}): Promise<ReadonlyMap<string, HostedMailboxAssistantInputItem>> {
  if (input.inputIds.length === 0) {
    return new Map()
  }
  const paths = resolveAssistantStatePaths(input.vault)
  const items = new Map<string, HostedMailboxAssistantInputItem>()

  for (const inputId of new Set(input.inputIds)) {
    const normalizedInputId = normalizeAssistantInputEventId(inputId, 'inputId')
    const item = await readHostedMailboxAssistantInputItemAtPaths({
      inputId: normalizedInputId,
      paths,
    })
    if (item) {
      items.set(item.inputId, item)
    }
  }

  return items
}

export async function readHostedMailboxAssistantInputItemInventory(
  paths: AssistantStatePaths,
): Promise<HostedMailboxAssistantInputItemInventory> {
  const directory = resolveHostedMailboxAssistantInputItemsDirectory(paths)
  let entries: Dirent[]
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) {
      return { records: [], trusted: true }
    }
    throw error
  }

  const records: HostedMailboxAssistantInputItemInventoryEntry[] = []
  let trusted = true
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    if (!entry.isFile()) {
      trusted = false
      continue
    }

    const filePath = path.join(directory, entry.name)
    try {
      const inputId = normalizeAssistantInputEventId(
        entry.name.slice(0, -'.json'.length),
        'inputId',
      )
      await assertAssistantStatePathHasNoSymlinks(filePath)
      const item = parseHostedMailboxAssistantInputItemFile(
        JSON.parse(await readFile(filePath, 'utf8')),
      )
      if (item.inputId !== inputId) {
        trusted = false
        continue
      }
      records.push({ filePath, inputId })
    } catch {
      trusted = false
    }
  }

  return { records, trusted }
}

export function resolveHostedMailboxAssistantInputItemsDirectory(
  paths: AssistantStatePaths,
): string {
  return path.join(paths.assistantStateRoot, 'hosted-mailbox-input-items')
}

function resolveHostedMailboxAssistantInputItemPath(input: {
  inputId: string
  paths: AssistantStatePaths
}): string {
  return path.join(
    resolveHostedMailboxAssistantInputItemsDirectory(input.paths),
    `${normalizeAssistantInputEventId(input.inputId, 'inputId')}.json`,
  )
}

async function readHostedMailboxAssistantInputItemAtPaths(input: {
  inputId: string
  paths: AssistantStatePaths
}): Promise<HostedMailboxAssistantInputItem | null> {
  try {
    const filePath = resolveHostedMailboxAssistantInputItemPath(input)
    await assertAssistantStatePathHasNoSymlinks(filePath)
    const raw = await readFile(filePath, 'utf8')
    const item = parseHostedMailboxAssistantInputItemFile(JSON.parse(raw))
    return item.inputId === input.inputId ? item : null
  } catch (error) {
    if (
      isMissingFileError(error) ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    ) {
      return null
    }
    throw error
  }
}

function parseHostedMailboxAssistantInputItemFile(
  value: unknown,
): HostedMailboxAssistantInputItem {
  return parseVersionedJsonStateEnvelope(value, {
    label: 'hosted mailbox assistant input item',
    parseValue: parseHostedMailboxAssistantInputItemValue,
    schema: ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA,
    schemaVersion: ASSISTANT_HOSTED_MAILBOX_INPUT_ITEM_SCHEMA_VERSION,
  })
}

function parseHostedMailboxAssistantInputItemValue(
  value: unknown,
): HostedMailboxAssistantInputItem {
  return normalizeHostedMailboxAssistantInputItem(value)
}

function normalizeHostedMailboxAssistantInputItem(
  value: unknown,
): HostedMailboxAssistantInputItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hosted mailbox assistant input item must be an object.')
  }
  const record = value as {
    groupParticipantAdded?: unknown
    groupReactionContext?: unknown
    inputId?: unknown
    mailboxItemId?: unknown
  }
  if (
    record.groupParticipantAdded !== undefined &&
    record.groupParticipantAdded !== true
  ) {
    throw new TypeError(
      'groupParticipantAdded must be true when present.',
    )
  }
  const groupReactionContext = typeof record.groupReactionContext === 'string'
    ? normalizeNullableString(record.groupReactionContext)
    : null
  if (
    record.groupReactionContext !== undefined &&
    (typeof record.groupReactionContext !== 'string' ||
      !groupReactionContext ||
      groupReactionContext.length >
        HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS)
  ) {
    throw new TypeError('groupReactionContext must be a bounded string when present.')
  }
  return {
    ...(record.groupParticipantAdded === true
      ? { groupParticipantAdded: record.groupParticipantAdded }
      : {}),
    ...(groupReactionContext ? { groupReactionContext } : {}),
    inputId: normalizeAssistantInputEventId(record.inputId, 'inputId'),
    mailboxItemId: normalizeHostedMailboxItemId(
      record.mailboxItemId,
      'mailboxItemId',
    ),
  }
}

function normalizeAssistantInputEventId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be an assistant input event id.`)
  }
  const normalized = value.trim()
  if (ASSISTANT_INPUT_EVENT_ID_PATTERN.test(normalized)) {
    return normalized
  }

  throw new TypeError(`${fieldName} must be an assistant input event id.`)
}

function normalizeHostedMailboxItemId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a bounded opaque token.`)
  }
  const normalized = normalizeNullableString(value)
  if (
    normalized &&
    ASSISTANT_HOSTED_MAILBOX_ITEM_ID_PATTERN.test(normalized)
  ) {
    return normalized
  }

  throw new TypeError(`${fieldName} must be a bounded opaque token.`)
}
