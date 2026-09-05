import { describe, expect, it } from 'vitest'

import { executeAutomationDynamicTool } from '../src/assistant-codex/dynamic-tools/automation.js'

describe('automation definition inspection', () => {
  it.each([
    ['ordinary definition', 'Remind the member to report the next bodyweight squat set.', true],
    ['maximum JSON-escaped definition', '\u0001'.repeat(50_000), true],
    ['oversized adapter response', 'x'.repeat(350_000), false],
  ] as const)('preserves bounded inspection: %s', async (_label, instructions, success) => {
    const request = { action: 'inspect' as const, lookup: 'automation_synthetic' }
    const definition = {
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
      expect(result.rpcResult.contentItems[0]!.text).toBe('automation result is too large')
      return
    }
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      action: 'inspect', automationId: request.lookup,
      contextReferences: [], ...definition,
    })
  })
})
