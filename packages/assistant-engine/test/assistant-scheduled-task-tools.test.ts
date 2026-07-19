import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'
import {
  getMemoryRecord,
  initializeVault,
  readMemoryDocument,
} from '@murphai/core'

import {
  claimMaintenanceMemoryMutation,
  executeMurphDynamicToolRequest,
  MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN,
  MURPH_MAINTENANCE_MEMORY_TOOL,
  MURPH_PRODUCT_SOURCE_TOOL,
  MURPH_RESEARCH_SCOUT_BATCH_TOOL,
  MURPH_SCHEDULED_KNOWLEDGE_TOOL,
  MURPH_SCHEDULED_READ_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
  resolveMurphScheduledDynamicTools,
  type MurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import { getKnowledgePage, upsertKnowledgePage } from '../src/knowledge.js'
import {
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
} from '../src/assistant/managed-automations.js'
import {
  resolveAssistantScheduledTaskAuthority,
  resolveAssistantScheduledTaskAuthorityFromSource,
  type AssistantScheduledAutomationSource,
  type AssistantScheduledTaskAuthority,
  type AssistantScheduledTaskSourceCurrentAssertion,
} from '../src/assistant/scheduled-task-authority.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import {
  ASSISTANT_SCHEDULED_PRODUCT_SOURCES,
} from '../src/assistant-codex/dynamic-tools/scheduled-sources.js'

