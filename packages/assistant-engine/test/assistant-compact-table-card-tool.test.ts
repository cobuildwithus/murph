import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it } from 'vitest'

import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'

import {
  executeMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'

const TRACKED_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Upper body A',
  subtitle: 'Live workout',
  rowHeader: 'Exercise',
  columns: ['Completed', 'Latest'],
  rows: [
    {
      label: 'Bench press',
      values: ['2 sets', '185 lb × 8'],
    },
  ],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
} satisfies AssistantResponseCard

function readCardToolRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'attach_response_card',
    },
  })
}

describe('murph.attach_response_card compact tables', () => {
  it('accepts one strict tracked compact-table card at the model boundary', () => {
    expect(readCardToolRequest({ card: TRACKED_WORKOUT_CARD })).toEqual({
      card: TRACKED_WORKOUT_CARD,
      kind: 'attach-response-card',
    })
  })

  it('rejects malformed tracking authority and mismatched rows', () => {
    expect(readCardToolRequest({
      card: {
        ...TRACKED_WORKOUT_CARD,
        tracking: {
          ...TRACKED_WORKOUT_CARD.tracking,
          entityId: 'workout-123',
        },
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })

    expect(readCardToolRequest({
      card: {
        ...TRACKED_WORKOUT_CARD,
        rows: [{ label: 'Bench press', values: ['2 sets'] }],
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })
  })

  it('keeps compact tables private-direct and mutually exclusive with media', async () => {
    const groupResult = await executeMurphDynamicToolRequest({
      currentResponseCard: null,
      currentResponseMedia: [],
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 0,
      privateDirectResponseCardAllowed: false,
      progressDelivery: null,
      request: {
        card: TRACKED_WORKOUT_CARD,
        kind: 'attach-response-card',
      },
    })
    expect(groupResult.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards require a private direct conversation',
        type: 'inputText',
      }],
      success: false,
    })

    const mediaResult = await executeMurphDynamicToolRequest({
      currentResponseCard: null,
      currentResponseMedia: [{
        alt: null,
        kind: 'image',
        source: null,
        url: 'https://cdn.example.test/workout.png',
      }],
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 0,
      privateDirectResponseCardAllowed: true,
      progressDelivery: null,
      request: {
        card: TRACKED_WORKOUT_CARD,
        kind: 'attach-response-card',
      },
    })
    expect(mediaResult.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards cannot be combined with response media',
        type: 'inputText',
      }],
      success: false,
    })
  })
})
