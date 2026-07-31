import { describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'

const CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
}

const CARD_V2: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: null,
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const IMAGE: AssistantResponseMedia = {
  alt: null,
  kind: 'image',
  source: null,
  url: 'https://cdn.example.test/nutrition.png',
}

function executeCardTool(input: {
  currentResponseCard?: AssistantResponseCard | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  privateDirectResponseCardAllowed?: boolean | null
  request?: Parameters<typeof executeMurphDynamicToolRequest>[0]['request']
}) {
  return executeMurphDynamicToolRequest({
    currentResponseCard: input.currentResponseCard ?? null,
    currentResponseMedia: input.currentResponseMedia ?? [],
    env: {},
    fetchImpl: fetch,
    nextUsageOrdinal: () => 0,
    privateDirectResponseCardAllowed:
      input.privateDirectResponseCardAllowed ?? true,
    progressDelivery: null,
    request: input.request ?? {
      card: CARD,
      kind: 'attach-response-card',
    },
  })
}

function readCardToolRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'attach_response_card',
    },
  })
}

describe('murph.attach_response_card', () => {
  it('uses the strict card contract at the model-facing boundary', () => {
    expect(readCardToolRequest({ card: CARD })).toEqual({
      card: CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: CARD_V2 })).toEqual({
      card: CARD_V2,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: CARD, extra: true })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      card: {
        ...CARD,
        kind: 'unknown_card',
      },
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
  })

  it('rejects group use and a second card without echoing nutrition values', async () => {
    const groupResult = await executeCardTool({
      privateDirectResponseCardAllowed: false,
    })
    expect(groupResult.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards require a private direct conversation',
        type: 'inputText',
      }],
      success: false,
    })

    const first = await executeCardTool({})
    expect(first).toMatchObject({
      responseCardPatch: { card: CARD },
      rpcResult: {
        contentItems: [{ text: 'response card attached', type: 'inputText' }],
        success: true,
      },
    })
    expect(JSON.stringify(first.rpcResult)).not.toContain('1490.25')

    const second = await executeCardTool({ currentResponseCard: CARD })
    expect(second.rpcResult).toEqual({
      contentItems: [{
        text: 'a response card is already attached',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('rejects card and response media in either attachment order', async () => {
    const cardAfterMedia = await executeCardTool({ currentResponseMedia: [IMAGE] })
    expect(cardAfterMedia.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards cannot be combined with response media',
        type: 'inputText',
      }],
      success: false,
    })

    const mediaAfterCard = await executeCardTool({
      currentResponseCard: CARD,
      request: {
        kind: 'attach-response-media',
        media: [IMAGE],
      },
    })
    expect(mediaAfterCard.rpcResult).toEqual({
      contentItems: [{
        text: 'response media cannot be combined with a response card',
        type: 'inputText',
      }],
      success: false,
    })
  })
})
