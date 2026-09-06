import type { Dirent } from 'node:fs'
import { chmod, lstat, readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAssistantStatePathHasNoSymlinks,
  ensureAssistantStateDir,
  parseVersionedJsonStateEnvelope,
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  withImmediateTransaction,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
} from '@murphai/hosted-execution/contracts'
import type {
  HostedGroupRunningBitProjection,
} from '@murphai/hosted-execution/runtime-control'
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
  groupRunningBit?: HostedGroupRunningBitProjection
  inputId: string
  mailboxItemId: string
  usageRunningLow?: true
}

export interface HostedMailboxAssistantInputItemInventoryEntry {
  inputId: string
}

export interface HostedMailboxAssistantInputItemInventory {
  records: HostedMailboxAssistantInputItemInventoryEntry[]
  trusted: boolean
}

export async function recordHostedMailboxAssistantInputItem(input: {
  groupParticipantAdded?: true
  groupReactionContext?: string
  groupRunningBit?: HostedGroupRunningBitProjection
  inputId: string
  mailboxItemId: string
  usageRunningLow?: true
  vault: string
}): Promise<void> {
  const paths = resolveAssistantStatePaths(input.vault)
  await withAssistantRuntimeWriteLock(input.vault, async () => {
    const item = normalizeHostedMailboxAssistantInputItem(input)
    await ensureAssistantState(paths)
    await writeHostedMailboxAssistantInputItemAtPaths(paths, item)
  })
}

export async function readHostedMailboxAssistantInputItemDetails(input: {
  inputIds: readonly string[]
  signal?: AbortSignal | null
  vault: string
}): Promise<ReadonlyMap<string, HostedMailboxAssistantInputItem>> {
  input.signal?.throwIfAborted()
  if (input.inputIds.length === 0) {
    return new Map()
  }
  const paths = resolveAssistantStatePaths(input.vault)
  const items = new Map<string, HostedMailboxAssistantInputItem>()
  const database = await openHostedMailboxInputDatabase(paths)
  try {
    const statement = database?.prepare('SELECT item_json FROM mailbox_inputs WHERE input_id = ?')
    for (const inputId of new Set(input.inputIds)) {
      input.signal?.throwIfAborted()
      const id = normalizeAssistantInputEventId(inputId, 'inputId')
      const row = statement?.get(id)
      const item = row
        ? parseHostedMailboxInputRow(row, id)
        : await readLegacyHostedMailboxAssistantInputItemAtPaths({ inputId: id, paths, signal: input.signal })
      if (item) items.set(id, item)
    }
    input.signal?.throwIfAborted()
  } finally {
    database?.close()
  }

  return items
}

export async function retireHostedMailboxAssistantInputItemContentAtPaths(input: {
  inputId: string
  paths: AssistantStatePaths
  signal?: AbortSignal | null
}): Promise<boolean> {
  input.signal?.throwIfAborted()
  const item = await readHostedMailboxAssistantInputItemAtPaths(input)
  input.signal?.throwIfAborted()
  if (!item) {
    return false
  }
  const {
    groupReactionContext: _retiredGroupReactionContext,
    ...retired
  } = item
  await writeHostedMailboxAssistantInputItemAtPaths(input.paths, retired)
  input.signal?.throwIfAborted()
  return Boolean(item.groupReactionContext)
}

async function readLegacyHostedMailboxAssistantInputItemInventory(
  paths: AssistantStatePaths,
  signal?: AbortSignal | null,
): Promise<{
  records: Array<{ filePath: string; inputId: string; item: HostedMailboxAssistantInputItem }>
  trusted: boolean
}> {
  signal?.throwIfAborted()
  const directory = resolveHostedMailboxAssistantInputItemsDirectory(paths)
  let entries: Dirent[]
  try {
    await assertAssistantStatePathHasNoSymlinks(directory)
    signal?.throwIfAborted()
    entries = await readdir(directory, { withFileTypes: true })
    signal?.throwIfAborted()
  } catch (error) {
    signal?.throwIfAborted()
    if (isMissingFileError(error)) {
      return { records: [], trusted: true }
    }
    throw error
  }

  const records: Array<{ filePath: string; inputId: string; item: HostedMailboxAssistantInputItem }> = []
  let trusted = true
  for (const entry of entries) {
    signal?.throwIfAborted()
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
      signal?.throwIfAborted()
      const raw = await readFile(filePath, 'utf8')
      signal?.throwIfAborted()
      const item = parseHostedMailboxAssistantInputItemFile(
        JSON.parse(raw),
      )
      if (item.inputId !== inputId) {
        trusted = false
        continue
      }
      records.push({ filePath, inputId, item })
    } catch {
      signal?.throwIfAborted()
      trusted = false
    }
  }

  return { records, trusted }
}

