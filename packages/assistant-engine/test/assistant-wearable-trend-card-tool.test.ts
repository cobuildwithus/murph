import { rm } from 'node:fs/promises'

import {
  createSavedHealthView,
  deleteSavedHealthView,
  initializeVault,
} from '@murphai/core'
import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'
import { afterEach, describe, expect, it } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_ATTACH_WEARABLE_TREND_CARD_TOOL,
  resolveMurphDynamicTools,
  type MurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.js'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ))
})

function readWearableTrendToolRequest(
  argumentsValue: unknown,
  tool: string = MURPH_ATTACH_WEARABLE_TREND_CARD_TOOL.name,
): MurphDynamicToolRequest | null {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool,
    },
  })
}

async function executeWearableTrendTool(input: {
  currentResponseCard?: AssistantResponseCard | null
  currentResponseMedia?: readonly AssistantResponseMedia[]
  privateDirectResponseCardAllowed?: boolean
  request: MurphDynamicToolRequest
  vaultRoot?: string | null
}) {
  return await executeMurphDynamicToolRequest({
    currentResponseCard: input.currentResponseCard ?? null,
    currentResponseMedia: input.currentResponseMedia ?? [],
    env: {},
    fetchImpl: fetch,
    nextUsageOrdinal: () => 0,
    privateDirectResponseCardAllowed:
      input.privateDirectResponseCardAllowed ?? true,
    progressDelivery: null,
    request: input.request,
    vaultRoot: input.vaultRoot ?? null,
  })
}

async function createEmptyVault(): Promise<string> {
  const context = await createTempVaultContext('murph-wearable-trend-card-')
  cleanupPaths.push(context.parentRoot)
  await initializeVault({ timezone: 'UTC', vaultRoot: context.vaultRoot })
  return context.vaultRoot
}

const EXISTING_CARD: AssistantResponseCard = {
  kind: 'wearable_trend',
  localDates: [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ],
  metrics: [{
    metricKey: 'steps',
    trend: 'not_enough_data',
    values: [null, null, null, null, null, null, null],
  }],
  version: 1,
}

const EXISTING_MEDIA: AssistantResponseMedia = {
  alt: null,
  kind: 'image',
  source: null,
  url: 'https://cdn.example.test/health.png',
}

