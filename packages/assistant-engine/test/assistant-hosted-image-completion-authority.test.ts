import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantSession,
  AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  executeMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  createAssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'
import {
  renderAssistantHostedImageCompletionSystemText,
} from '../src/assistant/hosted-image-completion.js'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.js'
import type {
  AssistantMessageInput,
} from '../src/assistant/service-contracts.js'
import {
  readTestMurphDynamicToolRequest,
} from './support/codex-app-server.js'

const COMPLETION_INPUT_ID = `ain_${'1'.repeat(32)}`
const ORIGIN_INPUT_ID = `ain_${'2'.repeat(32)}`
const LATER_INPUT_ID = `ain_${'3'.repeat(32)}`
const EXACT_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const EXACT_MEDIA: AssistantVaultImageResponseMedia = {
  alt: 'Generated group avatar',
  contentType: 'image/png',
  filename: 'generated-avatar.png',
  kind: 'vault_image',
  ref: 'raw/captures/2026/08/generated-avatar/generated-avatar.png',
  sha256: createHash('sha256').update(EXACT_IMAGE_BYTES).digest('hex'),
  sizeBytes: EXACT_IMAGE_BYTES.byteLength,
  source: 'gpt-image-2',
}

describe('hosted image completion effect authority', () => {
  it('preserves schema visibility without granting style, personalization, or group mutation authority', async () => {
    let currentAssistantInputId = COMPLETION_INPUT_ID
    let acceptedInputIds: readonly string[] = [COMPLETION_INPUT_ID]
    const groupTool = { request: vi.fn() }
    const personalizationTool = { request: vi.fn() }
    const hostedToolContext = createAssistantHostedToolContext({
      executionContext: {
        currentAssistantInputId: () => currentAssistantInputId,
        groupTool,
        memberId: 'member-completion-authority',
        personalizationTool,
        userEnvKeys: [],
      },
      getConversationScope: () => 'group',
      getProductFeedbackAcceptedInputIds: () => acceptedInputIds,
      getUserActionAcceptedInputIds: () => acceptedInputIds,
      messageInput: createMessageInput(),
      session: createSession(),
    })

    expect(hostedToolContext.currentHostedImageCompletionEffectScope?.())
      .toEqual({
        authorizedOriginAssistantInputId: ORIGIN_INPUT_ID,
        completionAssistantInputId: COMPLETION_INPUT_ID,
        exactMedia: [EXACT_MEDIA],
      })
    expect(hostedToolContext.currentAssistantInputId?.()).toBeNull()
    expect(hostedToolContext.currentInvocationScope?.()).toBeNull()
    expect(hostedToolContext.currentUserActionScope?.()).toBeNull()
    expect(hostedToolContext.currentProductFeedbackAcceptedInputIds?.())
      .toEqual([])

    const styleRequest = readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'set',
          setting: 'humor',
          value: 8,
        },
        namespace: 'murph',
        tool: 'assistant_style',
      },
    })
    const personalizationRequest = readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'update',
          tone: 'formal',
        },
        namespace: 'murph',
        tool: 'personalization',
      },
    })
    const avatarRequest = readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'set_chat_avatar',
          alt: 'Generated group avatar',
          avatarSource: 'image_ref',
          imageRef: EXACT_MEDIA.ref,
        },
        namespace: 'murph',
        tool: 'group',
      },
    })
    if (!styleRequest || !personalizationRequest || !avatarRequest) {
      throw new Error('Expected style, personalization, and avatar requests.')
    }

    const styleResult = await executeMurphDynamicToolRequest({
      assistantStyleSettingsAvailable: true,
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: styleRequest,
      vaultRoot: '/vault',
    })
    const personalizationResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: personalizationRequest,
    })
    const avatarResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: avatarRequest,
      vaultRoot: '/vault',
    })

    expect(styleResult.rpcResult.success).toBe(false)
    expect(personalizationResult.rpcResult.success).toBe(false)
    expect(avatarResult.rpcResult.success).toBe(false)
    expect(styleResult.rpcResult.contentItems[0]?.text).toContain(
      'carries no authority for that tool action',
    )
    expect(personalizationResult.rpcResult.contentItems[0]?.text).toContain(
      'carries no authority for that tool action',
    )
    expect(avatarResult.rpcResult.contentItems[0]?.text).toContain(
      'carries no authority for that tool action',
    )
    expect(personalizationTool.request).not.toHaveBeenCalled()
    expect(groupTool.request).not.toHaveBeenCalled()

    currentAssistantInputId = LATER_INPUT_ID
    expect(hostedToolContext.currentHostedImageCompletionEffectScope?.())
      .toMatchObject({ completionAssistantInputId: COMPLETION_INPUT_ID })
    expect(hostedToolContext.currentAssistantInputId?.()).toBeNull()

    acceptedInputIds = [COMPLETION_INPUT_ID, LATER_INPUT_ID]
    expect(hostedToolContext.currentHostedImageCompletionEffectScope?.())
      .toBeNull()
    expect(hostedToolContext.currentAssistantInputId?.()).toBe(LATER_INPUT_ID)
    expect(hostedToolContext.currentInvocationScope?.()).toMatchObject({
      origin: {
        assistantInputId: LATER_INPUT_ID,
        kind: 'accepted_input',
      },
    })
    expect(hostedToolContext.currentProductFeedbackAcceptedInputIds?.())
      .toEqual([COMPLETION_INPUT_ID, LATER_INPUT_ID])
  })

  it('permits only the exact completion media attachment', async () => {
    const vaultRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'assistant-image-completion-authority-',
    ))
    try {
      const imagePath = path.join(vaultRoot, EXACT_MEDIA.ref)
      await mkdir(path.dirname(imagePath), { recursive: true })
      await writeFile(imagePath, EXACT_IMAGE_BYTES)
      const hostedToolContext = createAssistantHostedToolContext({
        executionContext: {
          memberId: 'member-completion-media',
          userEnvKeys: [],
        },
        getConversationScope: () => 'group',
        messageInput: createMessageInput({ vault: vaultRoot }),
        session: createSession(),
      })
      expect(hostedToolContext.currentHostedImageCompletionEffectScope?.())
        .toMatchObject({ completionAssistantInputId: COMPLETION_INPUT_ID })
      const exactRequest = readTestMurphDynamicToolRequest({
        method: 'item/tool/call',
        params: {
          arguments: { media: [EXACT_MEDIA] },
          namespace: 'murph',
          tool: 'attach_response_media',
        },
      })
      const mismatchedRequest = readTestMurphDynamicToolRequest({
        method: 'item/tool/call',
        params: {
          arguments: {
            media: [{
              ...EXACT_MEDIA,
              ref: 'raw/captures/2026/08/generated-avatar/other.png',
            }],
          },
          namespace: 'murph',
          tool: 'attach_response_media',
        },
      })
      if (!exactRequest || !mismatchedRequest) {
        throw new Error('Expected response-media requests.')
      }

      const exact = await executeMurphDynamicToolRequest({
        currentResponseMedia: [],
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request: exactRequest,
        vaultRoot,
      })
      const mismatched = await executeMurphDynamicToolRequest({
        currentResponseMedia: [],
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request: mismatchedRequest,
        vaultRoot,
      })
      await writeFile(
        imagePath,
        Buffer.concat([EXACT_IMAGE_BYTES, Buffer.from([0])]),
      )
      const changed = await executeMurphDynamicToolRequest({
        currentResponseMedia: [],
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request: exactRequest,
        vaultRoot,
      })

      expect(exact.rpcResult.success).toBe(true)
      expect(exact.responseMediaPatch).toEqual({
        media: [EXACT_MEDIA],
        op: 'replace',
      })
      expect(mismatched.rpcResult.success).toBe(false)
      expect(mismatched.rpcResult.contentItems[0]?.text).toContain(
        'carries no authority for that tool action',
      )
      expect(changed.rpcResult.success).toBe(false)
      expect(changed.rpcResult.contentItems[0]?.text).toContain(
        'no longer matches its saved media',
      )
      expect(changed.responseMediaPatch).toEqual({
        media: [],
        op: 'replace',
      })
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })

  it('rejects a persisted physical-note completion outside the exact in-memory scope', async () => {
    const vaultRoot = await mkdtemp(path.join(
      os.tmpdir(),
      'assistant-image-completion-physical-note-',
    ))
    try {
      const imagePath = path.join(vaultRoot, EXACT_MEDIA.ref)
      await mkdir(path.dirname(imagePath), { recursive: true })
      await writeFile(imagePath, EXACT_IMAGE_BYTES)
      const completionText = renderAssistantHostedImageCompletionSystemText({
        originAssistantInputId: LATER_INPUT_ID,
        originAssistantInputIdExact: true,
        result: {
          media: EXACT_MEDIA,
          runtimeIssue: null,
          savedImageRef: EXACT_MEDIA.ref,
        },
      })
      const storedCompletion = await upsertAssistantInputEvent({
        event: {
          content: { text: completionText },
          occurredAt: '2026-08-09T12:00:00.000Z',
          receivedAt: '2026-08-09T12:00:00.000Z',
          sourceRef: {
            dedupeKey: 'image-completion-scope-mismatch',
            eventId: 'image-completion-scope-mismatch',
            itemId: 'image-completion-scope-mismatch',
            kind: 'hosted-mailbox',
            lane: 'system',
            laneSeq: 'image-completion-scope-mismatch',
            payloadSchema: 'murph.hosted-image-completion.v1',
            payloadSource: 'inline',
            source: 'hosted-mailbox',
            wakeSchema: 'murph.hosted-image-completion.v1',
          },
        },
        vault: vaultRoot,
      })
      const publishPrivateImageUrl = vi.fn()
      const send = vi.fn()
      const messageInput = createMessageInput({ vault: vaultRoot })
      messageInput.hostedImageCompletionEffectRestriction = {
        authorizedOriginAssistantInputId: ORIGIN_INPUT_ID,
        completionAssistantInputId: storedCompletion.inputId,
        exactMedia: [EXACT_MEDIA],
      }
      const hostedToolContext = createAssistantHostedToolContext({
        executionContext: {
          currentAssistantInputId: () => storedCompletion.inputId,
          memberId: 'member-completion-physical-note',
          physicalNotes: { send },
          privateImageUrlPublisher: { publishPrivateImageUrl },
          userEnvKeys: [],
        },
        getConversationScope: () => 'group',
        messageInput,
        session: createSession(),
      })

      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request: {
          kind: 'send-physical-note',
          recipient: {
            addressLine1: '123 Main St',
            city: 'Atlanta',
            name: 'Sam',
            postalCode: '30308',
            state: 'GA',
          },
        },
        vaultRoot,
      })

      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'exact trusted hosted image completion authorized for this turn',
      )
      expect(publishPrivateImageUrl).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })
})

