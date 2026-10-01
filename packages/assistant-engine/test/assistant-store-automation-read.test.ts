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
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readAssistantAutomationState } from '../src/assistant-store.ts'
import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readFile: vi.fn(actual.readFile),
  }
})

const tempRoots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('automation state read preparation', () => {
  it('keeps cached reads bounded without walking unrelated runtime directories', async () => {
    const paths = await createPaths()
    const stored: AssistantAutomationState = {
      autoReply: [{
        channel: 'linq',
        eligibleAfter: null,
        enabledAt: '2026-05-20T12:00:00.000Z',
      }],
      updatedAt: '2026-05-20T12:00:00.000Z',
      version: 1,
    }
    await mkdir(paths.assistantStateRoot, { recursive: true, mode: 0o700 })
    await writeFile(paths.automationStatePath, JSON.stringify(stored), { mode: 0o600 })
    const cached = await readAssistantAutomationState(paths.absoluteVaultRoot)
    expect(cached).toEqual(stored)

    for (let pass = 0; pass < 3; pass += 1) {
      vi.mocked(lstat).mockClear()
      vi.mocked(readFile).mockClear()

      expect(await readAssistantAutomationState(paths.absoluteVaultRoot)).toBe(cached)

      // Retain root and lock validation, without repeating a whole runtime-tree walk.
      expect(vi.mocked(lstat).mock.calls.length).toBeLessThanOrEqual(24)
      expect(vi.mocked(readFile).mock.calls.some(([file]) => file === paths.automationStatePath))
        .toBe(false)
      const unrelatedDirectories = [paths.sessionsDirectory, paths.transcriptsDirectory,
        paths.outboxDirectory, paths.secretsDirectory, paths.stateDirectory]
      expect(vi.mocked(lstat).mock.calls.some(([file]) =>
        unrelatedDirectories.includes(String(file)),
      )).toBe(false)
    }
    expect(JSON.parse(await readFile(paths.automationStatePath, 'utf8'))).toEqual(stored)
  })

  it('initializes missing state privately without creating unrelated directories', async () => {
    const paths = await createPaths()

    const state = await readAssistantAutomationState(paths.absoluteVaultRoot)

    expect(state).toMatchObject({ version: 1, autoReply: [] })
    expect(JSON.parse(await readFile(paths.automationStatePath, 'utf8'))).toEqual(state)
    expect((await stat(paths.assistantStateRoot)).mode & 0o777).toBe(0o700)
    expect((await stat(paths.automationStatePath)).mode & 0o777).toBe(0o600)
    for (const directory of [paths.sessionsDirectory, paths.transcriptsDirectory,
      paths.outboxDirectory, paths.quarantineDirectory, paths.journalsDirectory]) {
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    }

    await chmod(paths.assistantStateRoot, 0o755)
    await expect(readAssistantAutomationState(paths.absoluteVaultRoot)).resolves.toEqual(state)
    expect((await stat(paths.assistantStateRoot)).mode & 0o777).toBe(0o700)
  })

  it('creates quarantine and recovery journal directories only when corrupt state needs them', async () => {
    const paths = await createPaths()
    await mkdir(paths.assistantStateRoot, { recursive: true, mode: 0o700 })
    await writeFile(paths.automationStatePath, '{invalid-automation', { mode: 0o600 })

    const rebuilt = await readAssistantAutomationState(paths.absoluteVaultRoot)

    expect(rebuilt).toMatchObject({ version: 1, autoReply: [] })
    expect(JSON.parse(await readFile(paths.automationStatePath, 'utf8'))).toEqual(rebuilt)
    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, { artifactKind: 'automation' })
    expect(quarantines).toHaveLength(1)
    expect(await readFile(quarantines[0]!.quarantinedPath, 'utf8')).toBe('{invalid-automation')
    expect((await stat(paths.quarantineDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(paths.journalsDirectory)).mode & 0o777).toBe(0o700)
    expect((await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)).map((event) => event.kind))
      .toEqual(expect.arrayContaining(['automation.quarantined', 'automation.recovered']))
    await expect(access(paths.sessionsDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(paths.outboxDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symlinked assistant root even after its state was cached', async () => {
    const paths = await createPaths()
    await readAssistantAutomationState(paths.absoluteVaultRoot)
    await rm(paths.assistantStateRoot, { recursive: true })
    const outside = path.join(paths.absoluteVaultRoot, 'outside-automation')
    await mkdir(outside, { mode: 0o755 })
    await symlink(outside, paths.assistantStateRoot)

    await expect(readAssistantAutomationState(paths.absoluteVaultRoot)).rejects.toThrow(/symlinks/u)

    expect(await readdir(outside)).toEqual([])
    expect((await stat(outside)).mode & 0o777).toBe(0o755)
  })
})

async function createPaths() {
  const context = await createTempVaultContext('assistant-automation-read-')
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}
