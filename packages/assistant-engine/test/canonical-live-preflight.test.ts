import { access, mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: vi.fn(actual.access), mkdtemp: vi.fn(actual.mkdtemp) }
})
vi.mock('../src/assistant/service.js', () => ({ sendAssistantMessageLocal: vi.fn() }))
vi.mock('../src/assistant-codex.js', () => ({
  stopWarmCodexAppServer: vi.fn(), waitForWarmCodexBackgroundWork: vi.fn(),
}))

import { sendAssistantMessageLocal } from '../src/assistant/service.js'
import { createCanonicalLiveFixture } from './support/canonical-live-journeys.js'

const cli = fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url))
const config = { codexHome: null, env: {}, model: 'gpt-6-sol', modelProvider: 'openai-env' }

afterEach(() => { vi.resetAllMocks() })

it('rejects a missing built CLI before allocating a fixture or starting a model', async () => {
  vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  await expect(createCanonicalLiveFixture(config)).rejects.toThrow('pnpm build:test-runtime:prepared')
  expect(access).toHaveBeenCalledWith(cli)
  expect(mkdtemp).not.toHaveBeenCalled()
  expect(sendAssistantMessageLocal).not.toHaveBeenCalled()
})

it('preserves an unexpected filesystem failure without claiming the CLI is missing', async () => {
  const failure = Object.assign(new Error('synthetic denied access'), { code: 'EACCES' })
  vi.mocked(access).mockRejectedValueOnce(failure)
  await expect(createCanonicalLiveFixture(config)).rejects.toBe(failure)
  expect(mkdtemp).not.toHaveBeenCalled()
  expect(sendAssistantMessageLocal).not.toHaveBeenCalled()
})

it('creates the canonical fixture after the CLI preflight succeeds', async () => {
  vi.mocked(access).mockResolvedValueOnce(undefined)
  const fixture = await createCanonicalLiveFixture(config)
  try {
    expect(access).toHaveBeenCalledWith(cli)
    expect(mkdtemp).toHaveBeenCalledOnce()
    expect(fixture.env.MURPH_CANONICAL_JOURNEY_CLI).toBe(cli)
    expect(await fixture.commandCount()).toBe(0)
    expect(sendAssistantMessageLocal).not.toHaveBeenCalled()
  } finally {
    await fixture.close()
  }
})
