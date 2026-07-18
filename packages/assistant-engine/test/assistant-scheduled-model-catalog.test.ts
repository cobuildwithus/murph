import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: childProcessMocks.execFile,
}))

import {
  resolveScheduledCodexModelCatalogJson,
} from '../src/assistant-codex/scheduled-model-catalog.ts'

const temporaryPaths: string[] = []

beforeEach(() => {
  childProcessMocks.execFile.mockReset()
})

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })))
})

it('bounds and cancels the effective-catalog probe with secret-safe failure', async () => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-scheduled-catalog-lifecycle-'),
  )
  temporaryPaths.push(tempRoot)
  const controller = new AbortController()
  childProcessMocks.execFile.mockImplementation((
    _command: string,
    _args: readonly string[],
    options: {
      signal?: AbortSignal
      timeout?: number
    },
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    options.signal?.addEventListener('abort', () => {
      callback(new Error('sensitive probe detail'), '')
    }, { once: true })
  })

  const result = resolveScheduledCodexModelCatalogJson({
    abortSignal: controller.signal,
    codexCommand: 'codex-fixture',
    configOverrides: ['provider.secret="must-not-leak"'],
    env: {},
    tempRoot,
  })
  await vi.waitFor(() => {
    expect(childProcessMocks.execFile).toHaveBeenCalledOnce()
  })
  const call = childProcessMocks.execFile.mock.calls[0]
  expect(call?.[0]).toBe('codex-fixture')
  expect(call?.[1]).toEqual([
    '--config',
    'provider.secret="must-not-leak"',
    'debug',
    'models',
  ])
  expect(call?.[2]).toMatchObject({
    cwd: tempRoot,
    maxBuffer: 10 * 1024 * 1024,
    signal: controller.signal,
    timeout: 60_000,
  })

  controller.abort()
  await expect(result).rejects.toMatchObject({
    code: 'ASSISTANT_CODEX_SCHEDULED_MODEL_CATALOG_INVALID',
    context: { retryable: false },
    message: 'Codex could not resolve the effective model catalog.',
  })
  await expect(result).rejects.not.toHaveProperty(
    'message',
    expect.stringContaining('must-not-leak'),
  )
})
