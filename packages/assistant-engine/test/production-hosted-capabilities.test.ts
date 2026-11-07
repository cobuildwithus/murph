import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { expect, it, vi } from 'vitest'

import * as native from '../src/assistant-codex.js'
import { createCanonicalLiveFixture } from './support/canonical-live-journeys.js'
import { assertProductionHostedCapabilityParity } from './support/production-hosted-capabilities.js'

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
    assertProductionHostedCapabilityParity(captured!)
    for (const section of ['Native polls:', 'Lab test discovery:', 'Hosted wearable connection links',
      'Hosted groups:', 'Scheduled automation changes for this conversation are available',
      'Health Commons tools:', 'Late child results for ordinary inbound turns:',
      'Direct first-run Murph onboarding is open.']) {
      expect(captured?.developerInstructions).toContain(section)
    }
  } finally {
    observer.mockRestore()
    await fixture.close()
  }
})