const tempRoots: string[] = []
const TEST_SOURCE_UPDATED_AT = '2026-07-18T12:00:00.000Z'
const groupChallengeAuthority = {
  automationId: 'automation_group_challenge',
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'group_challenge',
  projectionScopeKey: 'steps-days.v0',
  slug: 'summer-steps',
} as const satisfies AssistantScheduledTaskAuthority
const groupNewsletterAuthority = {
  automationId: 'automation_group_newsletter',
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'group_newsletter',
} as const satisfies AssistantScheduledTaskAuthority
const genericNotificationAuthority = {
  automationId: 'automation_personal_update',
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'generic_notification',
} as const satisfies AssistantScheduledTaskAuthority
const genericGroupAuthority = {
  automationId: 'automation_group_update',
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'group_health_update',
} as const satisfies AssistantScheduledTaskAuthority
const groupNotificationAuthority = {
  automationId: 'automation_group_notification',
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'group_notification',
} as const satisfies AssistantScheduledTaskAuthority
const memoryMaintenanceAuthority = {
  automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'memory_maintenance',
} as const satisfies AssistantScheduledTaskAuthority
const researchAuthority = {
  automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'research_ledger',
  slug: 'weekly-health-research-scout',
} as const satisfies AssistantScheduledTaskAuthority
const productAuthority = {
  automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
  kind: 'product_notes',
  slug: 'murph-product-notes',
} as const satisfies AssistantScheduledTaskAuthority

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('scheduled task dynamic tools', () => {
  it('derives the exact immutable group projection binding and rejects malformed task state', () => {
    const source: AssistantScheduledAutomationSource = {
      activeUntil: '2026-07-20T23:00:00.000Z',
      assistantTargetOverride: null,
      automationId: groupChallengeAuthority.automationId,
      continuityPolicy: 'preserve',
      instructions: 'Run the bound group challenge.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'challenge-group',
        threadIsDirect: false,
      },
      schedule: { kind: 'dailyLocal', localTime: '08:30' },
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: groupChallengeAuthority.slug,
        projectionScopeKey: groupChallengeAuthority.projectionScopeKey,
      },
      slug: 'summer-steps-dispatch',
      status: 'active',
      summary: null,
      supportKind: null,
      tags: [],
      title: 'Summer steps dispatch',
      updatedAt: TEST_SOURCE_UPDATED_AT,
    }

    expect(resolveAssistantScheduledTaskAuthorityFromSource(source)).toEqual(
      groupChallengeAuthority,
    )
    expect(resolveAssistantScheduledTaskAuthorityFromSource({
      ...source,
      activeUntil: null,
    })).toEqual({ kind: 'none' })
    expect(resolveAssistantScheduledTaskAuthorityFromSource({
      ...source,
      activeUntil: 'not-an-instant',
    })).toEqual({ kind: 'none' })
    expect(resolveAssistantScheduledTaskAuthorityFromSource({
      ...source,
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: groupChallengeAuthority.slug,
        projectionScopeKey: 'group-email.v0',
      },
    })).toEqual({ kind: 'none' })
    expect(resolveAssistantScheduledTaskAuthorityFromSource({
      ...source,
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: groupChallengeAuthority.slug,
        projectionScopeKey: 'model-controlled.v0',
      },
    })).toEqual({ kind: 'none' })
    expect(resolveAssistantScheduledTaskAuthority({
      ...groupChallengeAuthority,
      projectionScopeKey: 'profile-name.v0',
    })).toEqual({ kind: 'none' })
  })

  it('keeps every scheduled-only tool out of the interactive resolver', () => {
    const defaults = resolveMurphDynamicTools({})
    expect(defaults).not.toContain(MURPH_SCHEDULED_READ_TOOL)
    expect(defaults).not.toContain(MURPH_SCHEDULED_KNOWLEDGE_TOOL)
    expect(defaults).not.toContain(MURPH_RESEARCH_SCOUT_BATCH_TOOL)
    expect(defaults).not.toContain(MURPH_PRODUCT_SOURCE_TOOL)
    expect(defaults).not.toContain(MURPH_MAINTENANCE_MEMORY_TOOL)
  })

  it('maps each trusted task descriptor to its exact unattended tool set', () => {
    const namesFor = (
      taskAuthority: AssistantScheduledTaskAuthority,
      deliveryToolsAvailable = true,
    ) => resolveMurphScheduledDynamicTools({
      deliveryToolsAvailable,
      taskAuthority,
    }).map((tool) => tool.name)

    expect(namesFor({ kind: 'none' })).toEqual([])
    for (const authority of [
      {
        automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
        expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
        kind: 'managed_knowledge_ledger',
        slug: 'weekly-health-insights',
      },
      {
        automationId: MURPH_WEEKLY_IMPROVEMENT_COACH_AUTOMATION_ID,
        expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
        kind: 'managed_knowledge_ledger',
        slug: 'improvement-opportunities',
      },
    ] as const satisfies readonly AssistantScheduledTaskAuthority[]) {
      expect(namesFor(authority)).toEqual([
        'scheduled_read',
        'scheduled_knowledge',
      ])
    }
    expect(namesFor(researchAuthority)).toEqual([
      'scheduled_read',
      'scheduled_knowledge',
      'research_scout_batch',
    ])
    expect(namesFor(productAuthority)).toEqual([
      'scheduled_read',
      'scheduled_knowledge',
      'product_source',
    ])
    expect(namesFor(genericGroupAuthority)).toEqual(['scheduled_read'])
    expect(namesFor(groupChallengeAuthority)).toEqual([
      'scheduled_read',
      'generate_scheduled_image',
    ])
    expect(namesFor(memoryMaintenanceAuthority, false)).toEqual([
      'scheduled_read',
      'maintenance_memory',
    ])
    expect(resolveMurphScheduledDynamicTools({
      deliveryToolsAvailable: true,
      newsletterAvailable: true,
      taskAuthority: groupChallengeAuthority,
      voiceMemoGenerationAvailable: true,
    }).map((tool) => tool.name)).toEqual([
      'scheduled_read',
      'generate_scheduled_image',
      'generate_scheduled_voice_memo',
      'generate_scheduled_song',
    ])
    expect(resolveMurphScheduledDynamicTools({
      deliveryToolsAvailable: true,
      newsletterAvailable: true,
      taskAuthority: groupNewsletterAuthority,
    }).map((tool) => tool.name)).toEqual([
      'newsletter',
      'scheduled_read',
    ])
    expect(namesFor({
      automationId: 'forged-id',
      expectedUpdatedAt: TEST_SOURCE_UPDATED_AT,
      kind: 'managed_knowledge_ledger',
      slug: 'weekly-health-insights',
    })).toEqual([])
  })

  it('accepts only the narrow scheduled action schemas', () => {
    for (const tool of [MURPH_SCHEDULED_KNOWLEDGE_TOOL]) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"slug"')
    }

    expect(readToolRequest('scheduled_knowledge', {
      body: 'Prepared dispatch details.',
    })).toMatchObject({ kind: 'scheduled-knowledge' })
    expect(readToolRequest('scheduled_knowledge', {
      action: 'append_section',
      body: 'Prepared dispatch details.',
      heading: '2026-07-18',
    })).toMatchObject({ kind: 'invalid-scheduled-knowledge-arguments' })
    expect(readToolRequest('scheduled_knowledge', {
      body: 'Prepared dispatch details.',
      path: '.runtime/control.json',
    })).toMatchObject({ kind: 'invalid-scheduled-knowledge-arguments' })
    expect(readToolRequest('scheduled_knowledge', {
      action: 'upsert',
      body: 'Model-controlled replacement.',
    })).toMatchObject({ kind: 'invalid-scheduled-knowledge-arguments' })
    expect(readToolRequest('scheduled_knowledge', {
      action: 'archive_challenge',
    })).toMatchObject({ kind: 'invalid-scheduled-knowledge-arguments' })
    expect(readToolRequest('maintenance_memory', {
      action: 'forget',
      memoryId: 'mem_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })).toMatchObject({ kind: 'invalid-maintenance-memory-arguments' })

    expect(readToolRequest('product_source', {
      source: 'changelog',
      url: 'https://example.test/private',
    })).toMatchObject({ kind: 'invalid-product-source-arguments' })
    expect(readToolRequest('research_scout_batch', {
      lanes: [{ label: 'sleep', profile: { topics: ['sleep'] } }],
      maxCandidatesPerLane: 2,
      since: '2026-07-01T00:00:00.000Z',
      token: 'model-controlled',
      until: '2026-07-18T00:00:00.000Z',
    })).toMatchObject({ kind: 'invalid-research-scout-batch-arguments' })
  })

  it('binds scheduled reads to a real scheduled turn and group shares to group authority', async () => {
    const vaultRoot = await makeVaultRoot()
    const groupShared = requireRequest(readToolRequest('scheduled_read', {
      action: 'group_shared',
    }))

    const interactiveAttempt = await executeTool(groupShared, { vaultRoot })
    expect(interactiveAttempt.rpcResult.success).toBe(false)
    expect(readResultPayload(interactiveAttempt)).toEqual({
      code: 'scheduled_read_action_unauthorized',
    })

    const wrongTask = await executeTool(groupShared, {
      authority: researchAuthority,
      vaultRoot,
    })
    expect(wrongTask.rpcResult.success).toBe(false)
    expect(readResultPayload(wrongTask)).toEqual({
      code: 'scheduled_read_action_unauthorized',
    })
    const personalTask = await executeTool(groupShared, {
      authority: genericNotificationAuthority,
      vaultRoot,
    })
    expect(personalTask.rpcResult.success).toBe(false)
    expect(readResultPayload(personalTask)).toEqual({
      code: 'scheduled_read_action_unauthorized',
    })

    const sourceCurrentAssertion = vi.fn<AssistantScheduledTaskSourceCurrentAssertion>(
      async (authority) => {
        const resolved = resolveAssistantScheduledTaskAuthority(authority)
        if (resolved.kind === 'none') {
          throw new Error('Test authority is invalid.')
        }
        return resolved
      },
    )
    const missingRouteOwner = await executeTool(groupShared, {
      authority: genericGroupAuthority,
      sourceCurrentAssertion,
      vaultRoot,
    })
    expect(missingRouteOwner.rpcResult.success).toBe(false)
    expect(readResultPayload(missingRouteOwner)).toEqual({
      code: 'scheduled_group_route_unavailable',
    })

    const assertScheduledGroupRouteCurrent = vi.fn(async () => undefined)
    const hostedGroupRead = await executeTool(groupShared, {
      authority: genericGroupAuthority,
      hostedToolContext: createScheduledGroupToolContext(
        assertScheduledGroupRouteCurrent,
      ),
      sourceCurrentAssertion,
      vaultRoot,
    })
    expect(hostedGroupRead.rpcResult.success).toBe(true)
    expect(assertScheduledGroupRouteCurrent).toHaveBeenCalledTimes(1)

    const groupRead = await executeTool(groupShared, {
      authority: groupChallengeAuthority,
      hostedToolContext: createScheduledGroupToolContext(
        assertScheduledGroupRouteCurrent,
      ),
      sourceCurrentAssertion,
      vaultRoot,
    })
    expect(groupRead.rpcResult.success).toBe(true)
    expect(readResultPayload(groupRead)).toMatchObject({
      action: 'group_shared',
      memberCount: 0,
      members: [],
      status: 'empty',
    })
    expect(sourceCurrentAssertion).toHaveBeenCalledTimes(3)
    expect(assertScheduledGroupRouteCurrent).toHaveBeenCalledTimes(2)

    const knowledgeRead = requireRequest(readToolRequest('scheduled_read', {
      action: 'knowledge_list',
      limit: 1,
    }))
    const maintenanceRead = await executeTool(knowledgeRead, {
      authority: memoryMaintenanceAuthority,
      vaultRoot,
    })
    expect(maintenanceRead.rpcResult.success).toBe(false)
    expect(readResultPayload(maintenanceRead)).toEqual({
      code: 'scheduled_read_action_unauthorized',
    })

    for (const slug of ['groupchat-comedy', 'music-generation']) {
      const skillRead = requireRequest(readToolRequest('scheduled_read', {
        action: 'skill_get',
        slug,
      }))
      const skillResult = await executeTool(skillRead, {
        authority: groupChallengeAuthority,
        hostedToolContext: createScheduledGroupToolContext(
          assertScheduledGroupRouteCurrent,
        ),
      })
      expect(skillResult.rpcResult.success).toBe(true)
      expect(readResultPayload(skillResult)).toMatchObject({
        action: 'skill_get',
        slug,
      })
    }
  })

  it('revalidates the current route for every typed group scheduled read', async () => {
    const vaultRoot = await makeVaultRoot()
    const cases = [
      {
        authority: groupNotificationAuthority,
        request: requireRequest(readToolRequest('scheduled_read', {
          action: 'knowledge_list',
          limit: 1,
        })),
      },
      {
        authority: genericGroupAuthority,
        request: requireRequest(readToolRequest('scheduled_read', {
          action: 'knowledge_list',
          limit: 1,
        })),
      },
      {
        authority: groupChallengeAuthority,
        request: requireRequest(readToolRequest('scheduled_read', {
          action: 'skill_get',
          slug: 'group-chat',
        })),
      },
    ] as const

    for (const testCase of cases) {
      const sourceCurrentAssertion = vi.fn(async () => testCase.authority)
      const withoutRoute = await executeTool(testCase.request, {
        authority: testCase.authority,
        sourceCurrentAssertion,
        vaultRoot,
      })
      expect(readResultPayload(withoutRoute)).toEqual({
        code: 'scheduled_group_route_unavailable',
      })

      const assertScheduledGroupRouteCurrent = vi.fn(async () => undefined)
      const withRoute = await executeTool(testCase.request, {
        authority: testCase.authority,
        hostedToolContext: createScheduledGroupToolContext(
          assertScheduledGroupRouteCurrent,
        ),
        sourceCurrentAssertion,
        vaultRoot,
      })
      expect(withRoute.rpcResult.success).toBe(true)
      expect(sourceCurrentAssertion).toHaveBeenCalledTimes(2)
      expect(assertScheduledGroupRouteCurrent).toHaveBeenCalledOnce()
    }
  })

  it('writes one occurrence-local scheduled knowledge section and reuses it on retry', async () => {
    const vaultRoot = await makeVaultRoot()
    await upsertKnowledgePage({
      body: '# Murph product notes',
      pageType: 'note',
      slug: 'murph-product-notes',
      status: 'active',
      title: 'Murph product notes',
      vault: vaultRoot,
    })

    const append = requireRequest(readToolRequest('scheduled_knowledge', {
      body: 'Selected item ids: connect-wearables.',
    }))
    const first = await executeTool(append, {
      authority: productAuthority,
      scheduledOccurrenceAt: '2026-07-18T13:00:00.000Z',
      vaultRoot,
    })
    expect(first.rpcResult.success).toBe(true)
    expect(readResultPayload(first)).toMatchObject({
      heading: '2026-07-18',
      status: 'recorded',
    })
    const duplicate = await executeTool(append, {
      authority: productAuthority,
      scheduledOccurrenceAt: '2026-07-18T13:00:00.000Z',
      vaultRoot,
    })
    expect(duplicate.rpcResult.success).toBe(true)
    expect(readResultPayload(duplicate)).toMatchObject({
      heading: '2026-07-18',
      status: 'reused',
    })
    const page = (await getKnowledgePage({
      slug: 'murph-product-notes',
      vault: vaultRoot,
    })).page
    expect(page.body.match(/## 2026-07-18/gu)).toHaveLength(1)
    expect(page.body.match(/Selected item ids: connect-wearables\./gu)).toHaveLength(1)
  })

  it('limits maintenance memory to upsert and update', async () => {
    const vaultRoot = await makeVaultRoot()
    const upsert = requireRequest(readToolRequest('maintenance_memory', {
      action: 'upsert',
      section: 'Context',
      text: 'Prefers concise weekly summaries.',
    }))
    const created = await executeTool(upsert, {
      authority: memoryMaintenanceAuthority,
      vaultRoot,
    })
    const createdPayload = readResultPayload(created) as { memoryId: string }
    expect(created.rpcResult.success).toBe(true)

    const update = requireRequest(readToolRequest('maintenance_memory', {
      action: 'update',
      memoryId: createdPayload.memoryId,
      text: 'Prefers concise scheduled summaries.',
    }))
    expect((await executeTool(update, {
      authority: memoryMaintenanceAuthority,
      vaultRoot,
    })).rpcResult.success).toBe(true)
    expect(await getMemoryRecord(vaultRoot, createdPayload.memoryId)).toMatchObject({
      section: 'Context',
      text: 'Prefers concise scheduled summaries.',
    })
    expect((await readMemoryDocument(vaultRoot)).records).toHaveLength(1)
  })

  it('fails closed without a maintenance claim and enforces the turn-local mutation cap', async () => {
    const vaultRoot = await makeVaultRoot()
    const firstRequest = requireRequest(readToolRequest('maintenance_memory', {
      action: 'upsert',
      section: 'Context',
      text: 'Durable fact 1.',
    }))

    const absent = await executeTool(firstRequest, {
      authority: memoryMaintenanceAuthority,
      claimMaintenanceMemoryMutation: null,
      vaultRoot,
    })
    expect(absent.rpcResult.success).toBe(false)
    expect(readResultPayload(absent)).toEqual({
      code: 'scheduled_memory_claim_unavailable',
    })

    const exhausted = await executeTool(firstRequest, {
      authority: memoryMaintenanceAuthority,
      claimMaintenanceMemoryMutation: () => false,
      vaultRoot,
    })
    expect(exhausted.rpcResult.success).toBe(false)
    expect(readResultPayload(exhausted)).toEqual({
      code: 'scheduled_memory_limit_reached',
    })
    expect((await readMemoryDocument(vaultRoot)).records).toEqual([])

    const claimState = { mutationsClaimed: 0 }
    for (
      let ordinal = 1;
      ordinal <= MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN;
      ordinal += 1
    ) {
      const request = requireRequest(readToolRequest('maintenance_memory', {
        action: 'upsert',
        section: 'Context',
        text: `Durable fact ${ordinal}.`,
      }))
      const result = await executeTool(request, {
        authority: memoryMaintenanceAuthority,
        claimMaintenanceMemoryMutation: () =>
          claimMaintenanceMemoryMutation(claimState),
        vaultRoot,
      })
      expect(result.rpcResult.success).toBe(true)
    }
    expect((await readMemoryDocument(vaultRoot)).records).toHaveLength(
      MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN,
    )

    const overLimit = await executeTool(firstRequest, {
      authority: memoryMaintenanceAuthority,
      claimMaintenanceMemoryMutation: () =>
        claimMaintenanceMemoryMutation(claimState),
      vaultRoot,
    })
    expect(overLimit.rpcResult.success).toBe(false)
    expect(readResultPayload(overLimit)).toEqual({
      code: 'scheduled_memory_limit_reached',
    })
  })

  it('runs bounded research in the parent with the parent-owned Exa credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      output: { candidates: [] },
      results: [],
    }))
    const request = requireRequest(readToolRequest('research_scout_batch', {
      lanes: [{ label: 'sleep', profile: { topics: ['sleep'] } }],
      maxCandidatesPerLane: 2,
      since: '2026-07-01T00:00:00.000Z',
      until: '2026-07-18T00:00:00.000Z',
    }))

    const result = await executeTool(request, {
      authority: researchAuthority,
      env: { EXA_API_KEY: 'parent-owned-test-key' },
      fetchImpl,
    })
    expect(result.rpcResult.success).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.exa.ai/search')
    expect(init).toMatchObject({ method: 'POST' })
    expect(new Headers(init?.headers).get('x-api-key')).toBe('parent-owned-test-key')
    expect(readResultPayload(result)).toMatchObject({
      lanes: [{ label: 'sleep' }],
      provider: { name: 'exa' },
    })
  })

  it('uses bounded parent publicFetch for the two exact product sources', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const claimedSources = new Set<(typeof ASSISTANT_SCHEDULED_PRODUCT_SOURCES)[number]>()
    const claimScheduledProductSource = (
      source: (typeof ASSISTANT_SCHEDULED_PRODUCT_SOURCES)[number],
    ) => {
      if (claimedSources.has(source)) {
        return false
      }
      claimedSources.add(source)
      return true
    }
    const providerFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('provider fetch must not be used')
    })
    const publicFetch = vi.fn<typeof fetch>(async (request) => Response.json({
      items: [{ id: 'one-item', title: 'One item' }],
      links: {},
      schema: String(request).includes('feature-catalog')
        ? 'murph.feature-catalog-feed.v1'
        : 'murph.changelog-feed.v1',
    }))

    const unownedBudget = await executeTool(
      requireRequest(readToolRequest('product_source', { source: 'changelog' })),
      {
        authority: productAuthority,
        claimScheduledProductSource: null,
        fetchImpl: providerFetch,
        publicFetchImpl: publicFetch,
      },
    )
    expect(unownedBudget.rpcResult.success).toBe(false)
    expect(readResultPayload(unownedBudget)).toEqual({
      code: 'scheduled_product_source_already_used',
    })
    expect(publicFetch).not.toHaveBeenCalled()

    for (const [source, expectedPath] of [
      ['changelog', '/api/changelog?days=14&featureLimit=70&improvementLimit=10'],
      ['feature_catalog', '/api/feature-catalog'],
    ] as const) {
      const turnAbort = source === 'changelog' ? new AbortController() : null
      const request = requireRequest(readToolRequest('product_source', { source }))
      const result = await executeTool(request, {
        ...(turnAbort ? { abortSignal: turnAbort.signal } : {}),
        authority: productAuthority,
        claimScheduledProductSource,
        fetchImpl: providerFetch,
        publicFetchImpl: publicFetch,
      })
      expect(result.rpcResult.success).toBe(true)
      const [url, init] = publicFetch.mock.calls.at(-1) ?? []
      expect(String(url)).toBe(`${MURPH_PRODUCT_ORIGIN}${expectedPath}`)
      expect(init).toMatchObject({ method: 'GET' })
      expect(init?.signal?.aborted).toBe(false)
      if (turnAbort) {
        expect(init?.signal).not.toBe(turnAbort.signal)
        turnAbort.abort()
        expect(init?.signal?.aborted).toBe(true)
      }

      const duplicate = await executeTool(request, {
        authority: productAuthority,
        claimScheduledProductSource,
        fetchImpl: providerFetch,
        publicFetchImpl: publicFetch,
      })
      expect(duplicate.rpcResult.success).toBe(false)
      expect(readResultPayload(duplicate)).toEqual({
        code: 'scheduled_product_source_already_used',
      })
    }
    expect(timeoutSpy).toHaveBeenCalledTimes(2)
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(publicFetch).toHaveBeenCalledTimes(2)
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('fails closed when a scheduled product source response exceeds its byte bound', async () => {
    const publicFetch = vi.fn<typeof fetch>(async () => new Response(
      'x'.repeat(256_001),
      { headers: { 'content-type': 'application/json' } },
    ))
    const sourceCurrentAssertion = vi.fn<AssistantScheduledTaskSourceCurrentAssertion>(
      async (authority) => resolveAssistantScheduledTaskAuthority(authority),
    )

    const result = await executeTool(
      requireRequest(readToolRequest('product_source', { source: 'changelog' })),
      {
        authority: productAuthority,
        publicFetchImpl: publicFetch,
        sourceCurrentAssertion,
      },
    )

    expect(result.rpcResult.success).toBe(false)
    expect(readResultPayload(result)).toEqual({
      code: 'scheduled_source_unavailable',
    })
    expect(sourceCurrentAssertion).toHaveBeenCalledOnce()
    expect(publicFetch).toHaveBeenCalledOnce()
  })

  it('fails closed on malformed scheduled product source JSON and schema', async () => {
    const publicFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"schema":', {
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(Response.json({
        items: [],
        schema: 'unexpected-product-source-schema',
      }))

    for (const source of ASSISTANT_SCHEDULED_PRODUCT_SOURCES) {
      const result = await executeTool(
        requireRequest(readToolRequest('product_source', { source })),
        {
          authority: productAuthority,
          publicFetchImpl: publicFetch,
        },
      )

      expect(result.rpcResult.success).toBe(false)
      expect(readResultPayload(result)).toEqual({
        code: 'scheduled_source_unavailable',
      })
    }
    expect(publicFetch).toHaveBeenCalledTimes(2)
  })
})

