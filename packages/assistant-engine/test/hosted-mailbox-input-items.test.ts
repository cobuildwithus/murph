import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readHostedMailboxAssistantInputItemDetails,
  consolidateHostedMailboxAssistantInputItemsAtPaths,
  recordHostedMailboxAssistantInputItem,
  resolveHostedMailboxAssistantInputDatabasePath,
  resolveHostedMailboxAssistantInputItemsDirectory,
  retireHostedMailboxAssistantInputItemContentAtPaths,
} from '../src/assistant/hosted-mailbox-input-items.ts'
import { withAssistantRuntimeWriteLock } from '../src/assistant/runtime-write-lock.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

function inputId(index: number): string {
  return `ain_${index.toString(16).padStart(32, '0')}`
}

async function legacy(vault: string, index: number, mailboxItemId = `legacy-${index}`): Promise<string> {
  const directory = resolveHostedMailboxAssistantInputItemsDirectory(resolveAssistantStatePaths(vault))
  await mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `${inputId(index)}.json`)
  await writeFile(filePath, JSON.stringify({
    schema: 'murph.assistant-hosted-mailbox-input-item.v1',
    schemaVersion: 1,
    value: { inputId: inputId(index), mailboxItemId },
  }))
  return filePath
}

async function inventory(vault: string, signal?: AbortSignal) {
  return withAssistantRuntimeWriteLock(vault, (paths) =>
    consolidateHostedMailboxAssistantInputItemsAtPaths(paths, signal), signal)
}

async function read(vault: string, indices: number[]) {
  return readHostedMailboxAssistantInputItemDetails({ vault, inputIds: indices.map(inputId) })
}

describe('hosted mailbox input metadata storage', () => {
  it('keeps repeated writes in one private database with no per-input files or SQLite sidecars', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-files-')
    const paths = resolveAssistantStatePaths(vaultRoot)
    for (let index = 0; index < 20; index += 1) {
      await recordHostedMailboxAssistantInputItem({
        vault: vaultRoot, inputId: inputId(index), mailboxItemId: `mailbox-${index}`,
      })
    }
    const databasePath = resolveHostedMailboxAssistantInputDatabasePath(paths)
    const files = (await readdir(path.dirname(databasePath))).filter((file) => file.startsWith('hosted-mailbox-inputs'))
    expect(files).toEqual(['hosted-mailbox-inputs.sqlite'])
    expect(existsSync(resolveHostedMailboxAssistantInputItemsDirectory(paths))).toBe(false)
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600)
    expect(await read(vaultRoot, [0, 19])).toEqual(new Map([
      [inputId(0), { inputId: inputId(0), mailboxItemId: 'mailbox-0' }],
      [inputId(19), { inputId: inputId(19), mailboxItemId: 'mailbox-19' }],
    ]))
  })

  it('reads legacy metadata without migration on the foreground path, then consolidates during maintenance', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-migration-')
    const filePath = await legacy(vaultRoot, 1)
    expect((await read(vaultRoot, [1])).get(inputId(1))?.mailboxItemId).toBe('legacy-1')
    expect(existsSync(filePath)).toBe(true)
    expect(existsSync(resolveHostedMailboxAssistantInputDatabasePath(resolveAssistantStatePaths(vaultRoot)))).toBe(false)
    expect(await inventory(vaultRoot)).toEqual({ records: [{ inputId: inputId(1) }], trusted: true })
    expect(existsSync(filePath)).toBe(false)
    expect((await read(vaultRoot, [1])).get(inputId(1))?.mailboxItemId).toBe('legacy-1')
  })

  it('preserves current metadata over a legacy duplicate left by interrupted publication', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-precedence-')
    await recordHostedMailboxAssistantInputItem({
      vault: vaultRoot, inputId: inputId(1), mailboxItemId: 'current', usageRunningLow: true,
    })
    const filePath = await legacy(vaultRoot, 1, 'obsolete')
    await inventory(vaultRoot)
    expect((await read(vaultRoot, [1])).get(inputId(1))).toEqual({
      inputId: inputId(1), mailboxItemId: 'current', usageRunningLow: true,
    })
    expect(existsSync(filePath)).toBe(false)
  })

  it('can resume consolidation after cancellation interrupts legacy file removal', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-abort-')
    const first = await legacy(vaultRoot, 1)
    const second = await legacy(vaultRoot, 2)
    const controller = new AbortController()
    const reason = new Error('foreground resumed')
    const check = controller.signal.throwIfAborted.bind(controller.signal)
    controller.signal.throwIfAborted = () => {
      if (!existsSync(first)) controller.abort(reason)
      check()
    }
    await expect(inventory(vaultRoot, controller.signal)).rejects.toBe(reason)
    expect(existsSync(second)).toBe(true)
    expect((await read(vaultRoot, [1, 2])).size).toBe(2)
    await inventory(vaultRoot)
    expect(existsSync(second)).toBe(false)
    expect((await read(vaultRoot, [1, 2])).size).toBe(2)
  })

  it('erases expired quoted content from database pages and preserves operational metadata', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-retention-')
    const quote = 'synthetic quote that must leave the saved SQLite pages'
    await recordHostedMailboxAssistantInputItem({
      vault: vaultRoot, inputId: inputId(1), mailboxItemId: 'retained-id',
      groupReactionContext: quote, groupParticipantAdded: true,
    })
    await withAssistantRuntimeWriteLock(vaultRoot, async (paths) => {
      expect(await retireHostedMailboxAssistantInputItemContentAtPaths({ inputId: inputId(1), paths })).toBe(true)
    })
    expect((await read(vaultRoot, [1])).get(inputId(1))).toEqual({
      inputId: inputId(1), mailboxItemId: 'retained-id', groupParticipantAdded: true,
    })
    expect((await readFile(resolveHostedMailboxAssistantInputDatabasePath(resolveAssistantStatePaths(vaultRoot)))).includes(Buffer.from(quote))).toBe(false)
  })

  it('fails closed on a corrupt current database instead of resurrecting legacy values', async () => {
    const { vaultRoot } = await createTempVaultContext('mailbox-metadata-corrupt-')
    await recordHostedMailboxAssistantInputItem({ vault: vaultRoot, inputId: inputId(1), mailboxItemId: 'current' })
    const legacyPath = await legacy(vaultRoot, 1, 'obsolete')
    await writeFile(resolveHostedMailboxAssistantInputDatabasePath(resolveAssistantStatePaths(vaultRoot)), 'invalid database')
    await expect(read(vaultRoot, [1])).rejects.toThrow()
    await expect(inventory(vaultRoot)).rejects.toThrow()
    expect(existsSync(legacyPath)).toBe(true)
  })
})
