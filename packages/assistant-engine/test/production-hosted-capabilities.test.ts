import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { expect, it, vi } from 'vitest'

import * as native from '../src/assistant-codex.js'
import type { AssistantPromptBlock } from '../src/assistant/system-prompt-blocks.js'
import { createCanonicalLiveFixture } from './support/canonical-live-journeys.js'
import { assertProductionHostedCapabilityParity } from './support/production-hosted-capabilities.js'

// Record the block ids behind every prompt this turn plans, so the envelope
// can name capability blocks instead of quoting their headings.
const planned = vi.hoisted(() => ({ blocks: [] as AssistantPromptBlock[][] }))
vi.mock('../src/assistant/system-prompt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/assistant/system-prompt.js')>()
  return {
    ...actual,
    buildAssistantSystemPromptResult: (...args: Parameters<typeof actual.buildAssistantSystemPromptResult>) => {
      const result = actual.buildAssistantSystemPromptResult(...args)
      planned.blocks.push([...result.layers.blocks])
      return result
    },
  }
})

// Opt-in with the live journeys: it needs the built CLI and the generated CLI
// contract, and its roster and byte envelope track production diagnostics, so
// it must not fail unrelated tool or prompt changes in the ordinary suite.
it.skipIf(process.env.MURPH_RUN_REAL_CODEX_E2E !== '1')('composes the production hosted direct capability envelope before any provider work', async () => {
  const fixture = await createCanonicalLiveFixture({ codexHome: null, env: { PATH: process.env.PATH }, model: 'gpt-6.1-sol', modelProvider: 'openai' }, 'linq', { capabilities: 'production-hosted' })
  const stop = new Error('synthetic provider boundary reached')
  let captured: Parameters<typeof native.executeCodexAppServerTurn>[0] | undefined
  const observer = vi.spyOn(native, 'executeCodexAppServerTurn').mockImplementation(async (input) => {
    captured = input
    if (process.env.MURPH_CAPABILITY_CAPTURE) await writeFile(process.env.MURPH_CAPABILITY_CAPTURE, (input.developerInstructions ?? '').replaceAll(homedir(), '<HOME_DIR>'))
    const tools = input.dynamicTools.map((tool) => `${tool.namespace}.${tool.name}`)
    const developerBytes = Buffer.byteLength(input.developerInstructions ?? '')
    process.stdout.write(`[hosted-capability-parity] ${JSON.stringify({ tools, count: tools.length, developerBytes })}\n`)
    throw stop
  })
  try {
    await expect(fixture.message('Help me plan a twenty-minute walk before lunch, without reminders.', {
      includeEarlySessionOnboarding: true, deliverResponse: true, deliveryDispatchMode: 'queue-only',
      deliveryIdempotencyKey: 'synthetic-capability-proof', turnTrigger: 'automation-auto-reply',
    })).rejects.toThrow(stop.message)
    expect(observer).toHaveBeenCalledOnce()
    expect(captured).toBeDefined()
    // The prompt that reached the provider is the planned one whose stable layers it contains.
    const sent = planned.blocks.filter((blocks) => blocks
      .filter((block) => block.layer === 'core' || block.layer === 'route')
      .every((block) => captured!.developerInstructions?.includes(block.text)))
    expect(sent.length).toBeGreaterThan(0)
    assertProductionHostedCapabilityParity({
      developerInstructions: captured!.developerInstructions,
      dynamicTools: captured!.dynamicTools,
      promptBlockIds: sent.flatMap((blocks) => blocks.map((block) => block.id)),
    })
  } finally {
    observer.mockRestore()
    await fixture.close()
  }
})
