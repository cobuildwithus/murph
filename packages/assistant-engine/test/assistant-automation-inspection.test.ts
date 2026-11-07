import { describe, expect, it } from 'vitest'

import { executeAutomationDynamicTool, MURPH_AUTOMATION_INSPECT_TOOL, MURPH_AUTOMATION_TOOL, readAutomationDynamicToolRequest } from '../src/assistant-codex/dynamic-tools/automation.js'

import { compileToolInputSchema } from './support/tool-input-schema-validation.ts'
import { resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tool-catalog.ts'

describe('lightweight automation inspection contract', () => {
  const validate = compileToolInputSchema(MURPH_AUTOMATION_INSPECT_TOOL.inputSchema)
  it.each([
    { action: 'inspect', lookup: 'automation_synthetic' },
    { action: 'inspect', lookup: 'automation_synthetic', view: 'model_review' },
    { action: 'inspect_models', lookups: ['automation_synthetic'] },
  ])('preserves canonical read semantics for $action', (arguments_) => {
    expect(validate(arguments_)).toBe(true)
    const original = readAutomationDynamicToolRequest({ tool: 'automation', arguments: arguments_ })
    expect(readAutomationDynamicToolRequest({ tool: 'automation_inspect', arguments: arguments_ })).toEqual(original)
  })
  it.each(['save', 'patch', 'reconcile', 'attach_follow_up', 'save_onboarding_first_personal_read'])('rejects mutation action %s at the runtime boundary', (action) => {
    const arguments_ = { action, lookup: 'automation_synthetic', title: 'Synthetic', instructions: 'Synthetic' }
    expect(validate(arguments_)).toBe(false)
    expect(readAutomationDynamicToolRequest({ tool: 'automation_inspect', arguments: arguments_ })?.kind).toBe('invalid-automation-arguments')
  })
  it('uses the existing availability boundary and a much smaller complete schema', () => {
    expect(resolveMurphDynamicTools({ automationAvailable: false }).some((tool) => tool.name === 'automation_inspect')).toBe(false)
    expect(resolveMurphDynamicTools({ automationAvailable: true }).some((tool) => tool.name === 'automation_inspect')).toBe(true)
    expect(MURPH_AUTOMATION_INSPECT_TOOL.deferLoading).toBe(true)
    expect(JSON.stringify(MURPH_AUTOMATION_INSPECT_TOOL).length).toBeLessThan(JSON.stringify(MURPH_AUTOMATION_TOOL).length / 4)
  })
})

describe('automation definition inspection', () => {
  it.each([
    ['ordinary definition', 'Remind the member to report the next bodyweight squat set.', true],
    ['maximum JSON-escaped definition', '\u0001'.repeat(50_000), true],
    ['oversized adapter response', 'x'.repeat(350_000), false],
  ] as const)('preserves bounded inspection: %s', async (_label, instructions, success) => {
    const request = { action: 'inspect' as const, lookup: 'automation_synthetic' }
    const definition = {
      assistantTargetOverride: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } as const,
      managed: false,
      instructions,
      title: 'Afternoon movement',
    }
    const result = await executeAutomationDynamicTool({
      automationTool: {
        async request(received) {
          expect(received).toEqual(request)
          return {
            action: 'inspect',
            automationId: request.lookup,
            contextReferences: [],
            ...definition,
            effectiveTimeZone: 'UTC',
            lookupId: 'afternoon-movement',
            occurrenceProjection: { status: 'resolved', nextOccurrenceAt: null },
            routeBinding: 'preserved',
            schedule: { kind: 'dailyLocal', localTime: '14:00', timeZone: 'UTC' },
            status: 'active',
            updatedAt: '2030-01-15T10:00:00.000Z',
          }
        },
      },
      request: { kind: 'automation', request },
    })

    expect(result.rpcResult.success).toBe(success)
    if (!success) {
      expect(result.failureDiagnostic).toStrictEqual({
        failureStage: 'result',
        failureReason: 'oversized_result',
      })
      expect(result.runtimeIssueInputs).toBeUndefined()
      expect(result.rpcResult.contentItems[0]!.text).toBe('automation result is too large')
      return
    }
    expect(result.runtimeIssueInputs).toBeUndefined()
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      action: 'inspect', automationId: request.lookup,
      contextReferences: [], ...definition,
    })
  })
})

describe('automation model patch readback', () => {
  it('returns canonical model and managed ownership after a versioned patch', async () => {
    const selected = { model: 'gpt-6-luna', reasoningEffort: 'high' } as const
    const result = await executeAutomationDynamicTool({
      automationTool: { async request() { return {
        action: 'patch', automationId: 'automation_synthetic', assistantTargetOverride: selected,
        managed: false, created: false, effectiveTimeZone: 'UTC', lookupId: 'synthetic',
        occurrenceProjection: { status: 'resolved', nextOccurrenceAt: null },
        routeBinding: 'preserved', schedule: { kind: 'dailyLocal', localTime: '14:00' },
        status: 'active', updatedAt: '2030-01-15T10:01:00.000Z',
      } } },
      request: { kind: 'automation', request: { action: 'patch', lookup: 'automation_synthetic',
        expectedUpdatedAt: '2030-01-15T10:00:00.000Z', assistantTargetOverride: selected } },
    })
    expect(result.rpcResult.success).toBe(true)
    expect(result.automationSaveReplayed).toBeUndefined()
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      assistantTargetOverride: selected, managed: false, updatedAt: '2030-01-15T10:01:00.000Z',
    })
  })
})

describe('ordinary save replay serialization', () => {
  it.each(['Stored A: remind me to stretch.', '\u0001'.repeat(50_000)])(
    'returns complete stored instructions and private replay metadata (%#)', async instructions => {
      const schedule = { kind: 'dailyLocal', localTime: '09:00', timeZone: 'UTC' } as const
      const title = 'Daily reminder'
      const result = await executeAutomationDynamicTool({
        acceptedInputIds: ['ain_host_owned'],
        request: { kind: 'automation', request: { action: 'save', title,
          instructions: 'Requested B: remind me to water the plants.', schedule } },
        automationTool: { async request(request, context) {
          expect(request).toMatchObject({ title, schedule, instructions: 'Requested B: remind me to water the plants.' })
          expect(context?.acceptedInputIds).toEqual(['ain_host_owned'])
          return { action: 'save', automationId: 'automation_stored_a', created: false,
            title, instructions, schedule, effectiveTimeZone: 'UTC', lookupId: 'stored-a',
            occurrenceProjection: { status: 'resolved', nextOccurrenceAt: '2030-01-16T09:00:00.000Z' },
            routeBinding: 'preserved', status: 'active', updatedAt: '2030-01-15T10:00:00.000Z' }
        } },
      })
      expect(result.rpcResult.success).toBe(true)
      expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({ title, instructions, created: false })
      expect(result.automationSaveReplayed).toBe(true)
      expect(result.rpcResult).not.toHaveProperty('automationSaveReplayed')
      expect(JSON.stringify(result.rpcResult)).not.toContain('automationSaveReplayed')
    },
  )
})