function createMessageInput(input?: { vault?: string }): AssistantMessageInput {
  return {
    allowBindingRebind: false,
    approvalPolicy: null,
    channel: 'linq',
    codexHome: null,
    conversation: null,
    deliveryKind: 'thread',
    deliveryReplyToMessageId: null,
    deliverResponse: true,
    executionContext: null,
    hostedImageCompletionEffectRestriction: {
      authorizedOriginAssistantInputId: ORIGIN_INPUT_ID,
      completionAssistantInputId: COMPLETION_INPUT_ID,
      exactMedia: [EXACT_MEDIA],
    },
    includeEarlySessionOnboarding: false,
    model: 'gpt-5.4',
    modelProvider: 'openai',
    oss: false,
    persistUserPromptOnFailure: false,
    prompt: 'Trusted hosted image completion.',
    provider: 'codex-cli',
    reasoningEffort: null,
    sandbox: null,
    sessionId: 'session-completion-authority',
    threadId: 'linq-completion-authority',
    threadIsDirect: false,
    turnTrigger: 'automation-auto-reply',
    vault: input?.vault ?? '/vault',
    workingDirectory: input?.vault ?? '/work',
  }
}

function createSession(): AssistantSession {
  const target = createDefaultLocalAssistantModelTarget()
  if (!target) {
    throw new Error('Expected a default assistant model target.')
  }
  return {
    alias: null,
    binding: {
      actorId: null,
      channel: 'linq',
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: 'linq-completion-authority',
      threadIsDirect: false,
    },
    codexResume: null,
    codexTarget: target,
    conversationId: 'session-completion-authority',
    createdAt: '2026-08-08T16:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions: serializeAssistantProviderSessionOptions(
      normalizeAssistantProviderConfig({ provider: 'codex-cli' }),
    ),
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-completion-authority',
    target,
    turnCount: 0,
    updatedAt: '2026-08-08T16:00:00.000Z',
  }
}
