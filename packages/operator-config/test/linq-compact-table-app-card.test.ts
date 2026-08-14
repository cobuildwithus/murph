import { describe, expect, it } from 'vitest'

import {
  sendLinqIMessageAppCard,
  type LinqFetch,
} from '../src/linq-runtime.js'
import {
  buildLinqIMessageAppLayout,
  encodeCompactTableAppCardUrl,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Eight-exercise workout',
  subtitle: 'Verified canonical workout snapshot for today',
  rowHeader: 'Exercise',
  columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
  rows: Array.from({ length: 8 }, (_, rowIndex) => ({
    label: `Exercise ${rowIndex + 1} movement pattern`,
    values: Array.from({ length: 4 }, (_, columnIndex) => {
      const cellLength = rowIndex === 7 && columnIndex === 3 ? 17 : 22
      return `${rowIndex + columnIndex + 1}`.padEnd(cellLength, 'x')
    }),
  })),
  footer: 'Assists and spotted reps remain on the exact set note.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}

const GENERIC_CARD: CompactTableResponseCardV1 = {
  ...CARD,
  title: 'Weekly plan',
  subtitle: null,
  tracking: null,
}

describe('Linq compact-table app cards', () => {
  it('sends the largest admitted card once with a truthful static fallback', async () => {
    const requests: Array<{ body: unknown; url: string }> = []
    const expectedLayout = buildLinqIMessageAppLayout(CARD)
    const fetchImplementation: LinqFetch = async (url, init) => {
      requests.push({
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        url,
      })
      return {
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({ message: { id: 'msg_1' } }),
        ok: true,
        status: 200,
        text: async () => '',
      }
    }

    await sendLinqIMessageAppCard({
      card: CARD,
      chatId: 'chat_1',
      idempotencyKey: 'compact-table-1',
    }, {
      env: {
        LINQ_API_TOKEN: 'test-token',
      },
      fetchImplementation,
    })

    expect(encodeCompactTableAppCardUrl(CARD)).toHaveLength(2_037)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('/chats/chat_1/messages')
    expect(requests[0]?.body).toMatchObject({
      message: {
        idempotency_key: 'compact-table-1',
        parts: [
          {
            fallback_text: 'Your workout. Ask Murph for this card in text',
            interactive: true,
            layout: expectedLayout,
            type: 'imessage_app',
            url: encodeCompactTableAppCardUrl(CARD),
          },
        ],
        preferred_service: 'iMessage',
      },
    })

    const layout = (
      requests[0]?.body as {
        message: { parts: Array<{ layout: Record<string, string> }> }
      }
    ).message.parts[0]?.layout
    expect(layout).toBeDefined()
    expect(layout?.subcaption).toContain(
      'Exercise 8 movement pattern: Set 1:',
    )
    expect(layout?.trailing_caption).toBe(
      'Assists and spotted reps remain on the exact set note.',
    )
  })

  it('sends a generic table with its exact descriptive recovery fallback', async () => {
    const requests: unknown[] = []
    const fetchImplementation: LinqFetch = async (_url, init) => {
      requests.push(
        typeof init.body === 'string' ? JSON.parse(init.body) : null,
      )
      return {
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({ message: { id: 'msg_2' } }),
        ok: true,
        status: 200,
        text: async () => '',
      }
    }

    await sendLinqIMessageAppCard({
      card: GENERIC_CARD,
      chatId: 'chat_2',
      idempotencyKey: 'generic-table-1',
    }, {
      env: {
        LINQ_API_TOKEN: 'test-token',
      },
      fetchImplementation,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      message: {
        parts: [{
          fallback_text:
            'Your Murph summary. Ask Murph for this card in text',
        }],
      },
    })
  })
})
