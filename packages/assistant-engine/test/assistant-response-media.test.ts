import { describe, expect, it } from 'vitest'

import {
  listAssistantMediaCatalog,
  normalizeAssistantResponseMediaList,
} from '../src/assistant/response-media.ts'

describe('assistant response media', () => {
  it('normalizes, dedupes, and preserves response media order without runtime state', () => {
    expect(normalizeAssistantResponseMediaList([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Duplicate should collapse by URL',
        source: 'duplicate',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/finish.png',
        alt: null,
        source: null,
      },
    ])).toEqual([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/finish.png',
        alt: null,
        source: null,
      },
    ])
  })

  it('lists catalog items by query and resolves relative HTTPS item URLs', async () => {
    const result = await listAssistantMediaCatalog({
      env: {},
      fetchImplementation: async (url) => {
        expect(url).toBe('https://app.example.test/assistant-media/catalog.json')
        return new Response(
          JSON.stringify({
            schema: 'murph.assistant-media-catalog.v1',
            updatedAt: '2026-06-07T00:00:00.000Z',
            items: [
              {
                id: 'dead-bug-setup',
                title: 'Dead bug setup',
                description: 'Supine core setup with knees bent.',
                url: '/assistant-media/dead-bug/01-setup.png',
                alt: 'Dead bug setup position',
                tags: ['core', 'exercise therapy'],
              },
              {
                id: 'hamstring-stretch',
                title: 'Hamstring stretch',
                description: 'Standing hamstring stretch.',
                url: 'https://cdn.example.test/hamstring.png',
                tags: ['stretch'],
              },
            ],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      },
      productBaseUrl: 'https://app.example.test',
      query: 'dead core',
    })

    expect(result).toEqual({
      catalogUrl: 'https://app.example.test/assistant-media/catalog.json',
      updatedAt: '2026-06-07T00:00:00.000Z',
      items: [
        {
          id: 'dead-bug-setup',
          title: 'Dead bug setup',
          description: 'Supine core setup with knees bent.',
          url: 'https://app.example.test/assistant-media/dead-bug/01-setup.png',
          alt: 'Dead bug setup position',
          tags: ['core', 'exercise therapy'],
        },
      ],
    })
  })

  it('rejects non-public assistant media catalog URLs before fetch', async () => {
    for (const catalogUrl of [
      'http://app.example.test/assistant-media/catalog.json',
      'https://user:pass@app.example.test/assistant-media/catalog.json',
      'https://app.example.test/assistant-media/catalog.json?token=secret',
      'https://app.example.test/assistant-media/catalog.json#items',
      'https://localhost/assistant-media/catalog.json',
      'https://assets.local/assistant-media/catalog.json',
      'https://127.0.0.1/assistant-media/catalog.json',
      'https://8.8.8.8/assistant-media/catalog.json',
      'https://[::1]/assistant-media/catalog.json',
      'https://[2606:4700:4700::1111]/assistant-media/catalog.json',
    ]) {
      await expect(
        listAssistantMediaCatalog({
          catalogUrl,
          env: {},
          fetchImplementation: async () => {
            throw new Error('fetch should not run')
          },
        }),
        catalogUrl,
      ).rejects.toThrow()
    }
  })

  it('times out catalog requests that do not resolve', async () => {
    await expect(
      listAssistantMediaCatalog({
        env: {},
        fetchImplementation: async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            )
          }),
        productBaseUrl: 'https://app.example.test',
        requestTimeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MEDIA_CATALOG_REQUEST_TIMEOUT',
    })
  })
})