type MailboxInputDatabase = import('node:sqlite').DatabaseSync

export function resolveHostedMailboxAssistantInputDatabasePath(paths: AssistantStatePaths): string {
  return path.join(paths.assistantStateRoot, 'state', 'hosted-mailbox-inputs.sqlite')
}

async function openHostedMailboxInputDatabase(
  paths: AssistantStatePaths,
  create = false,
): Promise<MailboxInputDatabase | null> {
  const databasePath = resolveHostedMailboxAssistantInputDatabasePath(paths)
  await assertAssistantStatePathHasNoSymlinks(databasePath)
  try {
    const stat = await lstat(databasePath)
    if (!stat.isFile()) throw new TypeError('Hosted mailbox input database must be a regular file.')
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    if (!create) return null
    await ensureAssistantStateDir(path.dirname(databasePath))
  }
  const database = openSqliteRuntimeDatabase(databasePath, {
    readOnly: !create,
    journalMode: 'DELETE',
    synchronous: 'FULL',
  })
  try {
    if (create) {
      database.exec('PRAGMA secure_delete = ON')
      applySqliteRuntimeMigrations(database, {
        storeName: 'hosted mailbox inputs',
        schemaVersion: 1,
        migrations: [{
          version: 1,
          migrate(db) {
            db.exec('CREATE TABLE mailbox_inputs (input_id TEXT PRIMARY KEY, item_json TEXT NOT NULL)')
          },
        }],
      })
      await chmod(databasePath, 0o600)
    } else if (readSqliteRuntimeUserVersion(database) !== 1) {
      throw new TypeError('Unsupported hosted mailbox input database version.')
    }
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function parseHostedMailboxInputRow(
  row: Record<string, unknown>,
  inputId: string,
): HostedMailboxAssistantInputItem {
  if (typeof row.item_json !== 'string') throw new TypeError('Invalid hosted mailbox input row.')
  const item = normalizeHostedMailboxAssistantInputItem(JSON.parse(row.item_json))
  if (item.inputId !== inputId) throw new TypeError('Hosted mailbox input row identity mismatch.')
  return item
}

async function readHostedMailboxAssistantInputItemAtPaths(input: {
  inputId: string
  paths: AssistantStatePaths
  signal?: AbortSignal | null
}): Promise<HostedMailboxAssistantInputItem | null> {
  input.signal?.throwIfAborted()
  const database = await openHostedMailboxInputDatabase(input.paths)
  try {
    const row = database?.prepare('SELECT item_json FROM mailbox_inputs WHERE input_id = ?').get(input.inputId)
    if (row) return parseHostedMailboxInputRow(row, input.inputId)
  } finally {
    database?.close()
  }
  return await readLegacyHostedMailboxAssistantInputItemAtPaths(input)
}

// The caller holds the runtime write lock. Commit current state before removing
// its legacy copy, so an interrupted conversion remains readable.
async function writeHostedMailboxAssistantInputItemAtPaths(
  paths: AssistantStatePaths,
  item: HostedMailboxAssistantInputItem,
): Promise<void> {
  const database = await openHostedMailboxInputDatabase(paths, true)
  if (!database) throw new Error('Hosted mailbox input database was not created.')
  try {
    database.prepare(`INSERT INTO mailbox_inputs (input_id, item_json) VALUES (?, ?)
      ON CONFLICT(input_id) DO UPDATE SET item_json = excluded.item_json
      WHERE item_json != excluded.item_json`).run(item.inputId, JSON.stringify(item))
  } finally {
    database.close()
  }
  await removeLegacyHostedMailboxInput(paths, item.inputId)
}

async function removeLegacyHostedMailboxInput(paths: AssistantStatePaths, inputId: string): Promise<void> {
  const filePath = resolveHostedMailboxAssistantInputItemPath({ paths, inputId })
  await assertAssistantStatePathHasNoSymlinks(filePath)
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }
}

// Runtime-residue maintenance is the sole bulk migration and retention owner.
// No foreground lookup scans the legacy directory; it falls back by exact ID.
export async function consolidateHostedMailboxAssistantInputItemsAtPaths(
  paths: AssistantStatePaths,
  signal?: AbortSignal | null,
): Promise<HostedMailboxAssistantInputItemInventory> {
  const legacy = await readLegacyHostedMailboxAssistantInputItemInventory(paths, signal)
  const database = await openHostedMailboxInputDatabase(paths, legacy.trusted && legacy.records.length > 0)
  try {
    if (database && legacy.trusted && legacy.records.length > 0) {
      withImmediateTransaction(database, () => {
        const insert = database.prepare('INSERT OR IGNORE INTO mailbox_inputs (input_id, item_json) VALUES (?, ?)')
        for (const entry of legacy.records) {
          signal?.throwIfAborted()
          insert.run(entry.inputId, JSON.stringify(entry.item))
        }
      })
    }
    const records = new Map(legacy.records.map(({ inputId }) => [inputId, { inputId }]))
    for (const row of database?.prepare('SELECT input_id, item_json FROM mailbox_inputs').iterate() ?? []) {
      signal?.throwIfAborted()
      const inputId = normalizeAssistantInputEventId(row.input_id, 'inputId')
      parseHostedMailboxInputRow(row, inputId)
      records.set(inputId, { inputId })
    }
    if (database && legacy.trusted) {
      for (const entry of legacy.records) {
        signal?.throwIfAborted()
        await removeLegacyHostedMailboxInput(paths, entry.inputId)
      }
    }
    return { records: [...records.values()], trusted: legacy.trusted }
  } finally {
    database?.close()
  }
}

export async function removeHostedMailboxAssistantInputItemsAtPaths(input: {
  inputIds: readonly string[]
  paths: AssistantStatePaths
  signal?: AbortSignal | null
}): Promise<void> {
  input.signal?.throwIfAborted()
  if (input.inputIds.length === 0) return
  const database = await openHostedMailboxInputDatabase(input.paths, true)
  try {
    // Remove legacy copies first: interruption can leave a current row, never
    // resurrect an old context after deleting the current row.
    for (const inputId of input.inputIds) {
      input.signal?.throwIfAborted()
      await removeLegacyHostedMailboxInput(input.paths, inputId)
    }
    if (database) withImmediateTransaction(database, () => {
      const remove = database.prepare('DELETE FROM mailbox_inputs WHERE input_id = ?')
      for (const inputId of input.inputIds) {
        input.signal?.throwIfAborted()
        remove.run(inputId)
      }
    })
  } finally {
    database?.close()
  }
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

async function readLegacyHostedMailboxAssistantInputItemAtPaths(input: {
  inputId: string
  paths: AssistantStatePaths
  signal?: AbortSignal | null
}): Promise<HostedMailboxAssistantInputItem | null> {
  input.signal?.throwIfAborted()
  try {
    const filePath = resolveHostedMailboxAssistantInputItemPath(input)
    await assertAssistantStatePathHasNoSymlinks(filePath)
    input.signal?.throwIfAborted()
    const raw = await readFile(filePath, 'utf8')
    input.signal?.throwIfAborted()
    const item = parseHostedMailboxAssistantInputItemFile(JSON.parse(raw))
    return item.inputId === input.inputId ? item : null
  } catch (error) {
    input.signal?.throwIfAborted()
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
    groupRunningBit?: unknown
    inputId?: unknown
    mailboxItemId?: unknown
    usageRunningLow?: unknown
  }
  if (
    record.groupParticipantAdded !== undefined &&
    record.groupParticipantAdded !== true
  ) {
    throw new TypeError(
      'groupParticipantAdded must be true when present.',
    )
  }
  if (record.usageRunningLow !== undefined && record.usageRunningLow !== true) {
    throw new TypeError('usageRunningLow must be true when present.')
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
  const groupRunningBit = record.groupRunningBit === undefined
    ? null
    : normalizeHostedGroupRunningBitProjection(record.groupRunningBit)
  return {
    ...(record.groupParticipantAdded === true
      ? { groupParticipantAdded: record.groupParticipantAdded }
      : {}),
    ...(groupReactionContext ? { groupReactionContext } : {}),
    ...(groupRunningBit ? { groupRunningBit } : {}),
    inputId: normalizeAssistantInputEventId(record.inputId, 'inputId'),
    mailboxItemId: normalizeHostedMailboxItemId(
      record.mailboxItemId,
      'mailboxItemId',
    ),
    ...(record.usageRunningLow === true ? { usageRunningLow: true } : {}),
  }
}

function normalizeHostedGroupRunningBitProjection(
  value: unknown,
): HostedGroupRunningBitProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('groupRunningBit must be an object when present.')
  }
  const record = value as Record<string, unknown>
  if (
    record.schema !== 'murph.group-sponsorship-bit.v1' ||
    typeof record.expiresAt !== 'string' ||
    !Number.isFinite(new Date(record.expiresAt).getTime()) ||
    new Date(record.expiresAt).toISOString() !== record.expiresAt ||
    typeof record.requestedBit !== 'string' ||
    [...record.requestedBit].length < 1 ||
    [...record.requestedBit].length > 240 ||
    (
      record.publicAlias !== null &&
      (
        typeof record.publicAlias !== 'string' ||
        [...record.publicAlias].length > 80
      )
    )
  ) {
    throw new TypeError('groupRunningBit is invalid.')
  }
  return {
    expiresAt: record.expiresAt,
    publicAlias: record.publicAlias,
    requestedBit: record.requestedBit,
    schema: 'murph.group-sponsorship-bit.v1',
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