describe('murph.attach_wearable_trend_card', () => {
  it('offers a selection-only schema on eligible response-card turns', () => {
    const unavailable = resolveMurphDynamicTools({
      responseCardsAvailable: true,
    })
    const available = resolveMurphDynamicTools({
      wearableTrendCardsAvailable: true,
    })

    expect(unavailable).not.toContain(MURPH_ATTACH_WEARABLE_TREND_CARD_TOOL)
    expect(available).toContain(MURPH_ATTACH_WEARABLE_TREND_CARD_TOOL)

    const schema = JSON.stringify(
      MURPH_ATTACH_WEARABLE_TREND_CARD_TOOL.inputSchema,
    )
    expect(schema).toContain('metricKeys')
    expect(schema).toContain('savedViewId')
    expect(schema).toContain('hrv-rmssd')
    expect(schema).not.toContain('values')
    expect(schema).not.toContain('average')
    expect(schema).not.toContain('sparkline')
  })

  it('accepts exactly one ordered selector and rejects model-authored data', () => {
    expect(readWearableTrendToolRequest({
      metricKeys: ['steps', 'total-sleep-minutes', 'hrv-rmssd'],
    })).toEqual({
      kind: 'attach-wearable-trend-card',
      request: {
        metricKeys: ['steps', 'total-sleep-minutes', 'hrv-rmssd'],
      },
    })
    expect(readWearableTrendToolRequest({
      savedViewId: 'hview_01K3N7T6ZJ9R8Q2M4V5W6X7Y8Z',
    })).toEqual({
      kind: 'attach-wearable-trend-card',
      request: {
        savedViewId: 'hview_01K3N7T6ZJ9R8Q2M4V5W6X7Y8Z',
      },
    })

    for (const invalid of [
      {},
      { metricKeys: ['steps'], savedViewId: 'hview_01K3N7T6ZJ9R8Q2M4V5W6X7Y8Z' },
      { metricKeys: ['steps', 'steps'] },
      { metricKeys: ['steps'], values: [1, 2, 3, 4, 5, 6, 7] },
      { savedViewId: 'Morning check' },
      { card: EXISTING_CARD },
    ]) {
      expect(readWearableTrendToolRequest(invalid)).toMatchObject({
        kind: 'invalid-wearable-trend-card-arguments',
      })
    }

    expect(readWearableTrendToolRequest(
      { card: EXISTING_CARD },
      MURPH_ATTACH_RESPONSE_CARD_TOOL.name,
    )).toMatchObject({ kind: 'invalid-response-card-arguments' })
  })

  it('resolves one-off metrics in order and attaches only the trusted card', async () => {
    const vaultRoot = await createEmptyVault()
    const request = readWearableTrendToolRequest({
      metricKeys: ['steps', 'total-sleep-minutes', 'hrv-rmssd'],
    })
    expect(request).toMatchObject({ kind: 'attach-wearable-trend-card' })
    if (!request) {
      throw new TypeError('Expected a wearable trend card request.')
    }

    const result = await executeWearableTrendTool({ request, vaultRoot })

    expect(result.rpcResult).toEqual({
      contentItems: [{
        text: 'wearable trend card attached',
        type: 'inputText',
      }],
      success: true,
    })
    expect(result.responseMediaPatch).toBeUndefined()
    expect(result.responseCardPatch?.card).toMatchObject({
      kind: 'wearable_trend',
      metrics: [
        { metricKey: 'steps' },
        { metricKey: 'total-sleep-minutes' },
        { metricKey: 'hrv-rmssd' },
      ],
      version: 1,
    })
    if (result.responseCardPatch?.card.kind !== 'wearable_trend') {
      throw new TypeError('Expected a wearable trend response card.')
    }
    expect(result.responseCardPatch.card.localDates).toHaveLength(7)
    expect(result.responseCardPatch.card.metrics).toHaveLength(3)
    for (const metric of result.responseCardPatch.card.metrics) {
      expect(metric.values).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ])
      expect(metric.trend).toBe('not_enough_data')
    }
  })

  it('resolves an exact saved view and fails truthfully after deletion', async () => {
    const vaultRoot = await createEmptyVault()
    const created = await createSavedHealthView({
      metricKeys: ['resting-heart-rate', 'steps'],
      name: 'Morning check',
      vaultRoot,
    })
    const request = readWearableTrendToolRequest({
      savedViewId: created.view.savedViewId,
    })
    if (!request) {
      throw new TypeError('Expected a saved wearable trend card request.')
    }

    const attached = await executeWearableTrendTool({ request, vaultRoot })
    expect(attached.responseCardPatch?.card).toMatchObject({
      kind: 'wearable_trend',
      metrics: [
        { metricKey: 'resting-heart-rate' },
        { metricKey: 'steps' },
      ],
    })

    await deleteSavedHealthView({
      savedViewId: created.view.savedViewId,
      vaultRoot,
    })
    const missing = await executeWearableTrendTool({ request, vaultRoot })
    expect(missing.responseCardPatch).toBeUndefined()
    expect(missing.rpcResult).toEqual({
      contentItems: [{
        text:
          'that saved health view no longer exists; do not recreate or schedule it',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('fails before vault access outside the one-card private no-media boundary', async () => {
    const request = readWearableTrendToolRequest({ metricKeys: ['steps'] })
    if (!request) {
      throw new TypeError('Expected a wearable trend card request.')
    }

    const group = await executeWearableTrendTool({
      privateDirectResponseCardAllowed: false,
      request,
    })
    const existingCard = await executeWearableTrendTool({
      currentResponseCard: EXISTING_CARD,
      request,
    })
    const existingMedia = await executeWearableTrendTool({
      currentResponseMedia: [EXISTING_MEDIA],
      request,
    })

    expect(group.rpcResult).toMatchObject({
      contentItems: [{
        text: 'wearable trend cards require a private direct conversation',
      }],
      success: false,
    })
    expect(existingCard.rpcResult).toMatchObject({
      contentItems: [{ text: 'a response card is already attached' }],
      success: false,
    })
    expect(existingMedia.rpcResult).toMatchObject({
      contentItems: [{
        text: 'response cards cannot be combined with response media',
      }],
      success: false,
    })
  })
})
