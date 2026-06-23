import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAssistantStatePathHasNoSymlinks,
  ensureAssistantStateDir,
  parseVersionedJsonStateEnvelope,
  writeAssistantStateVersionedJson,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
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

interface HostedMailboxAssistantInputItem {
  inputId: string
  mailboxItemId: string
}

export async function recordHostedMailboxAssistantInputItem(input: {
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

export async function readHostedMailboxAssistantInputItems(input: {
  inputIds: readonly string[]
  vault: string
}): Promise<ReadonlyMap<string, string>> {
  if (input.inputIds.length === 0) {
    return new Map()
  }
  const paths = resolveAssistantStatePaths(input.vault)
  const items = new Map<string, string>()

  for (const inputId of new Set(input.inputIds)) {
    const normalizedInputId = normalizeAssistantInputEventId(inputId, 'inputId')
    const item = await readHostedMailboxAssistantInputItemAtPaths({
      inputId: normalizedInputId,
      paths,
    })
    if (item) {
      items.set(item.inputId, item.mailboxItemId)
    }
  }

  return items
}

function resolveHostedMailboxAssistantInputItemsDirectory(
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
    inputId?: unknown
    mailboxItemId?: unknown
  }
  return {
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
