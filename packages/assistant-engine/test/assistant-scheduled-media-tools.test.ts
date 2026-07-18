import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
  resolveMurphScheduledDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  createVoiceMemoToolRuntimeFromEnv,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  claimScheduledMediaGeneration,
} from '../src/assistant-codex/dynamic-tools/scheduled-media.ts'
import {
  reserveAssistantCronScheduledMediaGeneration,
} from '../src/assistant/cron/scheduled-media-reservation.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
} from '../src/assistant/managed-automations.ts'

const GROUP_AUTHORITY = {
  automationId: 'automation_group_challenge',
  expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
  kind: 'group_challenge',
  projectionScopeKey: 'steps-days.v0',
  slug: 'summer-steps',
} as const
const SCHEDULED_OCCURRENCE_AT = '2026-07-18T13:00:00.000Z'
const GENERIC_AUTHORITY = {
  automationId: 'automation_generic_reminder',
  expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
  kind: 'generic_notification',
} as const
const PRODUCT_AUTHORITY = {
  automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
  kind: 'product_notes',
  slug: 'murph-product-notes',
} as const
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])
const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true }),
  ))
})

describe('scheduled media tool boundary', () => {
  it('advertises media only for exact group delivery authority', () => {
    const names = (input: Parameters<typeof resolveMurphScheduledDynamicTools>[0]) =>
      resolveMurphScheduledDynamicTools(input).map((tool) => tool.name)

    expect(names({
      deliveryToolsAvailable: false,
      taskAuthority: GROUP_AUTHORITY,
      voiceMemoGenerationAvailable: true,
    })).not.toEqual(expect.arrayContaining([
      'generate_scheduled_image',
      'generate_scheduled_voice_memo',
      'generate_scheduled_song',
    ]))
    expect(names({
      deliveryToolsAvailable: true,
      taskAuthority: GROUP_AUTHORITY,
      voiceMemoGenerationAvailable: false,
    })).toEqual(expect.arrayContaining(['generate_scheduled_image']))
    expect(names({
      deliveryToolsAvailable: true,
      taskAuthority: GROUP_AUTHORITY,
      voiceMemoGenerationAvailable: false,
    })).not.toEqual(expect.arrayContaining([
      'generate_scheduled_voice_memo',
      'generate_scheduled_song',
    ]))
    expect(names({
      deliveryToolsAvailable: true,
      taskAuthority: GROUP_AUTHORITY,
      voiceMemoGenerationAvailable: true,
    })).toEqual(expect.arrayContaining([
      'generate_scheduled_image',
      'generate_scheduled_voice_memo',
      'generate_scheduled_song',
    ]))
    for (const taskAuthority of [GENERIC_AUTHORITY, PRODUCT_AUTHORITY]) {
      expect(names({
        deliveryToolsAvailable: true,
        taskAuthority,
        voiceMemoGenerationAvailable: true,
      })).not.toEqual(expect.arrayContaining([
        'generate_scheduled_image',
        'generate_scheduled_voice_memo',
        'generate_scheduled_song',
      ]))
    }
  })

  it('rejects refs and authority-shaped fields while fixing the scheduled voice', () => {
    for (const [tool, argumentsValue] of [
      ['generate_scheduled_image', {
        alt: 'Panel one',
        prompt: 'Draw panel one.',
        referenceImageRefs: ['raw/captures/member.webp'],
      }],
      ['generate_scheduled_image', {
        alt: 'Panel one',
        prompt: 'Draw panel one.',
        url: 'https://example.test/reference.webp',
      }],
      ['generate_scheduled_voice_memo', {
        text: 'Standings are in.',
        voiceId: 'model-selected-voice',
      }],
      ['generate_scheduled_song', {
        durationSeconds: 61,
        instrumental: false,
        prompt: 'A short standings song.',
      }],
      ['generate_scheduled_song', {
        durationSeconds: 30,
        instrumental: false,
        prompt: 'A short standings song.',
        targetId: 'member_123',
      }],
    ] as const) {
      expect(readToolRequest(tool, argumentsValue)?.kind).toMatch(/^invalid-/u)
    }

    expect(readToolRequest('generate_scheduled_voice_memo', {
      text: 'Standings are in.',
    })).toEqual({
      args: {
        text: 'Standings are in.',
        voiceId: null,
      },
      kind: 'generate-scheduled-voice-memo',
    })
  })

  it('rechecks image authority before generation, capture, and upload while reusing the canonical capture', async () => {
    const vaultRoot = await createTempVault()
    const request = readToolRequest('generate_scheduled_image', {
      alt: 'Panel one',
      outputFormat: 'webp',
      prompt: 'Draw a square newspaper-comic panel.',
      quality: 'medium',
      size: '1024x1024',
    }, 'scheduled-image-call-1')
    expect(request?.kind).toBe('generate-scheduled-image')
    if (!request) {
      throw new Error('scheduled image request was not parsed')
    }

    const assertSourceCurrent = vi.fn(async () => GROUP_AUTHORITY)
    const uploadGeneratedImage = vi.fn(async (input: { alt: string | null }) => {
      expect(assertSourceCurrent).toHaveBeenCalledTimes(
        uploadGeneratedImage.mock.calls.length * 2 + 2,
      )
      return {
        alt: input.alt ?? 'Generated image',
        kind: 'image' as const,
        source: 'gpt-image-2',
        url: 'https://imagedelivery.net/account/scheduled-panel/public.webp',
      }
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      expect(assertSourceCurrent).toHaveBeenCalledTimes(2)
      return jsonResponse({
        data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }],
        usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
      })
    })

    const result = await executeMurphDynamicToolRequest({
      claimScheduledMediaGeneration: async () => 'claimed',
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: { uploadGeneratedImage },
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      requireHostedGeneratedImageUploader: true,
      scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
      scheduledTaskAuthority: GROUP_AUTHORITY,
      scheduledTaskSourceCurrentAssertion: assertSourceCurrent,
      vaultRoot,
    })

    expect(result.rpcResult.success).toBe(true)
    expect(result.responseMediaPatch?.media).toHaveLength(1)
    const firstRpcText = result.rpcResult.contentItems[0]?.type === 'inputText'
      ? result.rpcResult.contentItems[0].text
      : null
    expect(firstRpcText).toBe(JSON.stringify({ status: 'attached' }))
    expect(firstRpcText).not.toMatch(/(?:raw\/|https?:|[A-Za-z0-9_-]{16,})/u)

    const retried = await executeMurphDynamicToolRequest({
      claimScheduledMediaGeneration: async () => 'claimed',
      env: { OPENAI_API_KEY: 'openai-test-key' },
      fetchImpl,
      hostedGeneratedImageUploader: { uploadGeneratedImage },
      nextUsageOrdinal: () => 2,
      progressDelivery: null,
      request,
      requireHostedGeneratedImageUploader: true,
      scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
      scheduledTaskAuthority: GROUP_AUTHORITY,
      scheduledTaskSourceCurrentAssertion: assertSourceCurrent,
      vaultRoot,
    })

    expect(retried.rpcResult.success).toBe(true)
    expect(retried.rpcResult.contentItems[0]).toEqual({
      text: firstRpcText,
      type: 'inputText',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(uploadGeneratedImage).toHaveBeenCalledTimes(2)
    expect(assertSourceCurrent).toHaveBeenCalledTimes(6)
  })

  it('rechecks voice authority at every turn-time provider boundary', async () => {
    const request = readToolRequest('generate_scheduled_voice_memo', {
      text: 'Today’s standings are official.',
    })
    expect(request?.kind).toBe('generate-scheduled-voice-memo')
    if (!request) {
      throw new Error('scheduled voice request was not parsed')
    }

    const env = {
      ELEVENLABS_API_KEY: 'elevenlabs-key',
      LINQ_API_TOKEN: 'linq-token',
      MURPH_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
      MURPH_ELEVENLABS_VOICE_ID: 'voice_murph',
    }
    const assertSourceCurrent = vi.fn(async () => GROUP_AUTHORITY)
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        expect(assertSourceCurrent).toHaveBeenCalledTimes(2)
        return new Response(mp3Bytes, {
          headers: { 'content-type': 'audio/mpeg' },
        })
      }
      if (url === 'https://api.linqapp.com/api/partner/v3/attachments') {
        expect(assertSourceCurrent).toHaveBeenCalledTimes(3)
        return jsonResponse({
          attachment_id: 'attachment_scheduled_voice',
          download_url: 'https://cdn.example.test/scheduled-voice.mp3',
          expires_at: '2026-07-18T12:05:00.000Z',
          http_method: 'PUT',
          required_headers: { 'content-type': 'audio/mpeg' },
          upload_url: 'https://uploads.example.test/scheduled-voice',
        })
      }
      if (url === 'https://uploads.example.test/scheduled-voice') {
        expect(assertSourceCurrent).toHaveBeenCalledTimes(4)
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const result = await executeMurphDynamicToolRequest({
      claimScheduledMediaGeneration: async () => 'claimed',
      env,
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
      scheduledTaskAuthority: GROUP_AUTHORITY,
      scheduledTaskSourceCurrentAssertion: assertSourceCurrent,
      voiceMemoRuntime: createVoiceMemoToolRuntimeFromEnv({
        env,
        fetchImpl,
        publicFetchImpl: fetchImpl,
        voiceMemoDeliveryChannel: 'linq',
      }),
    })

    expect(result.rpcResult.success).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(assertSourceCurrent).toHaveBeenCalledTimes(4)
  })

  it('fails closed when the dispatcher refuses another media generation', async () => {
    const request = readToolRequest('generate_scheduled_voice_memo', {
      text: 'One voice memo only.',
    })
    if (!request) {
      throw new Error('scheduled voice request was not parsed')
    }
    const sourceAssertion = vi.fn(async () => GROUP_AUTHORITY)
    const result = await executeMurphDynamicToolRequest({
      claimScheduledMediaGeneration: async () => 'limit_reached',
      env: {},
      fetchImpl: vi.fn<typeof fetch>(),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
      scheduledTaskAuthority: GROUP_AUTHORITY,
      scheduledTaskSourceCurrentAssertion: sourceAssertion,
    })

    expect(result.rpcResult).toEqual({
      contentItems: [{
        text: JSON.stringify({ code: 'scheduled_media_limit_reached' }),
        type: 'inputText',
      }],
      success: false,
    })
    expect(sourceAssertion).toHaveBeenCalledOnce()
  })

  it('bounds a turn to four images or one mutually exclusive audio generation', async () => {
    const reserve = vi.fn(async () => 'reserved' as const)
    const imageState = {
      audioGenerationClaimed: false,
      imageGenerationClaims: 0,
    }
    expect([
      await claimScheduledMediaGeneration(imageState, 'image', reserve),
      await claimScheduledMediaGeneration(imageState, 'image', reserve),
      await claimScheduledMediaGeneration(imageState, 'image', reserve),
      await claimScheduledMediaGeneration(imageState, 'image', reserve),
    ]).toEqual(['claimed', 'claimed', 'claimed', 'claimed'])
    await expect(claimScheduledMediaGeneration(imageState, 'image', reserve))
      .resolves.toBe('limit_reached')
    await expect(claimScheduledMediaGeneration(imageState, 'audio', reserve))
      .resolves.toBe('limit_reached')
    expect(reserve).toHaveBeenCalledOnce()

    const audioState = {
      audioGenerationClaimed: false,
      imageGenerationClaims: 0,
    }
    await expect(claimScheduledMediaGeneration(audioState, 'audio', reserve))
      .resolves.toBe('claimed')
    await expect(claimScheduledMediaGeneration(audioState, 'audio', reserve))
      .resolves.toBe('limit_reached')
    await expect(claimScheduledMediaGeneration(audioState, 'image', reserve))
      .resolves.toBe('limit_reached')
    expect(reserve).toHaveBeenCalledTimes(2)
  })

  it('atomically reserves one cron-owned media lane across fresh processes', async () => {
    const vaultRoot = await createTempVault()
    const paths = resolveAssistantStatePaths(vaultRoot)
    const runtimeState = createAssistantCronCanonicalRuntimeRecord({
      jobId: GROUP_AUTHORITY.automationId,
      now: '2026-07-18T12:59:00.000Z',
    })
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [{
        ...runtimeState,
        state: {
          ...runtimeState.state,
          pendingOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
          runningAt: '2026-07-18T12:59:30.000Z',
          runningClaimId: 'claim_media_first_process',
          runningPid: process.pid,
        },
      }],
      version: 1,
    }, {
      reclaimStaleRunningClaims: false,
    })
    const dependencies = {
      assertSourceCurrent: vi.fn(async () => GROUP_AUTHORITY),
      now: () => '2026-07-18T13:00:01.000Z',
    }

    const results = await Promise.all([
      reserveAssistantCronScheduledMediaGeneration({
        authority: GROUP_AUTHORITY,
        lane: 'image',
        occurrenceAt: SCHEDULED_OCCURRENCE_AT,
        vault: vaultRoot,
      }, dependencies),
      reserveAssistantCronScheduledMediaGeneration({
        authority: GROUP_AUTHORITY,
        lane: 'audio',
        occurrenceAt: SCHEDULED_OCCURRENCE_AT,
        vault: vaultRoot,
      }, dependencies),
    ])
    expect(results.sort()).toEqual(['already_reserved', 'reserved'])

    const reservedStore = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const reservation = reservedStore.jobs[0]?.state.scheduledMediaReservation
    expect(reservation).toMatchObject({
      automationId: GROUP_AUTHORITY.automationId,
      expectedUpdatedAt: GROUP_AUTHORITY.expectedUpdatedAt,
      occurrenceAt: SCHEDULED_OCCURRENCE_AT,
    })
    expect(['audio', 'image']).toContain(reservation?.lane)

    const restarted = reservedStore.jobs[0]
    if (!restarted) {
      throw new Error('Expected scheduled media runtime state.')
    }
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [{
        ...restarted,
        state: {
          ...restarted.state,
          runningAt: '2026-07-18T13:01:00.000Z',
          runningClaimId: 'claim_media_restarted_process',
          runningPid: process.pid,
        },
      }],
      version: 1,
    }, {
      reclaimStaleRunningClaims: false,
    })
    await expect(reserveAssistantCronScheduledMediaGeneration({
      authority: GROUP_AUTHORITY,
      lane: reservation?.lane === 'image' ? 'audio' : 'image',
      occurrenceAt: SCHEDULED_OCCURRENCE_AT,
      vault: vaultRoot,
    }, dependencies)).resolves.toBe('already_reserved')
  })

  it('does not reserve or call a media provider when source authority fails', async () => {
    const vaultRoot = await createTempVault()
    const paths = resolveAssistantStatePaths(vaultRoot)
    const runtimeState = createAssistantCronCanonicalRuntimeRecord({
      jobId: GROUP_AUTHORITY.automationId,
      now: '2026-07-18T12:59:00.000Z',
    })
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [{
        ...runtimeState,
        state: {
          ...runtimeState.state,
          pendingOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
          runningAt: '2026-07-18T12:59:30.000Z',
          runningClaimId: 'claim_media_stale_source',
          runningPid: process.pid,
        },
      }],
      version: 1,
    }, {
      reclaimStaleRunningClaims: false,
    })
    await expect(reserveAssistantCronScheduledMediaGeneration({
      authority: GROUP_AUTHORITY,
      lane: 'image',
      occurrenceAt: SCHEDULED_OCCURRENCE_AT,
      vault: vaultRoot,
    }, {
      assertSourceCurrent: async () => {
        throw new Error('source changed')
      },
    })).rejects.toThrow('source changed')
    expect((await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })).jobs[0]?.state.scheduledMediaReservation).toBeNull()

    const request = readToolRequest('generate_scheduled_voice_memo', {
      text: 'Fallback to text after a prior process reserved media.',
    })
    if (!request) {
      throw new Error('scheduled voice request was not parsed')
    }
    const providerFetch = vi.fn<typeof fetch>()
    const result = await executeMurphDynamicToolRequest({
      claimScheduledMediaGeneration: async () => 'occurrence_reserved',
      env: {},
      fetchImpl: providerFetch,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request,
      scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
      scheduledTaskAuthority: GROUP_AUTHORITY,
      scheduledTaskSourceCurrentAssertion: async () => GROUP_AUTHORITY,
    })
    expect(result.rpcResult).toEqual({
      contentItems: [{
        text: JSON.stringify({ code: 'scheduled_media_occurrence_reserved' }),
        type: 'inputText',
      }],
      success: false,
    })
    expect(providerFetch).not.toHaveBeenCalled()
  })
})

function readToolRequest(
  tool: string,
  argumentsValue: Record<string, unknown>,
  toolCallId?: string,
) {
  return readMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool,
      ...(toolCallId ? { toolCallId } : {}),
    },
  })
}

async function createTempVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-scheduled-media-test-'))
  tempRoots.push(root)
  await initializeVault({ vaultRoot: root })
  return root
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}
