import { describe, expect, it } from 'vitest'

import {
  sendLinqIMessageAppCard,
  type LinqFetch,
} from '../src/linq-runtime.js'
import {
  encodeCompactTableAppCardUrl,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Live workout',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
  rows: [
    {
      label: 'Exercise A',
      values: ['12', '10', '9', '8'],
    },
  ],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}

describe('Linq compact-table app cards', () => {
  it('uses the installed extension with a truthful static fallback layout', async () => {
    const requests: Array<{ body: unknown; url: string }> = []
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

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('/chats/chat_1/messages')
    expect(requests[0]?.body).toMatchObject({
      message: {
        idempotency_key: 'compact-table-1',
        parts: [
          {
            fallback_text: 'Ask Murph for this card in text',
            interactive: true,
            layout: {
              caption: 'Murph',
              subcaption: 'Workout table',
              trailing_caption: 'OPEN',
            },
            type: 'imessage_app',
            url: encodeCompactTableAppCardUrl(CARD),
          },
        ],
        preferred_service: 'iMessage',
      },
    })
  })
})