function readToolRequest(tool: string, argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool,
      turnId: 'turn-active-root-1',
    },
  })
}

function requireRequest(
  request: MurphDynamicToolRequest | null,
): MurphDynamicToolRequest {
  if (!request) {
    throw new Error('Expected a dynamic tool request.')
  }
  return request
}

async function executeTool(
  request: MurphDynamicToolRequest,
  overrides: {
    abortSignal?: AbortSignal
    authority?: AssistantScheduledTaskAuthority
    claimMaintenanceMemoryMutation?: (() => boolean) | null
    claimScheduledProductSource?: ((source: (typeof ASSISTANT_SCHEDULED_PRODUCT_SOURCES)[number]) => boolean) | null
    claimScheduledResearchScoutBatch?: (() => boolean) | null
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
    hostedToolContext?: AssistantHostedToolContext | null
    publicFetchImpl?: typeof fetch
    scheduledOccurrenceAt?: string
    sourceCurrentAssertion?: AssistantScheduledTaskSourceCurrentAssertion
    vaultRoot?: string
  } = {},
) {
  return await executeMurphDynamicToolRequest({
    abortSignal: overrides.abortSignal ?? null,
    claimMaintenanceMemoryMutation:
      overrides.claimMaintenanceMemoryMutation === undefined
        ? () => true
        : overrides.claimMaintenanceMemoryMutation,
    claimScheduledProductSource:
      overrides.claimScheduledProductSource === undefined
        ? () => true
        : overrides.claimScheduledProductSource,
    claimScheduledResearchScoutBatch:
      overrides.claimScheduledResearchScoutBatch === undefined
        ? () => true
        : overrides.claimScheduledResearchScoutBatch,
    env: overrides.env ?? {},
    fetchImpl: overrides.fetchImpl ?? fetch,
    hostedToolContext: overrides.hostedToolContext ?? null,
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    publicFetchImpl: overrides.publicFetchImpl ?? null,
    request,
    scheduledOccurrenceAt: overrides.scheduledOccurrenceAt ?? null,
    scheduledTaskAuthority: overrides.authority ?? null,
    scheduledTaskSourceCurrentAssertion: overrides.sourceCurrentAssertion ?? (async (authority) => {
      const resolved = resolveAssistantScheduledTaskAuthority(authority)
      if (resolved.kind === 'none') {
        throw new Error('Test authority is invalid.')
      }
      return resolved
    }),
    vaultRoot: overrides.vaultRoot ?? null,
  })
}

function createScheduledGroupToolContext(
  assertScheduledGroupRouteCurrent: () => Promise<void>,
): AssistantHostedToolContext {
  return {
    assertScheduledGroupRouteCurrent,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: async () => {
      throw new Error('Vault file delivery is unavailable in this test.')
    },
    vaultFileSendAvailable: false,
  }
}

function readResultPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  const text = result.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected tool result text.')
  }
  return JSON.parse(text) as unknown
}

async function makeVaultRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'murph-scheduled-tools-'))
  tempRoots.push(root)
  await initializeVault({ vaultRoot: root })
  return root
}
