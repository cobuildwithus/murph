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

import { executeAutomationDynamicTool } from '../src/assistant-codex/dynamic-tools/automation.js'
import { listAutomations, showAutomation } from '@murphai/core'
import { getAssistantCronJob, getAssistantCronStatus } from '../src/assistant/cron.js'
import type { AssistantHostedAutomationToolRequest } from '../src/assistant/execution-context.js'
import { sendAssistantMessageLocal } from '../src/assistant/service.js'
import { createCanonicalLiveFixture, createCanonicalReminderAutomationPort, runCanonicalReminderJourney } from './support/canonical-live-journeys.js'

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


it('passes the hosted automation port to the canonical reminder creation turn', async () => {
  vi.mocked(access).mockResolvedValueOnce(undefined)
  const stop = new Error('synthetic stop after checking the hosted boundary')
  vi.mocked(sendAssistantMessageLocal).mockImplementationOnce(async (input) => {
    expect(input.executionContext?.hosted?.automationTool?.request).toBeTypeOf('function')
    throw stop
  })
  await expect(runCanonicalReminderJourney(config)).rejects.toBe(stop)
})

it('persists and cancels a reminder through the synthetic port using canonical storage and timing', async () => {
  vi.mocked(access).mockResolvedValueOnce(undefined)
  const fixture = await createCanonicalLiveFixture(config, 'linq')
  const requests: AssistantHostedAutomationToolRequest[] = []
  const port = createCanonicalReminderAutomationPort(fixture.vault, requests)
  try {
    const saved = await port.request({ action: 'save', title: 'Stretch reminder', instructions: 'Remind the member to stretch.', schedule: { kind: 'every', everyMs: 60_000 }, assistantTargetOverride: { model: 'gpt-6-luna' } })
    expect(saved.action).toBe('save')
    if (saved.action !== 'save') throw new Error('Expected saved reminder.')
    const records = await listAutomations({ vaultRoot: fixture.vault })
    expect(records.count).toBe(1)
    expect(records.items[0]).toMatchObject({ automationId: saved.automationId, assistantTargetOverride: { model: 'gpt-6-luna' }, route: { channel: 'linq', threadId: 'canonical-live-synthetic-thread', threadIsDirect: true } })
    const job = await getAssistantCronJob(fixture.vault, saved.automationId)
    expect(saved.occurrenceProjection).toEqual({ status: 'resolved', nextOccurrenceAt: job.state.nextRunAt })
    const inspected = await port.request({ action: 'inspect', lookup: saved.automationId })
    expect(inspected).toMatchObject({ action: 'inspect', status: 'active', updatedAt: saved.updatedAt })
    await expect(port.request({ action: 'patch', lookup: saved.automationId, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', status: 'archived' })).rejects.toThrow('Automation changed')
    const cancelled = await port.request({ action: 'patch', lookup: saved.automationId, expectedUpdatedAt: saved.updatedAt, status: 'archived' })
    expect(cancelled).toMatchObject({ action: 'patch', status: 'archived', occurrenceProjection: { status: 'resolved', nextOccurrenceAt: null } })
    expect((await showAutomation({ automationId: saved.automationId, vaultRoot: fixture.vault }))?.status).toBe('archived')
    expect((await getAssistantCronStatus(fixture.vault)).enabledJobs).toBe(0)
    expect(requests.map((request) => request.action)).toEqual(['save', 'inspect', 'patch', 'patch'])
  } finally { await fixture.close() }
})


it('executes the actual automation dynamic tool with the fixture port and rejects its absence', async () => {
  vi.mocked(access).mockResolvedValueOnce(undefined)
  const fixture = await createCanonicalLiveFixture(config, 'linq')
  const requests: AssistantHostedAutomationToolRequest[] = []
  const request = { kind: 'automation' as const, request: { action: 'save' as const, title: 'Stretch reminder', instructions: 'Remind the member to stretch.', schedule: { kind: 'every' as const, everyMs: 60_000 }, assistantTargetOverride: { model: 'gpt-6-luna' } } }
  try {
    const unavailable = await executeAutomationDynamicTool({ request, automationTool: null })
    expect(unavailable.rpcResult.success).toBe(false)
    expect((await listAutomations({ vaultRoot: fixture.vault })).count).toBe(0)
    const result = await executeAutomationDynamicTool({ request, automationTool: createCanonicalReminderAutomationPort(fixture.vault, requests) })
    expect(result.rpcResult.success).toBe(true)
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({ action: 'save', status: 'active', created: true })
    expect((await listAutomations({ vaultRoot: fixture.vault })).count).toBe(1)
    expect(requests).toEqual([request.request])
  } finally { await fixture.close() }
})
