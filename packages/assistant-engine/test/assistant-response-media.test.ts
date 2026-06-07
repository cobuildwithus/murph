import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  clearAssistantResponseMedia,
  listAssistantMediaCatalog,
  readAssistantResponseMedia,
  resolveAssistantActiveTurnContextFromEnv,
  stageAssistantResponseMedia,
} from '../src/assistant/response-media.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant response media', () => {
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

  it('stages, dedupes, reads, and clears media for one assistant turn', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-response-media-',
    )
    tempRoots.push(parentRoot)

    const staged = await stageAssistantResponseMedia({
      vault: vaultRoot,
      turnId: 'turn-media-1',
      sessionId: 'session-media-1',
      media: [
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
      ],
    })

    expect(staged).toEqual([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
    ])
    await expect(
      readAssistantResponseMedia({
        vault: vaultRoot,
        turnId: 'turn-media-1',
      }),
    ).resolves.toEqual(staged)

    await clearAssistantResponseMedia({
      vault: vaultRoot,
      turnId: 'turn-media-1',
    })
    await expect(
      readAssistantResponseMedia({
        vault: vaultRoot,
        turnId: 'turn-media-1',
      }),
    ).resolves.toEqual([])
  })

  it('normalizes active turn context from env without inventing missing values', () => {
    expect(
      resolveAssistantActiveTurnContextFromEnv({
        MURPH_ASSISTANT_ACTIVE_TURN_ID: ' turn-env-1 ',
        MURPH_ASSISTANT_ACTIVE_SESSION_ID: ' session-env-1 ',
      }),
    ).toEqual({
      turnId: 'turn-env-1',
      sessionId: 'session-env-1',
    })
    expect(resolveAssistantActiveTurnContextFromEnv({})).toEqual({
      turnId: null,
      sessionId: null,
    })
  })
})
