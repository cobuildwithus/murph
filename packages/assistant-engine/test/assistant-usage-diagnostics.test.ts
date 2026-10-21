import { describe, expect, it, vi } from 'vitest'
import { normalizeAssistantExecutionContext } from '../src/assistant/execution-context.js'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { syntheticUsageDiagnostics } from './support/usage-diagnostics.ts'
import { executeMurphDynamicToolRequest, MURPH_USAGE_DIAGNOSTICS_TOOL, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'

function parse(argumentsValue: unknown = {}) {
  const request = readTestMurphDynamicToolRequest({ method: 'item/tool/call',
    params: { arguments: argumentsValue, namespace: 'murph', tool: 'usage_diagnostics' } })
  if (!request) throw new Error('Expected usage diagnostics request')
  return request
}
function context(overrides: Partial<AssistantHostedToolContext> = {}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false, currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [], vaultFileSendAvailable: false,
    sendVaultFile: vi.fn(),
    currentInvocationScope: () => ({ conversationScope: 'direct', origin: {
      kind: 'accepted_input', assistantInputId: 'input_synthetic', sessionId: 'session_synthetic',
    } }),
    usageDiagnostics: { read: vi.fn(async () => syntheticUsageDiagnostics()) },
    ...overrides,
  }
}
function execute(hostedToolContext: AssistantHostedToolContext, argumentsValue: unknown = {}) {
  return executeMurphDynamicToolRequest({ env: {}, fetchImpl: fetch,
    hostedToolContext, nextUsageOrdinal: () => 0, progressDelivery: null,
    request: parse(argumentsValue) })
}
describe('private usage diagnostics', () => {
  it('preserves a bound read method when normalizing hosted execution', async () => {
    const port = {
      report: syntheticUsageDiagnostics(),
      async read() { return this.report },
    }
    const normalized = normalizeAssistantExecutionContext({ hosted: {
      memberId: 'member_synthetic', userEnvKeys: [], usageDiagnostics: port,
    } })
    const read = normalized.hosted?.usageDiagnostics?.read
    expect(await read?.({})).toEqual(port.report)
    expect(normalizeAssistantExecutionContext({ hosted: {
      memberId: 'member_synthetic', userEnvKeys: [],
    } }).hosted).not.toHaveProperty('usageDiagnostics')
  })
  it('is default-off and exposes only bounded, identity-free arguments', () => {
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_USAGE_DIAGNOSTICS_TOOL)
    expect(resolveMurphDynamicTools({ usageDiagnosticsAvailable: true })).toContain(MURPH_USAGE_DIAGNOSTICS_TOOL)
    expect(parse()).toEqual({ kind: 'usage-diagnostics', request: {} })
    expect(parse({ days: 31, limit: 20 })).toEqual({ kind: 'usage-diagnostics', request: { days: 31, limit: 20 } })
  })
  it.each([{ days: 0 }, { days: 32 }, { limit: 0 }, { limit: 21 }, { days: 1.5 }, { memberId: 'other' }, { limit: '10' }])('rejects invalid selector %j', async (value) => {
    const hosted = context()
    expect(parse(value).kind).toBe('invalid-usage-diagnostics-arguments')
    expect((await execute(hosted, value)).rpcResult.success).toBe(false)
    expect(hosted.usageDiagnostics?.read).not.toHaveBeenCalled()
  })
  it('returns bounded aggregate evidence from the bound read port', async () => {
    const hosted = context()
    const result = await execute(hosted, { days: 7, limit: 10 })
    expect(hosted.usageDiagnostics?.read).toHaveBeenCalledExactlyOnceWith({ days: 7, limit: 10 })
    expect(result.rpcResult.success).toBe(true)
    expect(JSON.parse(result.rpcResult.contentItems[0]?.text ?? '')).toEqual(syntheticUsageDiagnostics())
  })
  it.each(['group', 'unverified-external', null] as const)('rejects non-private invocation scope %s', async (conversationScope) => {
    const hosted = context({ currentInvocationScope: () => ({ conversationScope, origin: {
      kind: 'accepted_input', assistantInputId: 'input_synthetic', sessionId: 'session_synthetic',
    } }) })
    const result = await execute(hosted)
    expect(result.rpcResult.success).toBe(false)
    expect(hosted.usageDiagnostics?.read).not.toHaveBeenCalled()
  })
  it('permits private scheduled usage reviews', async () => {
    const hosted = context({ currentInvocationScope: () => ({ conversationScope: 'direct', origin: {
      kind: 'automation_occurrence', automationId: 'automation_synthetic', occurrenceId: 'occurrence_synthetic', occurrenceAt: '2026-10-01T12:00:00.000Z',
    } }) })
    expect((await execute(hosted)).rpcResult.success).toBe(true)
  })
  it('fails safely without transport or authority', async () => {
    expect((await execute(context({ usageDiagnostics: null }))).rpcResult.success).toBe(false)
    const hosted = context({ currentInvocationScope: () => null })
    expect((await execute(hosted)).rpcResult.success).toBe(false)
    expect(hosted.usageDiagnostics?.read).not.toHaveBeenCalled()
  })
  it('does not expose read errors or unexpected backend content', async () => {
    for (const read of [
      vi.fn(async () => { throw new Error('sensitive backend detail') }),
      vi.fn(async () => ({ ...syntheticUsageDiagnostics(), rawOutput: 'private output' })),
    ]) {
      const result = await execute(context({ usageDiagnostics: { read } }))
      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toBe('usage diagnostics could not be read')
    }
  })
})
