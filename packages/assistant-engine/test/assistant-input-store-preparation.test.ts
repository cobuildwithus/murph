import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readAssistantInputEvent,
  resolveAssistantInputEventPath,
  resolveAssistantInputEventsDirectory,
  retireAssistantInputEventContent,
  upsertAssistantInputEvent,
  type UpsertAssistantInputEventInput,
} from '../src/assistant/input-store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const tempRoots: string[] = []
const EVENT: UpsertAssistantInputEventInput = {
  content: { text: 'Synthetic input preparation message' },
  occurredAt: '2026-05-20T12:00:00.000Z',
  sourceRef: {
    captureId: 'capture-preparation',
    kind: 'inbox-capture',
    source: 'linq',
    version: null,
  },
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('input event store preparation', () => {
  it('keeps exact input replays bounded without walking unrelated runtime directories', async () => {
    const paths = await createPaths()
    const stored = await upsertAssistantInputEvent({ event: EVENT, vault: paths.absoluteVaultRoot })

    for (let replay = 0; replay < 3; replay += 1) {
      vi.mocked(lstat).mockClear()

      expect(await upsertAssistantInputEvent({ event: EVENT, vault: paths.absoluteVaultRoot }))
        .toEqual(stored)

      // Allow input-path and lock checks without repeating a full runtime-tree walk.
      expect(vi.mocked(lstat).mock.calls.length).toBeLessThanOrEqual(40)
      expect(vi.mocked(lstat).mock.calls.some(([file]) =>
        [paths.sessionsDirectory, paths.transcriptsDirectory, paths.outboxDirectory,
          paths.secretsDirectory, paths.journalsDirectory].includes(String(file)),
      )).toBe(false)
    }
    expect(await readAssistantInputEvent({ inputId: stored.inputId, vault: paths.absoluteVaultRoot }))
      .toEqual(stored)
  })

  it('creates and retires input content privately without creating unrelated directories', async () => {
    const paths = await createPaths()
    const inputDirectory = resolveAssistantInputEventsDirectory(paths)
    const stored = await upsertAssistantInputEvent({ event: EVENT, vault: paths.absoluteVaultRoot })
    const filePath = resolveAssistantInputEventPath({ inputId: stored.inputId, paths })
    expect((await stat(paths.assistantStateRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(inputDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    await chmod(inputDirectory, 0o755)

    const retirement = await retireAssistantInputEventContent({
      inputId: stored.inputId,
      now: new Date('2026-05-21T12:00:00.000Z'),
      vault: paths.absoluteVaultRoot,
    })

    expect(retirement.retired).toBe(true)
    expect(retirement.event?.contentRetiredAt).toBe('2026-05-21T12:00:00.000Z')
    expect(await readFile(filePath, 'utf8')).not.toContain(EVENT.content!.text)
    expect(await readAssistantInputEvent({ inputId: stored.inputId, vault: paths.absoluteVaultRoot }))
      .toEqual(retirement.event)
    expect((await stat(inputDirectory)).mode & 0o777).toBe(0o700)
    for (const directory of [paths.sessionsDirectory, paths.transcriptsDirectory,
      paths.outboxDirectory, paths.journalsDirectory, paths.secretsDirectory]) {
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('rejects a symlinked input directory for both upsert and retirement', async () => {
    const paths = await createPaths()
    const stored = await upsertAssistantInputEvent({ event: EVENT, vault: paths.absoluteVaultRoot })
    const inputDirectory = resolveAssistantInputEventsDirectory(paths)
    await rm(inputDirectory, { recursive: true })
    const outside = path.join(paths.absoluteVaultRoot, 'outside-inputs')
    await mkdir(outside, { mode: 0o755 })
    await symlink(outside, inputDirectory)

    await expect(upsertAssistantInputEvent({ event: EVENT, vault: paths.absoluteVaultRoot }))
      .rejects.toThrow(/symlinks/u)
    await expect(retireAssistantInputEventContent({
      inputId: stored.inputId,
      vault: paths.absoluteVaultRoot,
    })).rejects.toThrow(/symlinks/u)

    expect(await readdir(outside)).toEqual([])
    expect((await stat(outside)).mode & 0o777).toBe(0o755)
  })
})

async function createPaths() {
  const context = await createTempVaultContext('assistant-input-preparation-')
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}
