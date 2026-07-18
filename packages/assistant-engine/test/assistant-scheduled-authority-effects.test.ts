import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { initializeVault } from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  executeScheduledKnowledgeDynamicTool,
  MURPH_SCHEDULED_KNOWLEDGE_TOOL,
  readScheduledKnowledgeDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/scheduled-knowledge.js'
import {
  executeScheduledSourceDynamicTool,
  type ScheduledSourceDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/scheduled-sources.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
} from '../src/assistant/scheduled-task-authority.js'
import {
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
} from '../src/assistant/managed-automations.js'
import { getKnowledgePage } from '../src/knowledge.js'

const tempRoots: string[] = []
const EXPECTED_UPDATED_AT = '2026-07-18T00:00:00.000Z'
const productAuthority = {
  automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  kind: 'product_notes',
  slug: 'murph-product-notes',
} as const satisfies AssistantScheduledTaskAuthority
const researchAuthority = {
  automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
  kind: 'research_ledger',
  slug: 'weekly-health-research-scout',
} as const satisfies AssistantScheduledTaskAuthority
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('scheduled authority effect owners', () => {
  it('derives one occurrence-local ledger section from a body-only request', async () => {
    const vaultRoot = await makeVaultRoot('America/Los_Angeles')
    const parsed = readScheduledKnowledgeDynamicToolRequest({
      arguments: { body: 'Kind: changelog\nItem ids: one-item' },
      tool: MURPH_SCHEDULED_KNOWLEDGE_TOOL.name,
    })
    expect(parsed).toMatchObject({ kind: 'scheduled-knowledge' })
    expect(readScheduledKnowledgeDynamicToolRequest({
      arguments: {
        action: 'append_section',
        body: 'model-selected metadata',
        heading: 'model-selected',
        position: 'append',
      },
      tool: MURPH_SCHEDULED_KNOWLEDGE_TOOL.name,
    })).toMatchObject({ kind: 'invalid-scheduled-knowledge-arguments' })
    if (!parsed || parsed.kind !== 'scheduled-knowledge') {
      throw new Error('Expected a scheduled knowledge request.')
    }

    const assertSourceCurrent = vi.fn(async () =>
      resolveAssistantScheduledTaskAuthority(productAuthority))
    const input = {
      assertSourceCurrent,
      authority: productAuthority,
      request: parsed,
      scheduledOccurrenceAt: '2026-07-18T01:00:00.000Z',
      vaultRoot,
    }
    const first = await executeScheduledKnowledgeDynamicTool(input)
    const retry = await executeScheduledKnowledgeDynamicTool(input)

    expect(readPayload(first)).toMatchObject({
      heading: '2026-07-17',
      status: 'recorded',
    })
    expect(readPayload(retry)).toMatchObject({
      heading: '2026-07-17',
      status: 'reused',
    })
    expect(assertSourceCurrent).toHaveBeenCalledTimes(2)
    const page = await getKnowledgePage({
      slug: 'murph-product-notes',
      vault: vaultRoot,
    })
    expect(page.page.body.match(/## 2026-07-17/gu)).toHaveLength(1)
    expect(page.page.body.match(/Item ids: one-item/gu)).toHaveLength(1)
  })

  it('revalidates every research lane and allows only one batch claim', async () => {
    const request = researchRequest([
      { label: 'sleep', profile: researchProfile('sleep') },
      { label: 'strength', profile: researchProfile('strength') },
    ])
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      output: { candidates: [] },
      results: [],
    }))
    const assertSourceCurrent = vi.fn()
      .mockResolvedValueOnce(resolveAssistantScheduledTaskAuthority(researchAuthority))
      .mockRejectedValueOnce(new VaultCliError(
        'scheduled_task_source_changed',
        'The source changed.',
      ))

    const missingClaim = await executeScheduledSourceDynamicTool({
      assertSourceCurrent,
      authority: researchAuthority,
      env: { EXA_API_KEY: 'test-provider-key' },
      fetchImpl,
      request,
    })
    expect(missingClaim.rpcResult.success).toBe(false)
    expect(readPayload(missingClaim)).toEqual({
      code: 'scheduled_research_batch_already_used',
    })
    expect(assertSourceCurrent).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()

    const changed = await executeScheduledSourceDynamicTool({
      assertSourceCurrent,
      authority: researchAuthority,
      claimResearchScoutBatch: () => true,
      env: { EXA_API_KEY: 'test-provider-key' },
      fetchImpl,
      request,
    })
    expect(changed.rpcResult.success).toBe(false)
    expect(readPayload(changed)).toEqual({ code: 'scheduled_task_source_changed' })
    expect(assertSourceCurrent).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    let claimed = false
    const claimResearchScoutBatch = () => {
      if (claimed) {
        return false
      }
      claimed = true
      return true
    }
    const oneLaneRequest = researchRequest([
      { label: 'sleep', profile: researchProfile('sleep') },
    ])
    const currentAssertion = vi.fn(async () =>
      resolveAssistantScheduledTaskAuthority(researchAuthority))
    const first = await executeScheduledSourceDynamicTool({
      assertSourceCurrent: currentAssertion,
      authority: researchAuthority,
      claimResearchScoutBatch,
      env: { EXA_API_KEY: 'test-provider-key' },
      fetchImpl,
      request: oneLaneRequest,
    })
    const duplicate = await executeScheduledSourceDynamicTool({
      assertSourceCurrent: currentAssertion,
      authority: researchAuthority,
      claimResearchScoutBatch,
      env: { EXA_API_KEY: 'test-provider-key' },
      fetchImpl,
      request: oneLaneRequest,
    })
    expect(first.rpcResult.success).toBe(true)
    expect(duplicate.rpcResult.success).toBe(false)
    expect(readPayload(duplicate)).toEqual({
      code: 'scheduled_research_batch_already_used',
    })
    expect(currentAssertion).toHaveBeenCalledTimes(1)

    const turnAbort = new AbortController()
    const cancellingFetch = vi.fn<typeof fetch>((_request, init) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        throw new Error('Expected the provider request signal.')
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    })
    const cancelledResult = executeScheduledSourceDynamicTool({
      abortSignal: turnAbort.signal,
      assertSourceCurrent: async () =>
        resolveAssistantScheduledTaskAuthority(researchAuthority),
      authority: researchAuthority,
      claimResearchScoutBatch: () => true,
      env: { EXA_API_KEY: 'test-provider-key' },
      fetchImpl: cancellingFetch,
      request: oneLaneRequest,
    })
    await vi.waitFor(() => expect(cancellingFetch).toHaveBeenCalledOnce())
    const providerSignal = cancellingFetch.mock.calls[0]?.[1]?.signal
    if (!(providerSignal instanceof AbortSignal)) {
      throw new Error('Expected the composed provider request signal.')
    }
    expect(providerSignal).not.toBe(turnAbort.signal)
    turnAbort.abort(new Error('scheduled turn cancelled'))
    expect(readPayload(await cancelledResult)).toEqual({
      code: 'research_exa_request_failed',
    })
    expect(providerSignal.aborted).toBe(true)
  })
})

function researchRequest(
  lanes: Extract<
    ScheduledSourceDynamicToolRequest,
    { kind: 'research-scout-batch' }
  >['request']['lanes'],
): Extract<ScheduledSourceDynamicToolRequest, { kind: 'research-scout-batch' }> {
  return {
    kind: 'research-scout-batch',
    request: {
      lanes,
      maxCandidatesPerLane: 2,
      since: '2026-07-01T00:00:00.000Z',
      until: '2026-07-18T00:00:00.000Z',
    },
  }
}

function researchProfile(topic: string) {
  return {
    activeExperiments: [],
    behaviors: [],
    biomarkers: [],
    conditionsOrConcerns: [],
    goals: [],
    supplements: [],
    topics: [topic],
  }
}

function readPayload(input: {
  rpcResult: { contentItems: Array<{ text: string }> }
}): unknown {
  const text = input.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected tool result text.')
  }
  return JSON.parse(text) as unknown
}

async function makeVaultRoot(timezone: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'murph-scheduled-effect-'))
  tempRoots.push(root)
  await initializeVault({ timezone, vaultRoot: root })
  return root
}
