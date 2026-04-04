import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Box, Static, type Key } from 'ink'
import * as React from 'react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  listAssistantTranscriptEntries,
  readAssistantAutomationState,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantAutomationState,
} from '@murphai/assistant-core/assistant-state'
import { upsertAssistantMemory } from '@murphai/assistant-core/assistant/memory'
import { listPendingAssistantUsageRecords } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import { listAssistantTurnReceipts } from '@murphai/assistant-core/assistant/receipts'
import { readAssistantSession } from '@murphai/assistant-core/assistant/store/persistence'
import {
  buildAssistantProviderDefaultsPatch,
  resolveOperatorConfigPath,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '@murphai/assistant-core/operator-config'
import type { InboxServices } from '@murphai/assistant-core/inbox-services'
import {
  extractRecoveredAssistantSession,
  isAssistantProviderInterruptedError,
} from '@murphai/assistant-core/assistant/provider-turn-recovery'
import * as assistantAutomationArtifacts from '@murphai/assistant-core/assistant/automation/artifacts'
import {
  buildAssistantAutoReplyPrompt,
} from '@murphai/assistant-core/assistant/automation/prompt-builder'
import { sanitizeAssistantOutboundReply } from '@murphai/assistant-core/assistant/reply-sanitizer'
import {
  assertAssistantCronJobId,
  assertAssistantCronRunId,
  assertAssistantOutboxIntentId,
  assertAssistantSessionId,
  assertAssistantTurnId,
} from '@murphai/assistant-core/assistant/state-ids'

const runtimeMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurnAttempt: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
  routeInboxCaptureWithModel: vi.fn(),
  runAssistantChatWithInk: vi.fn(),
  resolveAssistantProviderCapabilities: vi.fn((provider: string) => ({
    supportsModelDiscovery: provider === 'openai-compatible',
    supportsNativeResume: true,
    supportsReasoningEffort: provider !== 'openai-compatible',
    supportsRichUserMessageContent: provider === 'openai-compatible',
  })),
  resolveAssistantProviderTargetCapabilities: vi.fn(
    (input: { provider?: string | null; baseUrl?: string | null }) => ({
      supportsModelDiscovery: input?.provider === 'openai-compatible',
      supportsNativeResume: true,
      supportsReasoningEffort:
        input?.provider === 'codex-cli' ||
        input?.baseUrl === 'https://api.openai.com/v1',
      supportsRichUserMessageContent: input?.provider === 'openai-compatible',
    }),
  ),
}))

vi.mock('../src/assistant-chat-ink.js', () => ({
  runAssistantChatWithInk: runtimeMocks.runAssistantChatWithInk,
}))

vi.mock('@murphai/assistant-core/outbound-channel', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-core/outbound-channel')>(
    '@murphai/assistant-core/outbound-channel',
  )

  return {
    ...actual,
    deliverAssistantMessageOverBinding:
      runtimeMocks.deliverAssistantMessageOverBinding,
  }
})

vi.mock('@murphai/assistant-core/assistant-provider', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-core/assistant-provider')>(
    '@murphai/assistant-core/assistant-provider',
  )

  return {
    ...actual,
    executeAssistantProviderTurnAttempt:
      runtimeMocks.executeAssistantProviderTurnAttempt,
    executeAssistantProviderTurn: runtimeMocks.executeAssistantProviderTurn,
    resolveAssistantProviderCapabilities:
      runtimeMocks.resolveAssistantProviderCapabilities,
    resolveAssistantProviderTargetCapabilities:
      runtimeMocks.resolveAssistantProviderTargetCapabilities,
  }
})

vi.mock('@murphai/assistant-core/inbox-model-harness', () => ({
  routeInboxCaptureWithModel: runtimeMocks.routeInboxCaptureWithModel,
}))

import {
  readAssistantStatusSnapshot,
  runAssistantAutomation,
  runAssistantChat,
  scanAssistantAutomationOnce,
  scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce,
  sendAssistantMessage,
} from '../src/assistant-runtime.js'
import { bridgeAbortSignals } from '@murphai/assistant-core/assistant/automation/shared'
import {
  CHAT_BANNER,
  CHAT_COMPOSER_HINT,
  CHAT_SLASH_COMMANDS,
  CHAT_STARTER_SUGGESTIONS,
  applyInkChatTraceUpdates,
  applyProviderProgressEventToEntries,
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  formatBusyStatus,
  formatChatMetadata,
  formatElapsedClock,
  formatSessionBinding,
  getMatchingSlashCommands,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  seedChatEntries,
  shouldShowChatComposerGuidance,
  shouldClearComposerForSubmitAction,
  type InkChatEntry,
} from '../src/assistant/ui/view-model.js'
import {
  DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS,
  DEFAULT_ASSISTANT_REASONING_OPTIONS,
} from '../src/assistant/provider-catalog.js'
import {
  applyComposerEditingInput,
  formatFooterBadgeText,
  formatAssistantTerminalHyperlink,
  formatQueuedFollowUpPreview,
  mergeComposerDraftWithQueuedPrompts,
  normalizeAssistantInkArrowKey,
  normalizeComposerInsertedText,
  partitionChatTranscriptEntries,
  reduceAssistantPromptQueueState,
  reduceAssistantTurnState,
  renderChatTranscriptFeed,
  renderComposerValue,
  renderWrappedPlainTextBlock,
  renderWrappedTextBlock,
  resolveAssistantTurnErrorPresentation,
  resolveAssistantChatViewportWidth,
  resolveAssistantInkInputAdapter,
  resolveAssistantPlainTextWrapColumns,
  resolveChromePanelBoxProps,
  resolveMessageRoleLabel,
  resolveAssistantHyperlinkTarget,
  resolveComposerTerminalAction,
  resolveComposerVerticalCursorMove,
  reconcileComposerControlledValue,
  resolveAssistantSelectionAfterSessionSync,
  shouldShowBusyStatus,
  resolveAssistantQueuedPromptDisposition,
  runAssistantPromptTurn,
  splitAssistantMarkdownLinks,
  supportsAssistantInkRawMode,
  supportsAssistantTerminalHyperlinks,
  wrapAssistantPlainText,
} from '../src/assistant/ui/ink.js'
import { LIGHT_ASSISTANT_INK_THEME } from '../src/assistant/ui/theme.js'

const cleanupPaths: string[] = []
const DEFAULT_CODEX_REASONING_EFFORT = 'medium'
const PHOTO_ONLY_CAPTURE_ID = 'cap-photo'
const PHOTO_ONLY_OCCURED_AT = '2026-03-18T09:00:00Z'
const PHOTO_ONLY_ATTACHMENT_BUFFER = Buffer.from([0xff, 0xd8, 0xff])
const OPENAI_COMPATIBLE_OPERATOR_DEFAULTS = buildAssistantProviderDefaultsPatch({
  defaults: null,
  provider: 'openai-compatible',
  providerConfig: {
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    providerName: 'ollama',
  },
})

function buildPhotoOnlyAutoReplyCapture() {
  return {
    captureId: PHOTO_ONLY_CAPTURE_ID,
    source: 'telegram' as const,
    accountId: 'bot',
    externalId: 'ext-photo',
    threadId: 'chat-photo',
    threadTitle: 'Photo Chat',
    threadIsDirect: true,
    actorId: 'user-1',
    actorName: 'Photo User',
    actorIsSelf: false,
    occurredAt: PHOTO_ONLY_OCCURED_AT,
    receivedAt: null,
    text: null,
    attachmentCount: 1,
    envelopePath: 'raw/inbox/photo.json',
    eventId: 'evt-photo',
    createdAt: PHOTO_ONLY_OCCURED_AT,
    promotions: [],
    attachments: [
      {
        attachmentId: 'att-photo',
        ordinal: 1,
        kind: 'image' as const,
        mime: 'image/jpeg',
        fileName: 'meal.jpg',
        storedPath: 'raw/inbox/captures/cap-photo/attachments/1/meal.jpg',
        transcriptText: null,
        extractedText: null,
        parseState: 'succeeded' as const,
      },
    ],
  }
}

function createPhotoOnlyAutoReplyInboxServices(): InboxServices {
  const capture = buildPhotoOnlyAutoReplyCapture()
  const unsupportedInboxServiceCall = async (): Promise<never> => {
    throw new Error('unexpected inbox service call in photo-only auto-reply test')
  }

  return {
    bootstrap: unsupportedInboxServiceCall,
    init: unsupportedInboxServiceCall,
    sourceAdd: unsupportedInboxServiceCall,
    sourceList: unsupportedInboxServiceCall,
    sourceRemove: unsupportedInboxServiceCall,
    sourceSetEnabled: unsupportedInboxServiceCall,
    doctor: unsupportedInboxServiceCall,
    setup: unsupportedInboxServiceCall,
    parse: unsupportedInboxServiceCall,
    requeue: unsupportedInboxServiceCall,
    backfill: unsupportedInboxServiceCall,
    run: unsupportedInboxServiceCall,
    status: unsupportedInboxServiceCall,
    stop: unsupportedInboxServiceCall,
    async list(input) {
      return {
        filters: {
          afterCaptureId: input.afterCaptureId ?? null,
          afterOccurredAt: input.afterOccurredAt ?? null,
          limit: input.limit ?? 50,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId ?? null,
        },
        items: [
          {
            captureId: capture.captureId,
            source: capture.source,
            accountId: capture.accountId,
            externalId: capture.externalId,
            threadId: capture.threadId,
            threadTitle: capture.threadTitle,
            threadIsDirect: capture.threadIsDirect,
            actorId: capture.actorId,
            actorName: capture.actorName,
            actorIsSelf: capture.actorIsSelf,
            occurredAt: capture.occurredAt,
            receivedAt: capture.receivedAt,
            text: capture.text,
            attachmentCount: capture.attachmentCount,
            envelopePath: capture.envelopePath,
            eventId: capture.eventId,
            promotions: capture.promotions,
          },
        ],
        vault: input.vault,
      }
    },
    listAttachments: unsupportedInboxServiceCall,
    showAttachment: unsupportedInboxServiceCall,
    showAttachmentStatus: unsupportedInboxServiceCall,
    parseAttachment: unsupportedInboxServiceCall,
    reparseAttachment: unsupportedInboxServiceCall,
    async show(input) {
      return {
        capture,
        vault: input.vault,
      }
    },
    search: unsupportedInboxServiceCall,
    promoteMeal: unsupportedInboxServiceCall,
    promoteDocument: unsupportedInboxServiceCall,
    promoteJournal: unsupportedInboxServiceCall,
    promoteExperimentNote: unsupportedInboxServiceCall,
  }
}

async function createPhotoOnlyAutoReplyFixture(prefix: string): Promise<{
  homeRoot: string
  inboxServices: InboxServices
  vaultRoot: string
}> {
  const parent = await mkdtemp(path.join(tmpdir(), prefix))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  cleanupPaths.push(parent)

  const attachmentDirectory = path.join(
    vaultRoot,
    'raw',
    'inbox',
    'captures',
    PHOTO_ONLY_CAPTURE_ID,
    'attachments',
    '1',
  )
  await mkdir(attachmentDirectory, { recursive: true })
  await writeFile(
    path.join(attachmentDirectory, 'meal.jpg'),
    PHOTO_ONLY_ATTACHMENT_BUFFER,
  )

  return {
    homeRoot,
    inboxServices: createPhotoOnlyAutoReplyInboxServices(),
    vaultRoot,
  }
}

async function withTemporaryHome<T>(
  homeRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    return await run()
  } finally {
    process.env.HOME = originalHome
  }
}

function mockSuccessfulPhotoOnlyAutoReply(): void {
  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'logged it',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'chat-photo',
      targetKind: 'thread',
      sentAt: '2026-03-18T09:00:05Z',
      messageLength: 9,
    },
  })
}

function createComposerKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

beforeEach(() => {
  runtimeMocks.deliverAssistantMessageOverBinding.mockReset()
  runtimeMocks.executeAssistantProviderTurnAttempt.mockReset()
  runtimeMocks.executeAssistantProviderTurn.mockReset()
  runtimeMocks.routeInboxCaptureWithModel.mockReset()
  runtimeMocks.runAssistantChatWithInk.mockReset()
  runtimeMocks.resolveAssistantProviderCapabilities.mockReset()
  runtimeMocks.resolveAssistantProviderCapabilities.mockImplementation((provider: string) => ({
    supportsModelDiscovery: provider === 'openai-compatible',
    supportsNativeResume: true,
    supportsReasoningEffort: provider !== 'openai-compatible',
    supportsRichUserMessageContent: provider === 'openai-compatible',
  }))
  runtimeMocks.resolveAssistantProviderTargetCapabilities.mockReset()
  runtimeMocks.resolveAssistantProviderTargetCapabilities.mockImplementation(
    (input: { provider?: string | null; baseUrl?: string | null }) => ({
      supportsModelDiscovery: input?.provider === 'openai-compatible',
      supportsNativeResume: true,
      supportsReasoningEffort:
        input?.provider === 'codex-cli' ||
        input?.baseUrl === 'https://api.openai.com/v1',
      supportsRichUserMessageContent: input?.provider === 'openai-compatible',
    }),
  )
  runtimeMocks.executeAssistantProviderTurnAttempt.mockImplementation(
    async (...args: Parameters<typeof runtimeMocks.executeAssistantProviderTurn>) => {
      try {
        return {
          metadata: {
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: true,
          result: await runtimeMocks.executeAssistantProviderTurn(...args),
        }
      } catch (error) {
        return {
          error,
          metadata: {
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: false,
        }
      }
    },
  )
})



test('sendAssistantMessage keeps older local history in raw transcript files without synthetic continuity summaries', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-long-history-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockImplementation(async () => ({
    provider: 'codex-cli',
    providerSessionId: 'distill-thread-123',
    response: 'acknowledged',
    stderr: '',
    stdout: '',
    rawEvents: [],
  }))

  let latest = null as Awaited<ReturnType<typeof sendAssistantMessage>> | null
  for (let index = 0; index < 9; index += 1) {
    latest = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:distill',
      channel: 'imessage',
      identityId: 'assistant:primary',
      participantId: 'contact:distill',
      sourceThreadId: 'chat-distill',
      provider: 'codex-cli',
      prompt: `What changed on day ${index + 1}?`,
      sandbox: 'read-only',
      approvalPolicy: 'never',
    })
  }

  assert.ok(latest)
  const providerCalls = runtimeMocks.executeAssistantProviderTurn.mock.calls.map(
    (call) => call[0],
  )
  const latestProviderCall = providerCalls.at(-1)
  assert.equal(latestProviderCall?.continuityContext, null)
  assert.equal((latestProviderCall?.conversationMessages?.length ?? 0) > 0, true)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const stateEntries = await readdir(statePaths.assistantStateRoot)
  assert.equal(stateEntries.includes('distillations'), false)

  const receipts = await listAssistantTurnReceipts(vaultRoot)
  assert.ok(receipts[0])
})

test('sendAssistantMessage chains official OpenAI responses while retaining local transcript continuity without distillation', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-openai-responses-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  let responseCounter = 0
  runtimeMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    responseCounter += 1
    return {
      provider: 'openai-compatible',
      providerOptions: {
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
        providerName: 'openai',
      },
      providerSessionId: `resp_${responseCounter}`,
      response: `acknowledged ${responseCounter}`,
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  let latest = null as Awaited<ReturnType<typeof sendAssistantMessage>> | null
  for (let index = 0; index < 9; index += 1) {
    latest = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:openai-responses',
      channel: 'imessage',
      identityId: 'assistant:primary',
      participantId: 'contact:openai',
      sourceThreadId: 'chat-openai',
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'openai',
      model: 'gpt-5',
      prompt: `What changed on day ${index + 1}?`,
    })
  }

  assert.ok(latest)

  const providerCalls = runtimeMocks.executeAssistantProviderTurn.mock.calls.map(
    (call) => call[0],
  )
  assert.equal(providerCalls[0]?.resumeProviderSessionId, null)
  assert.equal(providerCalls[1]?.resumeProviderSessionId, 'resp_1')
  assert.deepEqual(providerCalls[1]?.conversationMessages, [
    {
      content: 'What changed on day 1?',
      role: 'user',
    },
    {
      content: 'acknowledged 1',
      role: 'assistant',
    },
  ])
  assert.equal(providerCalls[1]?.continuityContext, null)
  assert.equal(typeof providerCalls[1]?.systemPrompt, 'string')

  const receipts = await listAssistantTurnReceipts(vaultRoot)
  assert.ok(receipts[0])
})

test('sanitizeAssistantOutboundReply removes local source scaffolding for outbound channels', () => {
  const sanitized = sanitizeAssistantOutboundReply(
    [
      'From vault/journal/2026-03-29.md: Sleep consistency looked better this week.',
      'See [the note](/tmp/redacted/journal/2026-03-29.md) for context.',
      '[Source: raw/inbox/imessage.json]',
      'In research/weekly-summary.md: Keep the bedtime window narrow.',
      '',
      '',
      'Done.',
    ].join('\n'),
    'imessage',
  )

  assert.equal(
    sanitized,
    [
      'Sleep consistency looked better this week.',
      'See the note for context.',
      'Keep the bedtime window narrow.',
      '',
      'Done.',
    ].join('\n'),
  )
})

test('assistant runtime opaque ids reject traversal-shaped values', () => {
  assert.equal(assertAssistantSessionId('session_safe'), 'session_safe')
  assert.equal(assertAssistantTurnId('turn_safe'), 'turn_safe')
  assert.equal(assertAssistantOutboxIntentId('outbox_safe'), 'outbox_safe')
  assert.equal(assertAssistantCronJobId('cron_safe'), 'cron_safe')
  assert.equal(assertAssistantCronRunId('cronrun_safe'), 'cronrun_safe')

  assert.throws(
    () => assertAssistantSessionId('../escape'),
    /opaque runtime ids/u,
  )
  assert.throws(
    () => assertAssistantTurnId('turn/escape'),
    /opaque runtime ids/u,
  )
  assert.throws(
    () => assertAssistantOutboxIntentId(''),
    /opaque runtime ids/u,
  )
  assert.throws(
    () => assertAssistantCronJobId('../cron-escape'),
    /opaque runtime ids/u,
  )
  assert.throws(
    () => assertAssistantCronRunId('cronrun/escape'),
    /opaque runtime ids/u,
  )
})

test('sendAssistantMessage persists only assistant session metadata and reuses provider sessions via alias keys', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-123',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-123',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const first = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-123',
    provider: 'codex-cli',
    prompt: 'What did Bob eat?',
    reasoningEffort: 'xhigh',
    sandbox: 'read-only',
    approvalPolicy: 'never',
  })

  const second = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    prompt: 'What about today?',
  })

  assert.equal(first.session.turnCount, 1)
  assert.equal(first.session.providerBinding?.providerSessionId, 'thread-123')
  assert.equal(first.session.alias, 'imessage:bob')
  assert.equal(first.delivery, null)
  assert.equal(first.deliveryError, null)
  assert.equal(first.session.binding.channel, 'imessage')
  assert.equal(first.session.binding.actorId, 'contact:bob')
  assert.equal(first.session.binding.threadId, 'chat-123')
  assert.equal('vault' in first.session, false)
  assert.equal('stateRoot' in first.session, false)
  assert.equal(second.session.sessionId, first.session.sessionId)
  assert.equal(second.session.turnCount, 2)
  assert.equal('lastUserMessage' in second.session, false)
  assert.equal('lastAssistantMessage' in second.session, false)

  const firstCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall.resumeProviderSessionId, null)
  assert.equal(secondCall.resumeProviderSessionId, 'thread-123')
  assert.equal(firstCall.reasoningEffort, 'xhigh')
  assert.equal(secondCall.reasoningEffort, 'xhigh')
  assert.match(firstCall.systemPrompt ?? '', /You are Murph/u)
  assert.equal(firstCall.userPrompt, 'What did Bob eat?')
  assert.equal(firstCall.sessionContext?.binding.channel, 'imessage')
  assert.equal(typeof secondCall.systemPrompt, 'string')
  assert.equal(secondCall.userPrompt, 'What about today?')
})

test('sendAssistantMessage does not persist hosted usage records without hosted execution context', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-usage-123',
    response: 'usage reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
    usage: {
      apiKeyEnv: null,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: 12,
      outputTokens: 7,
      providerMetadataJson: null,
      providerName: null,
      providerRequestId: 'req_123',
      rawUsageJson: {
        inputTokens: 12,
        outputTokens: 7,
      },
      reasoningTokens: null,
      requestedModel: 'gpt-5',
      servedModel: 'gpt-5',
      totalTokens: 19,
    },
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-123',
    provider: 'codex-cli',
    prompt: 'Count my tokens.',
  })

  const usageEntries = await listDirectoryEntries(
    resolveAssistantStatePaths(vaultRoot).usagePendingDirectory,
  )

  assert.deepEqual(usageEntries, [])
})

test('sendAssistantMessage defaults Codex reasoning to the Murph-owned default', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-default-reasoning-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-default-reasoning',
    response: 'default reasoning reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-123',
    provider: 'codex-cli',
    prompt: 'Use the normal default.',
  })

  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(
    providerCall?.reasoningEffort,
    DEFAULT_CODEX_REASONING_EFFORT,
  )
  assert.equal(
    result.session.providerOptions.reasoningEffort,
    DEFAULT_CODEX_REASONING_EFFORT,
  )
})

test('sendAssistantMessage freezes hosted usage credential ownership from the provided execution context', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-usage-456',
    response: 'usage reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
    usage: {
      apiKeyEnv: null,
      baseUrl: null,
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: 12,
      outputTokens: 7,
      providerMetadataJson: null,
      providerName: null,
      providerRequestId: 'req_456',
      rawUsageJson: {
        inputTokens: 12,
        outputTokens: 7,
      },
      reasoningTokens: null,
      requestedModel: 'gpt-5',
      servedModel: 'gpt-5',
      totalTokens: null,
    },
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    executionContext: {
      hosted: {
        memberId: 'member_123',
        userEnvKeys: ['VENICE_API_KEY'],
      },
    },
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-123',
    provider: 'codex-cli',
    prompt: 'Count my tokens.',
  })

  const usageEntries = await listPendingAssistantUsageRecords({
    vault: vaultRoot,
  })

  assert.equal(usageEntries.length, 1)
  assert.equal(usageEntries[0]?.credentialSource, 'unknown')
  assert.equal(usageEntries[0]?.totalTokens, null)
  assert.equal(usageEntries[0]?.usageId.endsWith('.attempt-1'), true)
})

test('sendAssistantMessage recovers provider sessions after user interruptions and preserves the interrupt marker', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-interrupt-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const abortController = new AbortController()
  runtimeMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_INTERRUPTED',
      'Codex CLI was interrupted.',
      {
        interrupted: true,
        providerSessionId: 'thread-pause-1',
      },
    ),
  )

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:bob',
      prompt: 'Pause this turn.',
      abortSignal: abortController.signal,
      provider: 'codex-cli',
    }),
    (error: any) => {
      assert.equal(isAssistantProviderInterruptedError(error), true)
      const recoveredSession = extractRecoveredAssistantSession(error)
      assert.equal(
        recoveredSession?.providerBinding?.providerSessionId,
        'thread-pause-1',
      )
      return true
    },
  )

  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(providerCall?.abortSignal, abortController.signal)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'imessage:bob',
    provider: 'codex-cli',
    model: null,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    oss: false,
    profile: null,
    reasoningEffort: null,
    maxSessionAgeMs: null,
  })

  assert.equal(
    resolved.session.providerBinding?.providerSessionId ?? null,
    'thread-pause-1',
  )
  assert.equal(resolved.session.turnCount, 0)
})

test('sendAssistantMessage can optionally deliver the provider reply over the mapped outbound channel', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-delivery-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'sent reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(
    async (input: { message: string; sessionId: string }) => ({
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-123',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: 'imessage:bob',
        binding: {
          conversationKey: 'channel:imessage|actor:%2B15551234567',
          channel: 'imessage',
          identityId: null,
          actorId: '+15551234567',
          threadId: null,
          threadIsDirect: null,
          delivery: {
            kind: 'participant',
            target: '+15551234567',
          },
        },
        createdAt: '2026-03-16T00:00:00.000Z',
        updatedAt: '2026-03-16T00:00:01.000Z',
        lastTurnAt: '2026-03-16T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'imessage',
        target: '+15551234567',
        targetKind: 'participant',
        sentAt: '2026-03-16T00:00:01.000Z',
        messageLength: input.message.length,
      },
    }),
  )

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    participantId: '+15551234567',
    prompt: 'send it',
    deliverResponse: true,
  })

  assert.equal(result.response, 'sent reply')
  assert.equal(result.delivery?.channel, 'imessage')
  assert.equal(result.delivery?.target, '+15551234567')
  assert.equal(result.deliveryError, null)
  const deliveryCall = runtimeMocks.deliverAssistantMessageOverBinding.mock.calls[0]?.[0]
  assert.equal(deliveryCall?.sessionId, result.session.sessionId)
  assert.equal(deliveryCall?.session?.binding.channel, 'imessage')
  assert.equal(deliveryCall?.session?.binding.identityId, null)
  assert.equal(deliveryCall?.session?.binding.actorId, '+15551234567')
  assert.equal(deliveryCall?.session?.binding.threadId, null)
  assert.equal(deliveryCall?.session?.binding.threadIsDirect, null)
  assert.equal(deliveryCall?.target, null)
  assert.equal(deliveryCall?.message, 'sent reply')
})

test('sendAssistantMessage keeps provider success and session updates even when outbound delivery fails', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-delivery-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-500',
    response: 'reply persisted',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockRejectedValue(
    Object.assign(new Error('delivery exploded'), {
      code: 'ASSISTANT_CHANNEL_DELIVERY_FAILED',
    }),
  )

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    participantId: '+15551234567',
    prompt: 'send anyway',
    deliverResponse: true,
  })

  assert.equal(result.response, 'reply persisted')
  assert.equal(result.delivery, null)
  assert.deepEqual(result.deliveryError, {
    code: 'ASSISTANT_CHANNEL_DELIVERY_FAILED',
    message: 'delivery exploded',
  })
  assert.equal(result.session.providerBinding?.providerSessionId, 'thread-500')
  assert.equal('lastAssistantMessage' in result.session, false)
})

test('sendAssistantMessage reuses saved assistant model defaults and persists reasoning effort metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-defaults',
    response: 'defaults reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        provider: 'codex-cli',
        providerConfig: {
          model: 'gpt-5.4-mini',
          reasoningEffort: 'high',
          oss: false,
        },
      }),
      homeRoot,
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'reuse defaults',
    })

    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(providerCall.model, 'gpt-5.4-mini')
    assert.equal(providerCall.reasoningEffort, 'high')
    assert.equal(result.session.providerOptions.model, 'gpt-5.4-mini')
    assert.equal(result.session.providerOptions.reasoningEffort, 'high')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage reuses saved OpenAI-compatible assistant defaults', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-openai-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot
  const originalApiKey = process.env.OLLAMA_API_KEY
  process.env.OLLAMA_API_KEY = 'secret-token'

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'defaults reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        provider: 'openai-compatible',
        providerConfig: {
          model: 'gpt-oss:20b',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
          headers: {
            'X-Test': 'hello',
          },
        },
      }),
      homeRoot,
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'reuse openai-compatible defaults',
    })

    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(providerCall.provider, 'openai-compatible')
    assert.equal(providerCall.model, 'gpt-oss:20b')
    assert.equal(providerCall.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(providerCall.apiKeyEnv, 'OLLAMA_API_KEY')
    assert.equal(providerCall.providerName, 'ollama')
    assert.deepEqual(providerCall.headers, {
      'X-Test': 'hello',
    })
    assert.equal(result.session.provider, 'openai-compatible')
    assert.equal(result.session.providerOptions.model, 'gpt-oss:20b')
    assert.equal(result.session.providerOptions.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(result.session.providerOptions.apiKeyEnv, 'OLLAMA_API_KEY')
    assert.equal(result.session.providerOptions.providerName, 'ollama')
    assert.deepEqual(result.session.providerOptions.headers, {
      'X-Test': 'hello',
    })
  } finally {
    restoreEnvironmentVariable('OLLAMA_API_KEY', originalApiKey)
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage stores prompt and response excerpts in the local assistant transcript without adding them to session metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-summary-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const longPrompt = `prompt ${'x'.repeat(400)}`
  const longResponse = `response ${'y'.repeat(400)}`

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-999',
    response: longResponse,
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'telegram:bob',
    prompt: longPrompt,
  })

  assert.equal('lastUserMessage' in result.session, false)
  assert.equal('lastAssistantMessage' in result.session, false)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const persisted = JSON.parse(
    await readFile(
      path.join(statePaths.sessionsDirectory, `${result.session.sessionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
  assert.equal('lastUserMessage' in persisted, false)
  assert.equal('lastAssistantMessage' in persisted, false)

  const transcript = await listAssistantTranscriptEntries(
    vaultRoot,
    result.session.sessionId,
  )
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: longPrompt,
      },
      {
        kind: 'assistant',
        text: longResponse,
      },
    ],
  )
})

test('sendAssistantMessage redacts vault paths under HOME in returned output', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-home-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-home',
    response: 'home-safe reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:bob',
      prompt: 'Keep paths private.',
    })

    assert.equal(result.vault, path.join('~', 'vault'))
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage applies assistant defaults from operator config when flags are omitted', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-defaults',
    response: 'defaulted reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const configPath = resolveOperatorConfigPath(homeRoot)
    await mkdir(path.dirname(configPath), {
      recursive: true,
    })
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          schema: 'murph.operator-config.v1',
          defaultVault: null,
          assistant: {
            backend: {
              adapter: 'codex-cli',
              model: 'gpt-oss:20b',
              endpoint: null,
              apiKeyEnv: null,
              providerName: null,
              headers: null,
              options: {
                codexCommand: '/opt/bin/codex',
                sandbox: 'danger-full-access',
                approvalPolicy: 'never',
                profile: 'ops',
                oss: true,
              },
            },
            identityId: 'assistant:primary',
            account: {
              source: 'codex-rpc+codex-auth-json',
              kind: 'account',
              planCode: 'pro',
              planName: 'Pro',
              quota: {
                creditsRemaining: 12,
                creditsUnlimited: false,
                primaryWindow: {
                  usedPercent: 40,
                  remainingPercent: 60,
                  windowMinutes: 300,
                  resetsAt: '2026-03-25T10:00:00.000Z',
                },
                secondaryWindow: null,
              },
            },
            selfDeliveryTargets: null,
          },
          updatedAt: '2026-03-17T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'defaults:bob',
      prompt: 'use defaults',
    })

    assert.equal(result.session.binding.identityId, 'assistant:primary')
    assert.equal(result.session.providerOptions.model, 'gpt-oss:20b')
    assert.equal(result.session.providerOptions.sandbox, 'danger-full-access')
    assert.equal(result.session.providerOptions.approvalPolicy, 'never')
    assert.equal(result.session.providerOptions.profile, 'ops')
    assert.equal(result.session.providerOptions.oss, true)

    const call = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(call?.codexCommand, '/opt/bin/codex')
    assert.equal(call?.model, 'gpt-oss:20b')
    assert.equal(call?.sandbox, 'danger-full-access')
    assert.equal(call?.approvalPolicy, 'never')
    assert.equal(call?.profile, 'ops')
    assert.equal(call?.oss, true)
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('scanAssistantInboxOnce skips completed captures, waits for parsers, routes canonical writes, and records failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-scan-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(path.join(vaultRoot, 'derived', 'inbox', 'cap-existing', 'assistant'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'derived', 'inbox', 'cap-existing', 'assistant', 'result.json'),
    '{"ok":true}\n',
    'utf8',
  )

  runtimeMocks.routeInboxCaptureWithModel.mockImplementation(async ({ captureId }) => {
    if (captureId === 'cap-noop') {
      return {
        plan: {
          actions: [],
        },
      }
    }

    if (captureId === 'cap-route') {
      return {
        plan: {
          actions: [
            {
              tool: 'meal.add',
            },
          ],
        },
      }
    }

    if (captureId === 'cap-fail') {
      throw new Error('route exploded')
    }

    throw new Error(`Unexpected route capture: ${captureId}`)
  })

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const listCalls: unknown[] = []
  const cursorProgress: Array<{ occurredAt: string; captureId: string } | null> = []
  const inboxServices = {
    list: async (input: unknown) => {
      listCalls.push(input)
      return {
      items: [
        {
          captureId: 'cap-existing',
          occurredAt: '2026-03-16T16:00:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-promoted',
          occurredAt: '2026-03-16T16:01:00Z',
          promotions: [{}],
        },
        {
          captureId: 'cap-pending',
          occurredAt: '2026-03-16T16:02:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-noop',
          occurredAt: '2026-03-16T16:03:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-route',
          occurredAt: '2026-03-16T16:04:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-fail',
          occurredAt: '2026-03-16T16:05:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-show-fail',
          occurredAt: '2026-03-16T16:06:00Z',
          promotions: [],
        },
      ],
    }
    },
    show: async ({ captureId }: { captureId: string }) => {
      if (captureId === 'cap-show-fail') {
        throw new Error('show exploded')
      }

      return {
        capture: {
          attachments:
            captureId === 'cap-pending'
              ? [
                  {
                    parseState: 'pending',
                  },
                ]
              : [
                  {
                    parseState: 'succeeded',
                  },
                ],
        },
      }
    },
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    afterCursor: {
      occurredAt: '2026-03-16T15:59:00Z',
      captureId: 'cap-before',
    },
    oldestFirst: true,
    onCursorProgress(cursor) {
      cursorProgress.push(cursor)
    },
    onEvent(event) {
      events.push({
        type: event.type,
        captureId: event.captureId,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 7,
    failed: 2,
    noAction: 1,
    routed: 1,
    skipped: 3,
  })
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.routed' && event.captureId === 'cap-route',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.failed' &&
        event.captureId === 'cap-show-fail' &&
        event.details === 'show exploded',
    ),
    true,
  )
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: '2026-03-16T15:59:00Z',
      afterCaptureId: 'cap-before',
      oldestFirst: true,
    },
  ])
  assert.deepEqual(cursorProgress, [
    {
      occurredAt: '2026-03-16T16:06:00Z',
      captureId: 'cap-show-fail',
    },
  ])
})

test('assistant operator config keeps nested provider defaults across unrelated writes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-config-'))
  const homeRoot = path.join(parent, 'home')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  const configPath = resolveOperatorConfigPath(homeRoot)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schema: 'murph.operator-config.v1',
        defaultVault: null,
        assistant: {
          backend: {
            adapter: 'openai-compatible',
            model: 'llama3.2:latest',
            endpoint: 'http://127.0.0.1:11434/v1',
            apiKeyEnv: 'OLLAMA_API_KEY',
            providerName: 'ollama',
            headers: {
              Authorization: 'Bearer override-token',
              'X-Foo': 'bar',
            },
            options: null,
          },
          identityId: 'assistant:primary',
          failoverRoutes: null,
          account: null,
          selfDeliveryTargets: null,
        },
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await saveAssistantOperatorDefaultsPatch(
    {
      selfDeliveryTargets: {
        telegram: {
          channel: 'telegram',
          identityId: null,
          participantId: 'contact:alice',
          sourceThreadId: 'chat-1',
          deliveryTarget: 'chat-1',
        },
      },
    },
    homeRoot,
  )

  const defaults = await resolveAssistantOperatorDefaults(homeRoot)
  const providerDefaults = resolveAssistantProviderDefaults(
    defaults,
    'openai-compatible',
  )
  assert.equal(defaults?.backend?.adapter, 'openai-compatible')
  assert.equal(providerDefaults?.model, 'llama3.2:latest')
  assert.equal(providerDefaults?.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(providerDefaults?.apiKeyEnv, 'OLLAMA_API_KEY')
  assert.equal(providerDefaults?.providerName, 'ollama')
  assert.deepEqual(providerDefaults?.headers, {
    Authorization: 'Bearer override-token',
    'X-Foo': 'bar',
  })
  assert.equal(defaults?.selfDeliveryTargets?.telegram?.deliveryTarget, 'chat-1')

  const stored = JSON.parse(await readFile(configPath, 'utf8')) as {
    assistant?: Record<string, unknown> & {
      backend?: Record<string, unknown>
    }
  }
  assert.equal('model' in (stored.assistant ?? {}), false)
  assert.equal('baseUrl' in (stored.assistant ?? {}), false)
  assert.equal('apiKeyEnv' in (stored.assistant ?? {}), false)
  assert.deepEqual(stored.assistant?.backend, {
    adapter: 'openai-compatible',
    model: 'llama3.2:latest',
    endpoint: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    providerName: 'ollama',
    headers: {
      Authorization: 'Bearer override-token',
      'X-Foo': 'bar',
    },
    options: null,
  })
})

test('updating the saved backend target replaces the previous backend cleanly', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-provider-map-'))
  const homeRoot = path.join(parent, 'home')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await saveAssistantOperatorDefaultsPatch(
    buildAssistantProviderDefaultsPatch({
      defaults: null,
      provider: 'codex-cli',
      providerConfig: {
        codexCommand: '/opt/bin/codex',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        profile: 'ops',
        oss: true,
      },
    }),
    homeRoot,
  )

  const existing = await resolveAssistantOperatorDefaults(homeRoot)
  await saveAssistantOperatorDefaultsPatch(
    buildAssistantProviderDefaultsPatch({
      defaults: existing,
      provider: 'openai-compatible',
      providerConfig: {
        model: 'gpt-oss:20b',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKeyEnv: 'OLLAMA_API_KEY',
        providerName: 'ollama',
        headers: {
          Authorization: 'Bearer override-token',
        },
      },
    }),
    homeRoot,
  )

  const updated = await resolveAssistantOperatorDefaults(homeRoot)
  assert.deepEqual(updated?.backend, {
    adapter: 'openai-compatible',
    model: 'gpt-oss:20b',
    endpoint: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    providerName: 'ollama',
    headers: {
      Authorization: 'Bearer override-token',
    },
    options: null,
  })
})

test('readAssistantSession rejects legacy codexPromptVersion session records', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-legacy-session-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:legacy-codex-version',
    provider: 'codex-cli',
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  const sessionPath = path.join(
    paths.sessionsDirectory,
    `${resolved.session.sessionId}.json`,
  )
  await writeFile(
    sessionPath,
    `${JSON.stringify(
      {
        ...resolved.session,
        provider: 'codex-cli',
        providerState: undefined,
        providerOptions: {
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          profile: null,
          oss: false,
        },
        codexPromptVersion: '2026-03-20.1',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await assert.rejects(
    readAssistantSession({
      paths,
      sessionId: resolved.session.sessionId,
    }),
  )
})


test('scanAssistantInboxOnce bypasses parser waits for supported pending meal photos', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-scan-photo-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.routeInboxCaptureWithModel.mockResolvedValue({
    plan: {
      actions: [
        {
          tool: 'meal.add',
        },
      ],
    },
  })

  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-photo',
          occurredAt: '2026-03-16T16:10:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'image',
            fileName: 'meal.jpg',
            mediaType: 'image/jpeg',
            storedPath: 'attachments/2026/03/16/meal.jpg',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 1)
  assert.equal(
    runtimeMocks.routeInboxCaptureWithModel.mock.calls[0]?.[0]?.captureId,
    'cap-photo',
  )
})

test('scanAssistantInboxOnce still waits for pending document parsers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-scan-doc-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; details?: string }> = []
  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-doc',
          occurredAt: '2026-03-16T16:11:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'document',
            fileName: 'report.pdf',
            mediaType: 'application/pdf',
            storedPath: 'attachments/2026/03/16/report.pdf',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    onEvent(event) {
      events.push({
        type: event.type,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 0)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.skipped' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
})

test('scanAssistantAutomationOnce keeps the routing cursor pinned when a capture is waiting on parser completion', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-unified-parser-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const stateProgress: Array<{
    inboxScanCursor: { occurredAt: string; captureId: string } | null
    autoReplyScanCursor: { occurredAt: string; captureId: string } | null
  }> = []

  const result = await scanAssistantAutomationOnce({
    inboxServices: {
      list: async () => ({
        items: [
          {
            captureId: 'cap-pdf-pending',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-pdf',
            threadId: 'thread-pdf',
            threadTitle: 'Scanned receipt',
            actorId: 'sender@example.com',
            actorName: 'Sender',
            actorIsSelf: false,
            occurredAt: '2026-03-16T16:12:00Z',
            receivedAt: null,
            text: 'See attached.',
            attachmentCount: 1,
            envelopePath: 'raw/inbox/pending.pdf.json',
            eventId: 'evt-pdf',
            promotions: [],
          },
        ],
      }),
      show: async () => ({
        capture: {
          captureId: 'cap-pdf-pending',
          source: 'email',
          threadTitle: 'Scanned receipt',
          threadId: 'thread-pdf',
          threadIsDirect: true,
          actorId: 'sender@example.com',
          actorName: 'Sender',
          actorIsSelf: false,
          occurredAt: '2026-03-16T16:12:00Z',
          text: 'See attached.',
          attachments: [
            {
              attachmentId: 'att-pdf',
              fileName: 'receipt.pdf',
              mediaType: 'application/pdf',
              storedPath: 'raw/inbox/receipt.pdf',
              parseState: 'pending',
            },
          ],
        },
      }),
    } as any,
    modelSpec: {
      model: 'gpt-oss:20b',
    },
    state: {
      inboxScanCursor: null,
      autoReplyScanCursor: null,
      autoReplyChannels: [],
      autoReplyBacklogChannels: [],
      autoReplyPrimed: true,
    },
    vault: vaultRoot,
    async onStateProgress(next) {
      stateProgress.push({
        inboxScanCursor: next.inboxScanCursor,
        autoReplyScanCursor: next.autoReplyScanCursor,
      })
    },
  })

  assert.deepEqual(result, {
    routing: {
      considered: 1,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 1,
    },
    replies: {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    },
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 0)
  assert.deepEqual(stateProgress, [])
})

test('scanAssistantAutomationOnce preserves other enabled channels while draining email backlog', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-unified-backlog-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-email-backlog',
      response: 'email backlog reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'chat-imessage',
      response: 'imessage reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => {
    const channel = input.channel ?? input.session?.binding?.channel
    const actorId = input.actorId ?? input.session?.binding?.actorId
    const threadId = input.threadId ?? input.session?.binding?.threadId
    const threadIsDirect =
      input.threadIsDirect ?? input.session?.binding?.threadIsDirect ?? true

    return {
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: threadId,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: `channel:${channel}|thread:${threadId}`,
          channel,
          identityId: null,
          actorId,
          threadId,
          threadIsDirect,
          delivery: {
            kind: channel === 'imessage' ? 'participant' : 'thread',
            target: actorId,
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel,
        target: actorId,
        targetKind: channel === 'imessage' ? 'participant' : 'thread',
        sentAt:
          channel === 'imessage'
            ? '2026-03-18T09:05:30.000Z'
            : '2026-03-18T09:00:30.000Z',
        messageLength: input.message.length,
      },
    }
  })

  const emailBacklogCapture = {
    captureId: 'cap-email-backlog',
    source: 'email',
    accountId: 'self',
    externalId: 'ext-email-backlog',
    threadId: 'thread-email-backlog',
    threadTitle: 'Backlog thread',
    actorId: 'backlog@example.com',
    actorName: 'Backlog User',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:00:00Z',
    receivedAt: null,
    text: 'Please follow up on this older email.',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/email-backlog.json',
    eventId: 'evt-email-backlog',
    promotions: [],
  }
  const imessageCapture = {
    captureId: 'cap-imessage-new',
    source: 'imessage',
    accountId: 'self',
    externalId: 'ext-imessage-new',
    threadId: 'chat-imessage',
    threadTitle: null,
    actorId: '+15550001111',
    actorName: 'New Texter',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:05:00Z',
    receivedAt: null,
    text: 'Can you answer this after the email backlog?',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/imessage-new.json',
    eventId: 'evt-imessage-new',
    promotions: [],
  }

  let state: Parameters<typeof scanAssistantAutomationOnce>[0]['state'] = {
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: ['email', 'imessage'],
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: false,
  }
  const stateProgress: Array<{
    autoReplyBacklogChannels: string[]
    autoReplyPrimed: boolean
    autoReplyScanCursor: { occurredAt: string; captureId: string } | null
  }> = []

  const inboxServices = {
    async list(input: any) {
      if (input.afterCaptureId === 'cap-email-backlog') {
        return {
          items: [imessageCapture],
        }
      }

      return {
        items: [emailBacklogCapture, imessageCapture],
      }
    },
    async show(input: any) {
      if (input.captureId === emailBacklogCapture.captureId) {
        return {
          capture: {
            captureId: emailBacklogCapture.captureId,
            source: 'email',
            threadTitle: 'Backlog thread',
            threadId: 'thread-email-backlog',
            threadIsDirect: true,
            actorId: 'backlog@example.com',
            actorName: 'Backlog User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            text: 'Please follow up on this older email.',
            attachments: [],
          },
        }
      }

      assert.equal(input.captureId, imessageCapture.captureId)
      return {
        capture: {
          captureId: imessageCapture.captureId,
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-imessage',
          threadIsDirect: true,
          actorId: '+15550001111',
          actorName: 'New Texter',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'Can you answer this after the email backlog?',
          attachments: [],
        },
      }
    },
  } as any

  async function runScan() {
    return scanAssistantAutomationOnce({
      inboxServices,
      state,
      vault: vaultRoot,
      async onStateProgress(next) {
        state = {
          ...state,
          ...next,
        }
        stateProgress.push({
          autoReplyBacklogChannels: [...next.autoReplyBacklogChannels],
          autoReplyPrimed: next.autoReplyPrimed,
          autoReplyScanCursor: next.autoReplyScanCursor,
        })
      },
    })
  }

  const first = await runScan()
  assert.deepEqual(first, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[0], {
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-email-backlog',
    },
  })

  const second = await runScan()
  assert.deepEqual(second, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[1], {
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-email-backlog',
    },
  })

  const third = await runScan()
  assert.deepEqual(third, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[2], {
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-imessage-new',
    },
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 2)
})

test('scanAssistantAutomationOnce keeps the reply cursor authoritative after backlog clear', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-unified-backlog-clear-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-email-backlog',
      response: 'email backlog reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'chat-imessage',
      response: 'imessage reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => {
    const channel = input.channel ?? input.session?.binding?.channel
    const actorId = input.actorId ?? input.session?.binding?.actorId
    const threadId = input.threadId ?? input.session?.binding?.threadId
    return {
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: threadId,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: `channel:${channel}|thread:${threadId}`,
          channel,
          identityId: null,
          actorId,
          threadId,
          threadIsDirect: true,
          delivery: {
            kind: channel === 'imessage' ? 'participant' : 'thread',
            target: actorId,
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel,
        target: actorId,
        targetKind: channel === 'imessage' ? 'participant' : 'thread',
        sentAt:
          channel === 'imessage'
            ? '2026-03-18T09:05:30.000Z'
            : '2026-03-18T09:00:30.000Z',
        messageLength: input.message.length,
      },
    }
  })

  const emailBacklogCapture = {
    captureId: 'cap-email-backlog',
    source: 'email',
    accountId: 'self',
    externalId: 'ext-email-backlog',
    threadId: 'thread-email-backlog',
    threadTitle: 'Backlog thread',
    actorId: 'backlog@example.com',
    actorName: 'Backlog User',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:00:00Z',
    receivedAt: null,
    text: 'Please follow up on this older email.',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/email-backlog.json',
    eventId: 'evt-email-backlog',
    promotions: [],
  }
  const imessageCapture = {
    captureId: 'cap-imessage-new',
    source: 'imessage',
    accountId: 'self',
    externalId: 'ext-imessage-new',
    threadId: 'chat-imessage',
    threadTitle: null,
    actorId: '+15550001111',
    actorName: 'New Texter',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:05:00Z',
    receivedAt: null,
    text: 'Can you answer this after the email backlog?',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/imessage-new.json',
    eventId: 'evt-imessage-new',
    promotions: [],
  }

  const listCalls: Array<{
    afterCaptureId: string | null
    afterOccurredAt: string | null
    oldestFirst: boolean
  }> = []
  let state: Parameters<typeof scanAssistantAutomationOnce>[0]['state'] = {
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: ['email', 'imessage'],
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: false,
  }
  const stateProgress: Array<{
    autoReplyBacklogChannels: string[]
    autoReplyPrimed: boolean
    autoReplyScanCursor: { occurredAt: string; captureId: string } | null
  }> = []

  const inboxServices = {
    async list(input: any) {
      listCalls.push({
        afterCaptureId: input.afterCaptureId,
        afterOccurredAt: input.afterOccurredAt,
        oldestFirst: input.oldestFirst,
      })
      if (input.afterCaptureId === emailBacklogCapture.captureId) {
        return {
          items: [imessageCapture],
        }
      }

      return {
        items: [emailBacklogCapture, imessageCapture],
      }
    },
    async show(input: any) {
      if (input.captureId === emailBacklogCapture.captureId) {
        return {
          capture: {
            captureId: emailBacklogCapture.captureId,
            source: 'email',
            threadTitle: 'Backlog thread',
            threadId: 'thread-email-backlog',
            threadIsDirect: true,
            actorId: 'backlog@example.com',
            actorName: 'Backlog User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            text: 'Please follow up on this older email.',
            attachments: [],
          },
        }
      }

      assert.equal(input.captureId, imessageCapture.captureId)
      return {
        capture: {
          captureId: imessageCapture.captureId,
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-imessage',
          threadIsDirect: true,
          actorId: '+15550001111',
          actorName: 'New Texter',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'Can you answer this after the email backlog?',
          attachments: [],
        },
      }
    },
  } as any

  async function runScan() {
    return scanAssistantAutomationOnce({
      inboxServices,
      state,
      vault: vaultRoot,
      async onStateProgress(next) {
        state = {
          ...state,
          ...next,
        }
        stateProgress.push({
          autoReplyBacklogChannels: [...next.autoReplyBacklogChannels],
          autoReplyPrimed: next.autoReplyPrimed,
          autoReplyScanCursor: next.autoReplyScanCursor,
        })
      },
    })
  }

  const first = await runScan()
  assert.deepEqual(first, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[0], {
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-email-backlog',
    },
  })

  state = {
    ...state,
    autoReplyBacklogChannels: [],
  }

  const second = await runScan()
  assert.deepEqual(second, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[1], {
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-imessage-new',
    },
  })
  assert.deepEqual(listCalls, [
    {
      afterCaptureId: null,
      afterOccurredAt: null,
      oldestFirst: true,
    },
    {
      afterCaptureId: 'cap-email-backlog',
      afterOccurredAt: '2026-03-18T09:00:00Z',
      oldestFirst: true,
    },
  ])
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 2)
})

test('scanAssistantAutomationOnce does not clear backlog when the first limited page is another channel', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-unified-backlog-page-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-email-backlog',
    response: 'email backlog reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => {
    const channel = input.channel ?? input.session?.binding?.channel
    const actorId = input.actorId ?? input.session?.binding?.actorId
    const threadId = input.threadId ?? input.session?.binding?.threadId
    return {
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: threadId,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: `channel:${channel}|thread:${threadId}`,
          channel,
          identityId: null,
          actorId,
          threadId,
          threadIsDirect: true,
          delivery: {
            kind: channel === 'imessage' ? 'participant' : 'thread',
            target: actorId,
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel,
        target: actorId,
        targetKind: channel === 'imessage' ? 'participant' : 'thread',
        sentAt: '2026-03-18T09:05:30.000Z',
        messageLength: input.message.length,
      },
    }
  })

  const interleavedImessageCapture = {
    captureId: 'cap-imessage-interleaved',
    source: 'imessage',
    accountId: 'self',
    externalId: 'ext-imessage-interleaved',
    threadId: 'chat-imessage-interleaved',
    threadTitle: null,
    actorId: '+15550002222',
    actorName: 'Interleaved Texter',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:00:30Z',
    receivedAt: null,
    text: 'A non-backlog message appears first.',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/imessage-interleaved.json',
    eventId: 'evt-imessage-interleaved',
    promotions: [],
  }
  const emailBacklogCapture = {
    captureId: 'cap-email-backlog-later',
    source: 'email',
    accountId: 'self',
    externalId: 'ext-email-backlog-later',
    threadId: 'thread-email-backlog',
    threadTitle: 'Backlog thread',
    actorId: 'backlog@example.com',
    actorName: 'Backlog User',
    actorIsSelf: false,
    occurredAt: '2026-03-18T09:01:00Z',
    receivedAt: null,
    text: 'This email backlog item must still be drained.',
    attachmentCount: 0,
    envelopePath: 'raw/inbox/email-backlog-later.json',
    eventId: 'evt-email-backlog-later',
    promotions: [],
  }

  const listCalls: Array<{
    afterCaptureId: string | null
    afterOccurredAt: string | null
    limit: number
  }> = []
  let state: Parameters<typeof scanAssistantAutomationOnce>[0]['state'] = {
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: ['email', 'imessage'],
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: false,
  }
  const stateProgress: Array<{
    autoReplyBacklogChannels: string[]
    autoReplyPrimed: boolean
    autoReplyScanCursor: { occurredAt: string; captureId: string } | null
  }> = []

  const inboxServices = {
    async list(input: any) {
      listCalls.push({
        afterCaptureId: input.afterCaptureId,
        afterOccurredAt: input.afterOccurredAt,
        limit: input.limit,
      })
      if (input.afterCaptureId === null) {
        return {
          items: [interleavedImessageCapture],
        }
      }
      if (input.afterCaptureId === interleavedImessageCapture.captureId) {
        return {
          items: [emailBacklogCapture],
        }
      }

      return {
        items: [],
      }
    },
    async show(input: any) {
      assert.equal(input.captureId, emailBacklogCapture.captureId)
      return {
        capture: {
          captureId: emailBacklogCapture.captureId,
          source: 'email',
          threadTitle: 'Backlog thread',
          threadId: 'thread-email-backlog',
          threadIsDirect: true,
          actorId: 'backlog@example.com',
          actorName: 'Backlog User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:01:00Z',
          text: 'This email backlog item must still be drained.',
          attachments: [],
        },
      }
    },
  } as any

  async function runScan() {
    return scanAssistantAutomationOnce({
      inboxServices,
      maxPerScan: 1,
      state,
      vault: vaultRoot,
      async onStateProgress(next) {
        state = {
          ...state,
          ...next,
        }
        stateProgress.push({
          autoReplyBacklogChannels: [...next.autoReplyBacklogChannels],
          autoReplyPrimed: next.autoReplyPrimed,
          autoReplyScanCursor: next.autoReplyScanCursor,
        })
      },
    })
  }

  const first = await runScan()
  assert.deepEqual(first, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[0], {
    autoReplyBacklogChannels: ['email'],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:01:00Z',
      captureId: 'cap-email-backlog-later',
    },
  })

  const second = await runScan()
  assert.deepEqual(second, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    },
  })
  assert.deepEqual(stateProgress[1], {
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:01:00Z',
      captureId: 'cap-email-backlog-later',
    },
  })
  assert.deepEqual(listCalls, [
    {
      afterCaptureId: null,
      afterOccurredAt: null,
      limit: 1,
    },
    {
      afterCaptureId: 'cap-imessage-interleaved',
      afterOccurredAt: '2026-03-18T09:00:30Z',
      limit: 1,
    },
    {
      afterCaptureId: 'cap-email-backlog-later',
      afterOccurredAt: '2026-03-18T09:01:00Z',
      limit: 1,
    },
  ])
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
})

test('scanAssistantAutomationOnce keeps the auto-reply cursor pinned on deferred groups and retries them before later captures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-unified-reply-defer-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const stateProgress: Array<{
    inboxScanCursor: { occurredAt: string; captureId: string } | null
    autoReplyScanCursor: { occurredAt: string; captureId: string } | null
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-unified-1',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-unified-1',
            threadId: 'thread-unified',
            threadTitle: 'Deferred thread',
            actorId: 'deferred@example.com',
            actorName: 'Deferred User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:04:00Z',
            receivedAt: null,
            text: 'First email',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/unified-1.json',
            eventId: 'evt-unified-1',
            promotions: [],
          },
          {
            captureId: 'cap-unified-2',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-unified-2',
            threadId: 'thread-unified',
            threadTitle: 'Deferred thread',
            actorId: 'deferred@example.com',
            actorName: 'Deferred User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:04:30Z',
            receivedAt: null,
            text: 'Second email',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/unified-2.json',
            eventId: 'evt-unified-2',
            promotions: [],
          },
          {
            captureId: 'cap-unified-later',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-unified-later',
            threadId: 'thread-later',
            threadTitle: null,
            actorId: '+15550004444',
            actorName: 'Later User',
            actorIsSelf: true,
            occurredAt: '2026-03-18T09:05:00Z',
            receivedAt: null,
            text: 'Later self-authored message',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/unified-later.json',
            eventId: 'evt-unified-later',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      if (input.captureId === 'cap-unified-later') {
        return {
          capture: {
            captureId: 'cap-unified-later',
            source: 'imessage',
            threadTitle: null,
            threadId: 'thread-later',
            threadIsDirect: true,
            actorId: '+15550004444',
            actorName: 'Later User',
            actorIsSelf: true,
            occurredAt: '2026-03-18T09:05:00Z',
            text: 'Later self-authored message',
            attachments: [],
          },
        }
      }

      return {
        capture: {
          captureId: input.captureId,
          source: 'email',
          threadTitle: 'Deferred thread',
          threadId: 'thread-unified',
          threadIsDirect: true,
          actorId: 'deferred@example.com',
          actorName: 'Deferred User',
          actorIsSelf: false,
          occurredAt:
            input.captureId === 'cap-unified-1'
              ? '2026-03-18T09:04:00Z'
              : '2026-03-18T09:04:30Z',
          text:
            input.captureId === 'cap-unified-1'
              ? 'First email'
              : 'Second email',
          attachments: [],
        },
      }
    },
  } as any

  await assistantAutomationArtifacts.writeAssistantChatResultArtifacts({
    captureIds: ['cap-unified-1'],
    respondedAt: '2026-03-18T09:05:30Z',
    result: {
      response: 'seeded unified reply',
      session: {
        sessionId: 'seeded-unified-session',
      },
      delivery: {
        channel: 'email',
        target: 'deferred@example.com',
      },
    } as any,
    vault: vaultRoot,
  })

  const first = await scanAssistantAutomationOnce({
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push({
        inboxScanCursor: next.inboxScanCursor,
        autoReplyScanCursor: next.autoReplyScanCursor,
      })
    },
    state: {
      inboxScanCursor: null,
      autoReplyScanCursor: null,
      autoReplyChannels: ['email', 'imessage'],
      autoReplyBacklogChannels: [],
      autoReplyPrimed: true,
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 2,
      failed: 0,
      replied: 0,
      skipped: 2,
    },
  })
  assert.equal(stateProgress.length, 0)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 0)
  assert.equal(
    events.some((event) => event.captureId === 'cap-unified-later'),
    false,
  )

  await rm(
    path.join(
      vaultRoot,
      'derived',
      'inbox',
      'cap-unified-1',
      'assistant',
      'chat-result.json',
    ),
  )

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-unified',
    response: 'unified reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockResolvedValueOnce({
    message: 'unified reply',
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: 'session-unified',
      provider: 'codex-cli',
      providerSessionId: 'thread-unified',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:email|thread:thread-unified',
        channel: 'email',
        identityId: null,
        actorId: 'deferred@example.com',
        threadId: 'thread-unified',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'deferred@example.com',
        },
      },
      createdAt: '2026-03-18T09:05:30.000Z',
      updatedAt: '2026-03-18T09:05:30.000Z',
      lastTurnAt: '2026-03-18T09:05:30.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'email',
      target: 'deferred@example.com',
      targetKind: 'thread',
      sentAt: '2026-03-18T09:05:30.000Z',
      messageLength: 'unified reply'.length,
    },
  })

  const second = await scanAssistantAutomationOnce({
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push({
        inboxScanCursor: next.inboxScanCursor,
        autoReplyScanCursor: next.autoReplyScanCursor,
      })
    },
    state: {
      inboxScanCursor: null,
      autoReplyScanCursor: null,
      autoReplyChannels: ['email', 'imessage'],
      autoReplyBacklogChannels: [],
      autoReplyPrimed: true,
    },
    vault: vaultRoot,
  })

  assert.deepEqual(second, {
    routing: {
      considered: 0,
      failed: 0,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
    replies: {
      considered: 3,
      failed: 0,
      replied: 1,
      skipped: 1,
    },
  })
  assert.deepEqual(stateProgress[0], {
    inboxScanCursor: null,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:04:30Z',
      captureId: 'cap-unified-2',
    },
  })
  assert.deepEqual(stateProgress[1], {
    inboxScanCursor: null,
    autoReplyScanCursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-unified-later',
    },
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
})

test('scanAssistantInboxOnce still waits for unsupported pending HEIC photos', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-scan-heic-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; details?: string }> = []
  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-heic',
          occurredAt: '2026-03-16T16:12:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'image',
            fileName: 'meal.heic',
            mediaType: 'image/heic',
            storedPath: 'attachments/2026/03/16/meal.heic',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    onEvent(event) {
      events.push({
        type: event.type,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 0)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.skipped' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce primes backlog cursors, replies to new inbound iMessages, and injects the first-contact check-in', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockImplementation(async (input: any) => {
    input.onEvent?.({
      id: 'search-1',
      kind: 'search',
      rawEvent: {
        type: 'item.started',
      },
      state: 'running',
      text: 'Web: macros today',
    })
    input.onEvent?.({
      id: 'tool-1',
      kind: 'tool',
      rawEvent: {
        type: 'item.completed',
      },
      state: 'completed',
      text: 'Tool murph.inbox_list',
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-auto',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-auto',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:imessage|thread:chat-2',
        channel: 'imessage',
        identityId: null,
        actorId: '+15551234567',
        threadId: 'chat-2',
        threadIsDirect: true,
        delivery: {
          kind: 'participant',
          target: '+15551234567',
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'imessage',
      target: '+15551234567',
      targetKind: 'participant',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{
    captureId?: string
    details?: string
    providerKind?: string
    providerState?: string
    type: string
  }> = []
  const listCalls: unknown[] = []

  const inboxServices = {
    async list(input: any) {
      listCalls.push(input)
      if (input.oldestFirst === false) {
        return {
          items: [
            {
              captureId: 'cap-backlog',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-1',
              threadId: 'chat-1',
              threadTitle: null,
              actorId: '+15550001111',
              actorName: 'Backlog',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:00:00Z',
              receivedAt: null,
              text: 'old message',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/1.json',
              eventId: 'evt-1',
              promotions: [],
            },
          ],
        }
      }

      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-2',
            threadId: 'chat-2',
            threadTitle: null,
            actorId: '+15551234567',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:05:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/2.json',
            eventId: 'evt-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      assert.equal(input.captureId, 'cap-new')
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-2',
          threadIsDirect: true,
          actorId: '+15551234567',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  const prime = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: false,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(prime, {
    considered: 0,
    failed: 0,
    replied: 0,
    skipped: 0,
  })
  assert.deepEqual(stateProgress[0], {
    cursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-backlog',
    },
    primed: true,
  })

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]!.cursor,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.deepEqual(stateProgress[1], {
    cursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-new',
    },
    primed: true,
  })
  const artifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-new',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.equal(artifact.schema, 'murph.assistant-chat-result.v1')
  assert.equal(
    events.some(
      (event) => event.type === 'reply.scan.primed' && event.details?.includes('cap-backlog'),
    ),
    true,
  )
  assert.equal(
    events.some((event) => event.type === 'capture.replied' && event.captureId === 'cap-new'),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-started' &&
        event.captureId === 'cap-new' &&
        event.details === 'assistant provider turn started',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-new' &&
        event.providerKind === 'search' &&
        event.providerState === 'running' &&
        event.details === 'Web: macros today',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-new' &&
        event.providerKind === 'tool' &&
        event.providerState === 'completed' &&
        event.details === 'Tool murph.inbox_list',
    ),
    true,
  )
  assert.match(providerCall?.systemPrompt ?? '', /optional first-chat check-in/u)
  assert.match(providerCall?.systemPrompt ?? '', /Hey, I'm Murph\. I'm your personal health assistant\./u)
  assert.match(providerCall?.systemPrompt ?? '', /what are some of their health goals right now/u)
  assert.match(providerCall?.systemPrompt ?? '', /what you should call them/u)
  assert.match(providerCall?.systemPrompt ?? '', /with this exact follow-up copy/u)
  assert.match(
    providerCall?.systemPrompt ?? '',
    /treat that as onboarding context, not as a request to choose priorities or start coaching/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /Broad symptom statements during onboarding also count as context/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /Do not ask which goal to tackle first unless the user explicitly asks for help deciding where to start/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /Do not pivot into symptom triage, differential-style questioning, or how to fix the goal unless the user clearly asks for concrete help with that issue/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /Keep onboarding brief and orienting\. Do not try to draw the user into a long, drawn-out conversation/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /The purpose of onboarding is just to introduce Murph, explain how to use it well, and set up a gradual path where the user can share more information over time/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /You may follow that intro with this exact follow-up copy/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /You can send things as they happen — symptoms, sleep, meals, meds, workouts, labs, questions — and I keep compiling the picture over time so I can help you notice patterns, make better decisions, and work toward your goals\. It’s like having a private health team in your pocket\./u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /If the early onboarding exchange is still going and the user has no concrete ask yet, a good light-touch follow-up can be: `Do you have any other questions or do you want to learn more about the things I can do for you\?`/u,
  )
  assert.match(
    providerCall?.systemPrompt ?? '',
    /Another good light-touch note later in the onboarding exchange can be: `If you want a useful head start later, health history, supplements or meds, recent blood tests, and Garmin\/WHOOP\/Oura data can all help too\.`/u,
  )
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 1,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    },
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: '2026-03-18T09:00:00Z',
      afterCaptureId: 'cap-backlog',
      oldestFirst: true,
    },
  ])
})

test('scanAssistantAutoReplyOnce advances the cursor and writes deferred artifacts for retryable delivery failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-deferred-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-deferred',
    response: 'queued auto reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockRejectedValueOnce(
    new VaultCliError(
      'ASSISTANT_DELIVERY_FAILED',
      'Temporary network interruption while delivering the reply.',
      {
        retryable: true,
      },
    ),
  )

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-2',
            threadId: 'chat-2',
            threadTitle: null,
            actorId: '+15551234567',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:05:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/2.json',
            eventId: 'evt-2',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-2',
          threadIsDirect: true,
          actorId: '+15551234567',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-old',
    },
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.deepEqual(stateProgress[0], {
    cursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-new',
    },
    primed: true,
  })
  const deferredArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-new',
        'assistant',
        'chat-deferred.json',
      ),
      'utf8',
    ),
  ) as {
    deliveryIntentId: string | null
    schema: string
  }
  assert.equal(deferredArtifact.schema, 'murph.assistant-chat-deferred.v1')
  assert.equal(typeof deferredArtifact.deliveryIntentId, 'string')

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-old',
    },
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.equal(second.replied, 0)
  assert.equal(second.skipped, 1)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
})

test('scanAssistantAutoReplyOnce queues hosted auto-replies without sending before commit', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-queue-only-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-queue-only-auto-reply',
    response: 'queued auto reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-old',
    },
    autoReplyPrimed: true,
    deliveryDispatchMode: 'queue-only',
    enabledChannels: ['imessage'],
    inboxServices: {
      async list() {
        return {
          items: [
            {
              captureId: 'cap-new',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-2',
              threadId: 'chat-2',
              threadTitle: null,
              actorId: '+15551234567',
              actorName: 'Bob',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:05:00Z',
              receivedAt: null,
              text: 'How are my macros today?',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/2.json',
              eventId: 'evt-2',
              promotions: [],
            },
          ],
        }
      },
      async show() {
        return {
          capture: {
            captureId: 'cap-new',
            source: 'imessage',
            threadTitle: null,
            threadId: 'chat-2',
            threadIsDirect: true,
            actorId: '+15551234567',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:05:00Z',
            text: 'How are my macros today?',
            attachments: [],
          },
        }
      },
    } as any,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)

  const artifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-new',
        'assistant',
        'chat-deferred.json',
      ),
      'utf8',
    ),
  ) as {
    deliveryIntentId: string | null
    schema: string
  }
  assert.equal(artifact.schema, 'murph.assistant-chat-deferred.v1')
  assert.equal(typeof artifact.deliveryIntentId, 'string')

  const snapshot = await readAssistantStatusSnapshot(vaultRoot)
  assert.equal(snapshot?.outbox.pending, 1)
  assert.equal(snapshot?.outbox.sent, 0)
  assert.equal(snapshot?.recentTurns[0]?.status, 'deferred')
  assert.equal(snapshot?.recentTurns[0]?.deliveryDisposition, 'queued')
})

test('scanAssistantAutoReplyOnce injects persisted assistant memory into auto-reply turns', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-onboarding-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-prefill',
      response: 'prefill reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-auto',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  runtimeMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'imessage',
      target: '+15551239999',
      targetKind: 'participant',
      sentAt: '2026-03-18T10:00:01.000Z',
      messageLength: 10,
    },
  })

  await Promise.all([
    upsertAssistantMemory({
      vault: vaultRoot,
      text: 'Call the user Chris.',
      scope: 'long-term',
      section: 'Identity',
    }),
    upsertAssistantMemory({
      vault: vaultRoot,
      text: 'Keep answers concise.',
      scope: 'long-term',
      section: 'Standing instructions',
    }),
  ])

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-9',
            threadId: 'chat-9',
            threadTitle: null,
            actorId: '+15551239999',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T10:00:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/9.json',
            eventId: 'evt-9',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-9',
          threadIsDirect: true,
          actorId: '+15551239999',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T10:00:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    vault: vaultRoot,
  })

  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.match(providerCall?.systemPrompt ?? '', /Core assistant memory:/u)
  assert.match(providerCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.match(providerCall?.systemPrompt ?? '', /Keep answers concise\./u)
  assert.doesNotMatch(providerCall?.systemPrompt ?? '', /Known onboarding answers/u)
  assert.doesNotMatch(providerCall?.systemPrompt ?? '', /what goals they want help with/u)
})

test('scanAssistantAutoReplyOnce coalesces same-thread email backlog into one reply', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-email-backlog-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    backlogChannels?: readonly string[]
    primed: boolean
  }> = []
  const listCalls: unknown[] = []

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-email-backlog',
    response: 'email backlog reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-email-backlog',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:email|identity:murph%40agentmail.to|thread:thread-1',
        channel: 'email',
        identityId: 'murph@agentmail.to',
        actorId: 'person@example.test',
        threadId: 'thread-1',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
      },
      createdAt: '2026-03-18T09:00:00.000Z',
      updatedAt: '2026-03-18T09:00:00.000Z',
      lastTurnAt: '2026-03-18T09:00:00.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'email',
      target: 'thread-1',
      targetKind: 'thread',
      sentAt: '2026-03-18T09:00:01.000Z',
      messageLength: input.message.length,
    },
    deliveryError: null,
    provider: {
      name: 'codex-cli',
      model: null,
      response: 'email backlog reply',
      rawEvents: [],
    },
    sessionId: input.sessionId,
    transcriptEntries: [],
  }))

  const inboxServices = {
    async list(input: any) {
      listCalls.push(input)
      return {
        items: [
          {
            captureId: 'cap-email-1',
            source: 'email',
            accountId: 'murph@agentmail.to',
            externalId: 'email:1',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T08:58:00Z',
            receivedAt: '2026-03-18T08:58:00Z',
            text: 'first email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/1.json',
            eventId: 'evt-email-1',
            promotions: [],
          },
          {
            captureId: 'cap-email-2',
            source: 'email',
            accountId: 'murph@agentmail.to',
            externalId: 'email:2',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T08:59:00Z',
            receivedAt: '2026-03-18T08:59:00Z',
            text: 'second email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/2.json',
            eventId: 'evt-email-2',
            promotions: [],
          },
          {
            captureId: 'cap-email-3',
            source: 'email',
            accountId: 'murph@agentmail.to',
            externalId: 'email:3',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: '2026-03-18T09:00:00Z',
            text: 'latest email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/3.json',
            eventId: 'evt-email-3',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const textByCaptureId: Record<string, string> = {
        'cap-email-1': 'first email in thread',
        'cap-email-2': 'second email in thread',
        'cap-email-3': 'latest email in thread',
      }
      assert.equal(typeof textByCaptureId[input.captureId], 'string')
      return {
        capture: {
          captureId: input.captureId,
          source: 'email',
          accountId: 'murph@agentmail.to',
          threadTitle: 'Re: whats good',
          threadId: 'thread-1',
          threadIsDirect: true,
          actorId: 'person@example.test',
          actorName: 'Person',
          actorIsSelf: false,
          occurredAt:
            input.captureId === 'cap-email-1'
              ? '2026-03-18T08:58:00Z'
              : input.captureId === 'cap-email-2'
                ? '2026-03-18T08:59:00Z'
                : '2026-03-18T09:00:00Z',
          text: textByCaptureId[input.captureId],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: false,
    backlogChannels: ['email'],
    enabledChannels: ['email'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 3,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length > 0, true)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(typeof providerCall?.userPrompt, 'string')
  assert.match(providerCall.userPrompt, /Grouped captures: 3/)
  assert.match(providerCall.userPrompt, /Capture 1:/)
  assert.match(providerCall.userPrompt, /first email in thread/)
  assert.match(providerCall.userPrompt, /second email in thread/)
  assert.match(providerCall.userPrompt, /latest email in thread/)
  assert.deepEqual(stateProgress[0], {
    cursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-email-3',
    },
    primed: true,
  })
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: true,
    },
  ])
})

test('scanAssistantAutoReplyOnce can use self-authored attachment prompts and suppress recent assistant echoes', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-18T00:00:00.000Z'))

  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-self-auto-reply-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  try {
    runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
      provider: 'codex-cli',
      providerSessionId: 'thread-self',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-self',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: 'channel:imessage|thread:self-chat',
          channel: 'imessage',
          identityId: null,
          actorId: '+15550000000',
          threadId: 'self-chat',
          threadIsDirect: true,
          delivery: {
            kind: 'participant',
            target: '+15550000000',
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        lastTurnAt: '2026-03-18T00:00:00.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'imessage',
        target: '+15550000000',
        targetKind: 'participant',
        sentAt: '2026-03-18T00:00:00.000Z',
        messageLength: input.message.length,
      },
    }))

    let phase: 'prompt' | 'echo' = 'prompt'
    const stateProgress: Array<{
      cursor: { occurredAt: string; captureId: string } | null
      primed: boolean
    }> = []

    const inboxServices = {
      async list() {
        if (phase === 'prompt') {
          return {
            items: [
              {
                captureId: 'cap-self',
                source: 'imessage',
                accountId: 'self',
                externalId: 'ext-self',
                threadId: 'self-chat',
                threadTitle: 'Self',
                actorId: '+15550000000',
                actorName: 'Self User',
                actorIsSelf: true,
                occurredAt: '2026-03-18T00:00:00.000Z',
                receivedAt: null,
                text: null,
                attachmentCount: 1,
                envelopePath: 'raw/inbox/self.json',
                eventId: 'evt-self',
                promotions: [],
              },
            ],
          }
        }

        return {
          items: [
            {
              captureId: 'cap-echo',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-echo',
              threadId: 'self-chat',
              threadTitle: 'Self',
              actorId: '+15550000000',
              actorName: 'Self User',
              actorIsSelf: true,
              occurredAt: '2026-03-18T00:00:05.000Z',
              receivedAt: null,
              text: 'auto reply',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/echo.json',
              eventId: 'evt-echo',
              promotions: [],
            },
          ],
        }
      },
      async show(input: any) {
        if (input.captureId === 'cap-self') {
          return {
            capture: {
              captureId: 'cap-self',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-self',
              threadId: 'self-chat',
              threadTitle: 'Self',
              threadIsDirect: true,
              actorId: '+15550000000',
              actorName: 'Self User',
              actorIsSelf: true,
              occurredAt: '2026-03-18T00:00:00.000Z',
              receivedAt: null,
              text: null,
              attachmentCount: 1,
              envelopePath: 'raw/inbox/self.json',
              eventId: 'evt-self',
              createdAt: '2026-03-18T00:00:00.000Z',
              promotions: [],
              attachments: [
                {
                  ordinal: 1,
                  kind: 'audio',
                  fileName: 'voice.m4a',
                  transcriptText: 'Remember eggs and yogurt.',
                  extractedText: null,
                  parseState: 'succeeded',
                },
              ],
            },
          }
        }

        return {
          capture: {
            captureId: 'cap-echo',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-echo',
            threadId: 'self-chat',
            threadTitle: 'Self',
            threadIsDirect: true,
            actorId: '+15550000000',
            actorName: 'Self User',
            actorIsSelf: true,
            occurredAt: '2026-03-18T00:00:05.000Z',
            receivedAt: null,
            text: 'auto reply',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/echo.json',
            eventId: 'evt-echo',
            createdAt: '2026-03-18T00:00:05.000Z',
            promotions: [],
            attachments: [],
          },
        }
      },
    } as any

    const first = await scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      allowSelfAuthored: true,
      enabledChannels: ['imessage'],
      inboxServices,
      vault: vaultRoot,
      async onStateProgress(next) {
        stateProgress.push(next)
      },
    })

    assert.deepEqual(first, {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
    const prompt =
      runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.userPrompt
    assert.match(prompt ?? '', /Remember eggs and yogurt\./u)
    assert.match(prompt ?? '', /Attachment context:/u)

    phase = 'echo'
    const second = await scanAssistantAutoReplyOnce({
      afterCursor: stateProgress[0]?.cursor ?? null,
      autoReplyPrimed: true,
      allowSelfAuthored: true,
      enabledChannels: ['imessage'],
      inboxServices,
      vault: vaultRoot,
      async onStateProgress(next) {
        stateProgress.push(next)
      },
    })

    assert.deepEqual(second, {
      considered: 1,
      failed: 0,
      replied: 0,
      skipped: 1,
    })
    assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)

    const sessionId = JSON.parse(
      await readFile(
        path.join(
          vaultRoot,
          'derived',
          'inbox',
          'cap-self',
          'assistant',
          'chat-result.json',
        ),
        'utf8',
      ),
    ).sessionId as string
    const transcript = await listAssistantTranscriptEntries(vaultRoot, sessionId)
    assert.equal(
      transcript.some(
        (entry) => entry.kind === 'assistant' && entry.text === 'auto reply',
      ),
      true,
    )
  } finally {
    vi.useRealTimers()
  }
})

test('scanAssistantAutoReplyOnce keeps the cursor on prompt defers but advances it on prompt skips', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-cursor-policy-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  let phase: 'defer' | 'skip' = 'defer'
  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []

  const inboxServices = {
    async list() {
      if (phase === 'defer') {
        return {
          items: [
            {
              captureId: 'cap-defer',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-defer',
              threadId: 'chat-defer',
              threadTitle: null,
              actorId: '+15550001111',
              actorName: 'Defer User',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:00:00Z',
              receivedAt: null,
              text: 'Need parsing first',
              attachmentCount: 1,
              envelopePath: 'raw/inbox/defer.json',
              eventId: 'evt-defer',
              promotions: [],
            },
          ],
        }
      }

      return {
        items: [
          {
            captureId: 'cap-skip',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-skip',
            threadId: 'chat-skip',
            threadTitle: null,
            actorId: '+15550002222',
            actorName: 'Skip User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: null,
            attachmentCount: 1,
            envelopePath: 'raw/inbox/skip.json',
            eventId: 'evt-skip',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      if (phase === 'defer') {
        assert.equal(input.captureId, 'cap-defer')
        return {
          capture: {
            captureId: 'cap-defer',
            source: 'imessage',
            threadTitle: null,
            threadId: 'chat-defer',
            threadIsDirect: true,
            actorId: '+15550001111',
            actorName: 'Defer User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            text: 'Need parsing first',
            attachments: [
              {
                ordinal: 1,
                kind: 'image',
                fileName: 'meal.jpg',
                transcriptText: null,
                extractedText: null,
                parseState: 'pending',
              },
            ],
          },
        }
      }

      assert.equal(input.captureId, 'cap-skip')
      return {
        capture: {
          captureId: 'cap-skip',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-skip',
          threadIsDirect: true,
          actorId: '+15550002222',
          actorName: 'Skip User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:01:00Z',
          text: null,
          attachments: [
            {
              ordinal: 1,
              kind: 'image',
              fileName: 'blank.jpg',
              transcriptText: null,
              extractedText: null,
              parseState: 'succeeded',
            },
          ],
        },
      }
    },
  } as any

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  phase = 'skip'

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 0)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)
  assert.deepEqual(stateProgress, [
    {
      cursor: null,
      primed: true,
    },
    {
      cursor: {
        occurredAt: '2026-03-18T09:01:00Z',
        captureId: 'cap-skip',
      },
      primed: true,
    },
  ])
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-defer' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-skip' &&
        event.details === 'capture has no text or parsed attachment content',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce forwards multimodal content for photo-only captures', async () => {
  const { homeRoot, inboxServices, vaultRoot } =
    await createPhotoOnlyAutoReplyFixture('murph-auto-reply-multimodal-')
  mockSuccessfulPhotoOnlyAutoReply()

  await withTemporaryHome(homeRoot, async () => {
    await saveAssistantOperatorDefaultsPatch(
      OPENAI_COMPATIBLE_OPERATOR_DEFAULTS,
      homeRoot,
    )

    const result = await scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      enabledChannels: ['telegram'],
      inboxServices,
      vault: vaultRoot,
    })

    assert.deepEqual(result, {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    })

    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(Array.isArray(providerCall?.userMessageContent), true)
    assert.equal(providerCall?.userMessageContent?.[0]?.type, 'text')
    assert.equal(providerCall?.userMessageContent?.[2]?.type, 'image')
    assert.deepEqual(
      providerCall?.userMessageContent?.[2]?.image,
      PHOTO_ONLY_ATTACHMENT_BUFFER,
    )
  })
})

test('scanAssistantAutoReplyOnce skips photo-only captures when the configured provider cannot consume rich user content', async () => {
  const { homeRoot, inboxServices, vaultRoot } =
    await createPhotoOnlyAutoReplyFixture(
      'murph-auto-reply-text-only-provider-',
    )

  await withTemporaryHome(homeRoot, async () => {
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        provider: 'codex-cli',
        providerConfig: {
          model: 'gpt-5.4-mini',
          reasoningEffort: 'medium',
          sandbox: 'danger-full-access',
          approvalPolicy: 'never',
          oss: false,
        },
      }),
      homeRoot,
    )

    const events: Array<{ captureId?: string; details?: string; type: string }> = []
    const result = await scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(event)
      },
      vault: vaultRoot,
    })

    assert.deepEqual(result, {
      considered: 1,
      failed: 0,
      replied: 0,
      skipped: 1,
    })
    assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 0)
    assert.equal(
      events.some(
        (event) =>
          event.type === 'capture.reply-skipped' &&
          event.captureId === PHOTO_ONLY_CAPTURE_ID &&
          event.details ===
            'capture has image/PDF evidence but the configured assistant provider only accepts text input',
      ),
      true,
    )
  })
})

test('scanAssistantAutoReplyOnce reroutes photo-only captures to a multimodal failover provider when one is configured', async () => {
  const { homeRoot, inboxServices, vaultRoot } =
    await createPhotoOnlyAutoReplyFixture(
      'murph-auto-reply-rich-failover-',
    )
  mockSuccessfulPhotoOnlyAutoReply()

  await withTemporaryHome(homeRoot, async () => {
    await saveAssistantOperatorDefaultsPatch(
      {
        ...buildAssistantProviderDefaultsPatch({
          defaults: null,
          provider: 'codex-cli',
          providerConfig: {
            model: 'gpt-5.4-mini',
            reasoningEffort: 'medium',
            sandbox: 'danger-full-access',
            approvalPolicy: 'never',
            oss: false,
          },
        }),
        failoverRoutes: [
          {
            name: 'vision-backup',
            provider: 'openai-compatible',
            codexCommand: null,
            model: 'gpt-oss:20b',
            reasoningEffort: null,
            sandbox: null,
            approvalPolicy: null,
            profile: null,
            oss: false,
            baseUrl: 'http://127.0.0.1:11434/v1',
            apiKeyEnv: 'OLLAMA_API_KEY',
            providerName: 'ollama',
            headers: null,
            cooldownMs: null,
          },
        ],
      },
      homeRoot,
    )

    const result = await scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      enabledChannels: ['telegram'],
      inboxServices,
      vault: vaultRoot,
    })

    assert.deepEqual(result, {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(providerCall?.provider, 'openai-compatible')
    assert.equal(providerCall?.apiKeyEnv, 'OLLAMA_API_KEY')
    assert.equal(providerCall?.approvalPolicy, null)
    assert.equal(providerCall?.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(providerCall?.codexCommand, undefined)
    assert.equal(providerCall?.model, 'gpt-oss:20b')
    assert.equal(providerCall?.providerName, 'ollama')
    assert.equal(providerCall?.sandbox, null)
    assert.equal(Array.isArray(providerCall?.userMessageContent), true)
    assert.equal(providerCall?.userMessageContent?.[2]?.type, 'image')
  })
})

test('buildAssistantAutoReplyPrompt omits oversized parsed attachment bodies but keeps attachment handles', () => {
  const largeExtractedText =
    `timestamp,spo2,hr\n2026-03-28T23:32:08Z,98,55\n${'filler,'.repeat(400)}\nTAIL_MARKER_SHOULD_NOT_APPEAR`

  const prompt = buildAssistantAutoReplyPrompt([
    {
      capture: {
        captureId: 'cap-o2',
        source: 'telegram',
        accountId: 'acct',
        externalId: 'ext-o2',
        threadId: 'thread-o2',
        threadTitle: 'O2 Ring',
        threadIsDirect: true,
        actorId: 'user',
        actorName: 'User',
        actorIsSelf: false,
        occurredAt: '2026-03-30T10:05:31.625Z',
        receivedAt: null,
        text: 'Log this finger oxygen reader plz',
        attachmentCount: 1,
        envelopePath: 'raw/inbox/captures/cap-o2/envelope.json',
        eventId: 'evt-o2',
        createdAt: '2026-03-30T10:05:31.625Z',
        promotions: [],
        attachments: [
          {
            attachmentId: 'att-o2',
            ordinal: 1,
            externalId: 'ext-att-o2',
            kind: 'document',
            mime: 'text/csv',
            originalPath: 'imports/o2.csv',
            storedPath: 'raw/inbox/captures/cap-o2/attachments/1/o2.csv',
            fileName: 'o2.csv',
            byteSize: 1027628,
            sha256: 'abc123',
            extractedText: largeExtractedText,
            transcriptText: null,
            derivedPath: 'derived/inbox/cap-o2/attachment-1/manifest.json',
            parserProviderId: 'parser',
            parseState: 'succeeded',
          },
        ],
      },
      telegramMetadata: null,
    },
  ])

  assert.deepEqual(prompt.kind, 'ready')
  assert.match(prompt.prompt, /Attachment context:/u)
  assert.match(prompt.prompt, /attachmentId: att-o2/u)
  assert.match(
    prompt.prompt,
    /storedPath: raw\/inbox\/captures\/cap-o2\/attachments\/1\/o2\.csv/u,
  )
  assert.match(
    prompt.prompt,
    /derivedPath: derived\/inbox\/cap-o2\/attachment-1\/manifest\.json/u,
  )
  assert.match(prompt.prompt, /Extracted text excerpt:\ntimestamp,spo2,hr/u)
  assert.match(prompt.prompt, /Large parsed attachment content omitted from prompt/u)
  assert.doesNotMatch(prompt.prompt, /TAIL_MARKER_SHOULD_NOT_APPEAR/u)
})

test('buildAssistantAutoReplyPrompt still inlines small parsed attachment text', () => {
  const prompt = buildAssistantAutoReplyPrompt([
    {
      capture: {
        captureId: 'cap-note',
        source: 'telegram',
        accountId: 'acct',
        externalId: 'ext-note',
        threadId: 'thread-note',
        threadTitle: 'Voice Note',
        threadIsDirect: true,
        actorId: 'user',
        actorName: 'User',
        actorIsSelf: false,
        occurredAt: '2026-03-30T11:00:00.000Z',
        receivedAt: null,
        text: 'Remember eggs and yogurt.',
        attachmentCount: 1,
        envelopePath: 'raw/inbox/captures/cap-note/envelope.json',
        eventId: 'evt-note',
        createdAt: '2026-03-30T11:00:00.000Z',
        promotions: [],
        attachments: [
          {
            attachmentId: 'att-note',
            ordinal: 1,
            externalId: 'ext-att-note',
            kind: 'audio',
            mime: 'audio/m4a',
            originalPath: 'imports/note.m4a',
            storedPath: 'raw/inbox/captures/cap-note/attachments/1/note.m4a',
            fileName: 'note.m4a',
            byteSize: 4096,
            sha256: 'def456',
            extractedText: null,
            transcriptText: 'eggs, yogurt, and blueberries',
            derivedPath: null,
            parserProviderId: 'parser',
            parseState: 'succeeded',
          },
        ],
      },
      telegramMetadata: null,
    },
  ])

  assert.deepEqual(prompt.kind, 'ready')
  assert.match(prompt.prompt, /Transcript:\neggs, yogurt, and blueberries/u)
  assert.doesNotMatch(prompt.prompt, /Large parsed attachment content omitted from prompt/u)
})

test('scanAssistantAutoReplyOnce keeps grouped partial reply artifacts queued for retry instead of advancing past the thread', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-partial-artifact-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-partial-1',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-partial-1',
            threadId: 'chat-partial',
            threadTitle: null,
            actorId: 'partial@example.com',
            actorName: 'Partial User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:02:00Z',
            receivedAt: null,
            text: 'First message',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/partial-1.json',
            eventId: 'evt-partial-1',
            promotions: [],
          },
          {
            captureId: 'cap-partial-2',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-partial-2',
            threadId: 'chat-partial',
            threadTitle: null,
            actorId: 'partial@example.com',
            actorName: 'Partial User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:02:30Z',
            receivedAt: null,
            text: 'Second message',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/partial-2.json',
            eventId: 'evt-partial-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      return {
        capture: {
          captureId: input.captureId,
          source: 'email',
          threadTitle: null,
          threadId: 'chat-partial',
          threadIsDirect: true,
          actorId: 'partial@example.com',
          actorName: 'Partial User',
          actorIsSelf: false,
          occurredAt:
            input.captureId === 'cap-partial-1'
              ? '2026-03-18T09:02:00Z'
              : '2026-03-18T09:02:30Z',
          text:
            input.captureId === 'cap-partial-1'
              ? 'First message'
              : 'Second message',
          attachments: [],
        },
      }
    },
  } as any

  await assistantAutomationArtifacts.writeAssistantChatResultArtifacts({
    captureIds: ['cap-partial-1'],
    respondedAt: '2026-03-18T09:03:00Z',
    result: {
      response: 'seeded reply',
      session: {
        sessionId: 'seeded-session',
      },
      delivery: {
        channel: 'email',
        target: 'partial@example.com',
      },
    } as any,
    vault: vaultRoot,
  })

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['email'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 2,
    failed: 0,
    replied: 0,
    skipped: 2,
  })
  assert.deepEqual(stateProgress[0], {
    cursor: null,
    primed: true,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 0)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-partial-1' &&
        event.details ===
          'assistant reply artifacts are incomplete; will retry this capture after reply artifacts are rebuilt.',
    ),
    true,
  )

  await rm(
    path.join(
      vaultRoot,
      'derived',
      'inbox',
      'cap-partial-1',
      'assistant',
      'chat-result.json',
    ),
  )

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-partial',
    response: 'recovered reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockResolvedValueOnce({
    message: 'recovered reply',
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: 'session-partial',
      provider: 'codex-cli',
      providerSessionId: 'thread-partial',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:email|thread:chat-partial',
        channel: 'email',
        identityId: null,
        actorId: 'partial@example.com',
        threadId: 'chat-partial',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'partial@example.com',
        },
      },
      createdAt: '2026-03-18T09:03:00.000Z',
      updatedAt: '2026-03-18T09:03:00.000Z',
      lastTurnAt: '2026-03-18T09:03:00.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'email',
      target: 'partial@example.com',
      targetKind: 'thread',
      sentAt: '2026-03-18T09:03:00.000Z',
      messageLength: 'recovered reply'.length,
    },
  })

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]?.cursor ?? null,
    autoReplyPrimed: true,
    enabledChannels: ['email'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(second, {
    considered: 2,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.deepEqual(stateProgress[1], {
    cursor: {
      occurredAt: '2026-03-18T09:02:30Z',
      captureId: 'cap-partial-2',
    },
    primed: true,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
})

test('scanAssistantAutoReplyOnce does not resend after successful delivery when result artifact fan-out fails before any reply artifact exists', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-zero-artifact-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  runtimeMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-zero-artifact',
    response: 'handled reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(
    async (input: { message: string; sessionId: string }) => ({
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-zero-artifact',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: 'channel:email|thread:chat-zero-artifact',
          channel: 'email',
          identityId: null,
          actorId: 'zero@example.com',
          threadId: 'chat-zero-artifact',
          threadIsDirect: true,
          delivery: {
            kind: 'thread',
            target: 'zero@example.com',
          },
        },
        createdAt: '2026-03-18T09:03:00.000Z',
        updatedAt: '2026-03-18T09:03:00.000Z',
        lastTurnAt: '2026-03-18T09:03:00.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'email',
        target: 'zero@example.com',
        targetKind: 'thread',
        sentAt: '2026-03-18T09:03:00.000Z',
        messageLength: input.message.length,
      },
    }),
  )

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-zero-artifact',
            source: 'email',
            accountId: 'self',
            externalId: 'ext-zero-artifact',
            threadId: 'chat-zero-artifact',
            threadTitle: null,
            actorId: 'zero@example.com',
            actorName: 'Zero Artifact User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:02:00Z',
            receivedAt: null,
            text: 'Please reply once',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/zero-artifact.json',
            eventId: 'evt-zero-artifact',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-zero-artifact',
          source: 'email',
          threadTitle: null,
          threadId: 'chat-zero-artifact',
          threadIsDirect: true,
          actorId: 'zero@example.com',
          actorName: 'Zero Artifact User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:02:00Z',
          text: 'Please reply once',
          attachments: [],
        },
      }
    },
  } as any

  const outcomeWriteSpy = vi
    .spyOn(assistantAutomationArtifacts, 'writeAssistantAutoReplyGroupOutcomeArtifact')
    .mockRejectedValueOnce(new Error('artifact write failed'))

  await assert.rejects(() =>
    scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      enabledChannels: ['email'],
      inboxServices,
      onEvent(event) {
        events.push(event)
      },
      async onStateProgress(next) {
        stateProgress.push(next)
      },
      vault: vaultRoot,
    }),
  )
  outcomeWriteSpy.mockRestore()

  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  assert.equal(stateProgress.length, 0)

  const receipts = await listAssistantTurnReceipts(vaultRoot, 5)
  assert.equal(receipts.length, 1)
  assert.equal(
    receipts[0]?.timeline.find((event) => event.kind === 'turn.started')?.metadata
      ?.autoReplyCaptureId,
    'cap-zero-artifact',
  )

  await assert.rejects(
    () =>
      readFile(
        path.join(
          vaultRoot,
          'derived',
          'inbox',
          'cap-zero-artifact',
          'assistant',
          'chat-result.json',
        ),
        'utf8',
      ),
    (error) => {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT')
      return true
    },
  )
  await assert.rejects(
    () =>
      readFile(
        path.join(
          vaultRoot,
          'derived',
          'inbox',
          'cap-zero-artifact',
          'assistant',
          'chat-group-outcome.json',
        ),
        'utf8',
      ),
    (error) => {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT')
      return true
    },
  )

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['email'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(stateProgress, [
    {
      cursor: {
        occurredAt: '2026-03-18T09:02:00Z',
        captureId: 'cap-zero-artifact',
      },
      primed: true,
    },
  ])
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-zero-artifact' &&
        event.details === 'assistant reply already handled',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce only auto-replies to Telegram direct chats', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-telegram-scope-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-scope',
    response: 'direct reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      providerBinding: {
        provider: 'codex-cli',
        providerSessionId: 'thread-telegram-scope',
        providerState: null,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
      },
      alias: null,
      binding: {
        conversationKey: 'channel:telegram|thread:123',
        channel: 'telegram',
        identityId: null,
        actorId: input.actorId ?? null,
        threadId: input.threadId,
        threadIsDirect: input.threadIsDirect,
        delivery: {
          kind: 'thread',
          target: input.threadId,
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: input.threadId,
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-group',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '-1001',
            threadTitle: 'Group',
            actorId: '111',
            actorName: 'Group Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'hello group',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/group.json',
            eventId: 'evt-group',
            promotions: [],
          },
          {
            captureId: 'cap-direct',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '222',
            actorName: 'Direct Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: 'hello direct',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/direct.json',
            eventId: 'evt-direct',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      if (input.captureId === 'cap-group') {
        return {
          capture: {
            captureId: 'cap-group',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '-1001',
            threadTitle: 'Group',
            threadIsDirect: false,
            actorId: '111',
            actorName: 'Group Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'hello group',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/group.json',
            eventId: 'evt-group',
            createdAt: '2026-03-18T09:00:00Z',
            promotions: [],
            attachments: [],
          },
        }
      }

      return {
        capture: {
          captureId: 'cap-direct',
          source: 'telegram',
          accountId: 'bot',
          externalId: 'update:2',
          threadId: '123',
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId: '222',
          actorName: 'Direct Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:01:00Z',
          receivedAt: null,
          text: 'hello direct',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/direct.json',
          eventId: 'evt-direct',
          createdAt: '2026-03-18T09:01:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 0,
    replied: 1,
    skipped: 1,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(
    runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.userPrompt.includes('hello direct'),
    true,
  )
})

test('scanAssistantAutoReplyOnce aborts stalled provider turns and retries the same capture with recovered provider continuity', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-stall-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockImplementationOnce(
      (input: {
        abortSignal?: AbortSignal
        onEvent?: (event: {
          id: string | null
          kind:
            | 'command'
            | 'file'
            | 'message'
            | 'plan'
            | 'reasoning'
            | 'search'
            | 'status'
            | 'tool'
          rawEvent: unknown
          state: 'completed' | 'running'
          text: string
        }) => void
      }) =>
        new Promise((_, reject) => {
          input.onEvent?.({
            id: 'search-1',
            kind: 'search',
            rawEvent: {
              type: 'item.started',
            },
            state: 'running',
            text: 'Web: treehouse menu',
          })

          const interrupt = () => {
            reject(
              new VaultCliError(
                'ASSISTANT_CODEX_INTERRUPTED',
                'Codex CLI was interrupted.',
                {
                  interrupted: true,
                  providerSessionId: 'thread-stall-1',
                  retryable: false,
                },
              ),
            )
          }

          if (input.abortSignal?.aborted) {
            interrupt()
            return
          }

          input.abortSignal?.addEventListener('abort', interrupt, {
            once: true,
          })
        }),
    )
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-stall-1',
      response: 'retried reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      providerBinding: {
        provider: 'codex-cli',
        providerSessionId: 'thread-stall-1',
        providerState: null,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
      },
      alias: null,
      binding: {
        conversationKey: 'channel:telegram|thread:thread-stall',
        channel: 'telegram',
        identityId: null,
        actorId: 'telegram:123',
        threadId: 'thread-stall',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'thread-stall',
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: 'thread-stall',
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{
    captureId?: string
    details?: string
    providerKind?: string
    providerState?: string
    type: string
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-stall',
            source: 'telegram',
            accountId: 'self',
            externalId: 'ext-stall',
            threadId: 'thread-stall',
            threadTitle: 'Stall chat',
            actorId: 'telegram:123',
            actorName: 'Retry User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:10:00Z',
            receivedAt: null,
            text: 'Can you follow up?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/stall.json',
            eventId: 'evt-stall',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-stall',
          source: 'telegram',
          accountId: 'self',
          externalId: 'ext-stall',
          threadId: 'thread-stall',
          threadTitle: 'Stall chat',
          threadIsDirect: true,
          actorId: 'telegram:123',
          actorName: 'Retry User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:10:00Z',
          receivedAt: null,
          text: 'Can you follow up?',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/stall.json',
          eventId: 'evt-stall',
          createdAt: '2026-03-18T09:10:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const firstPromise = scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    providerHeartbeatMs: 10,
    providerStallTimeoutMs: 25,
    vault: vaultRoot,
  })

  const first = await firstPromise

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]?.cursor ?? null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.deepEqual(stateProgress[0], {
    cursor: null,
    primed: true,
  })
  assert.deepEqual(stateProgress[1], {
    cursor: {
      occurredAt: '2026-03-18T09:10:00Z',
      captureId: 'cap-stall',
    },
    primed: true,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  assert.equal(
    runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    'thread-stall-1',
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-stall' &&
        event.providerKind === 'status' &&
        event.details?.startsWith('assistant provider stalled after '),
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-stall' &&
        event.details ===
          'assistant provider stalled without progress; will retry this capture.',
    ),
    true,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    actorId: 'telegram:123',
    threadId: 'thread-stall',
    threadIsDirect: true,
    provider: 'codex-cli',
    model: null,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    oss: false,
    profile: null,
    reasoningEffort: null,
    maxSessionAgeMs: null,
  })

  assert.equal(resolved.session.providerBinding?.providerSessionId, 'thread-stall-1')
})

test('scanAssistantAutoReplyOnce keeps long-running deepthink commands past the default stall window before retrying', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-deepthink-watchdog-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockImplementation(
    (input: {
      abortSignal?: AbortSignal
      onEvent?: (event: {
        id: string | null
        kind:
          | 'command'
          | 'file'
          | 'message'
          | 'plan'
          | 'reasoning'
          | 'search'
          | 'status'
          | 'tool'
        rawEvent: unknown
        state: 'completed' | 'running'
        text: string
      }) => void
    }) =>
      new Promise((_, reject) => {
        input.onEvent?.({
          id: 'cmd-deepthink-1',
          kind: 'command',
          rawEvent: {
            type: 'item.started',
          },
          state: 'running',
          text: '$ vault-cli deepthink "Think through the rollout tradeoffs"',
        })

        const interrupt = () => {
          reject(
            new VaultCliError(
              'ASSISTANT_CODEX_INTERRUPTED',
              'Codex CLI was interrupted.',
              {
                interrupted: true,
                providerSessionId: 'thread-deepthink-1',
                retryable: false,
              },
            ),
          )
        }

        if (input.abortSignal?.aborted) {
          interrupt()
          return
        }

        input.abortSignal?.addEventListener('abort', interrupt, {
          once: true,
        })
      }),
  )

  const events: Array<{
    captureId?: string
    details?: string
    providerKind?: string
    providerState?: string
    type: string
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-deepthink',
            source: 'telegram',
            accountId: 'self',
            externalId: 'ext-deepthink',
            threadId: 'thread-deepthink',
            threadTitle: 'Deepthink chat',
            actorId: 'telegram:789',
            actorName: 'Deepthink User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:15:00Z',
            receivedAt: null,
            text: 'Please think deeply about this.',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/deepthink.json',
            eventId: 'evt-deepthink',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-deepthink',
          source: 'telegram',
          accountId: 'self',
          externalId: 'ext-deepthink',
          threadId: 'thread-deepthink',
          threadTitle: 'Deepthink chat',
          threadIsDirect: true,
          actorId: 'telegram:789',
          actorName: 'Deepthink User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:15:00Z',
          receivedAt: null,
          text: 'Please think deeply about this.',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/deepthink.json',
          eventId: 'evt-deepthink',
          createdAt: '2026-03-18T09:15:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  let settled = false
  const runPromise = scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    providerHeartbeatMs: 10,
    providerLongRunningCommandStallTimeoutMs: 100,
    providerStallTimeoutMs: 25,
    vault: vaultRoot,
  }).finally(() => {
    settled = true
  })

  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(settled, false)

  const result = await runPromise

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-deepthink' &&
        event.providerState === 'running',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce defers reconnectable provider failures and preserves the resumable session without duplicating transcript turns', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-reconnect-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_CONNECTION_LOST',
      'Codex CLI lost its connection while waiting for the model.',
      {
        connectionLost: true,
        providerSessionId: 'thread-retry-1',
        retryable: true,
      },
    ),
  )

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{ type: string; captureId?: string; details?: string }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-retry',
            source: 'telegram',
            accountId: 'self',
            externalId: 'ext-retry',
            threadId: 'thread-retry',
            threadTitle: 'Retry chat',
            actorId: 'telegram:123',
            actorName: 'Retry User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:10:00Z',
            receivedAt: null,
            text: 'Can you follow up?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/retry.json',
            eventId: 'evt-retry',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-retry',
          source: 'telegram',
          accountId: 'self',
          externalId: 'ext-retry',
          threadId: 'thread-retry',
          threadTitle: 'Retry chat',
          threadIsDirect: true,
          actorId: 'telegram:123',
          actorName: 'Retry User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:10:00Z',
          receivedAt: null,
          text: 'Can you follow up?',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/retry.json',
          eventId: 'evt-retry',
          createdAt: '2026-03-18T09:10:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]?.cursor ?? null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.deepEqual(stateProgress[0], {
    cursor: null,
    primed: true,
  })
  assert.deepEqual(stateProgress[1], {
    cursor: null,
    primed: true,
  })
  assert.equal(
    runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    'thread-retry-1',
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-retry' &&
        event.details?.includes('Will retry this capture after the provider reconnects.'),
    ),
    true,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    actorId: 'telegram:123',
    threadId: 'thread-retry',
    threadIsDirect: true,
    provider: 'codex-cli',
    model: null,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    oss: false,
    profile: null,
    reasoningEffort: null,
    maxSessionAgeMs: null,
  })

  assert.equal(
    resolved.session.providerBinding?.providerSessionId ?? null,
    'thread-retry-1',
  )
  assert.equal(resolved.session.turnCount, 0)
  assert.deepEqual(
    (await listAssistantTranscriptEntries(vaultRoot, resolved.session.sessionId)).map(
      (entry) => ({
        kind: entry.kind,
        text: entry.text,
      }),
    ),
    [
      {
        kind: 'error',
        text:
          'Failed assistant prompt attempt [automation-auto-reply]: Can you follow up?',
      },
    ],
  )
})

test('scanAssistantAutoReplyOnce keeps scanning after a failed Telegram delivery and records the failure artifact', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-telegram-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-failure',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-failure',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  const deliveryFailure = Object.assign(new Error('Telegram delivery failed'), {
    context: {
      error: 'upstream send failed for private-target-987',
      migrateToChatId: 'private-chat-654',
      status: 429,
      target: 'private-target-987',
    },
  })
  runtimeMocks.deliverAssistantMessageOverBinding
    .mockRejectedValueOnce(deliveryFailure)
    .mockImplementationOnce(async (input: any) => ({
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        providerBinding: {
          provider: 'codex-cli',
          providerSessionId: 'thread-telegram-failure',
          providerState: null,
          providerOptions: {
            model: null,
            reasoningEffort: null,
            sandbox: 'read-only',
            approvalPolicy: 'never',
            profile: null,
            oss: false,
          },
        },
        alias: null,
        binding: {
          conversationKey: `channel:telegram|thread:${input.threadId}`,
          channel: 'telegram',
          identityId: null,
          actorId: input.actorId ?? null,
          threadId: input.threadId,
          threadIsDirect: input.threadIsDirect,
          delivery: {
            kind: 'thread',
            target: input.threadId,
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'telegram',
        target: input.threadId,
        targetKind: 'thread',
        sentAt: '2026-03-18T00:00:01.000Z',
        messageLength: input.message.length,
      },
    }))

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{
    captureId?: string
    details?: string
    errorCode?: string
    safeDetails?: string
    type: string
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-fail',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'first question',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/fail.json',
            eventId: 'evt-fail',
            promotions: [],
          },
          {
            captureId: 'cap-pass',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '456',
            threadTitle: 'Direct',
            actorId: '222',
            actorName: 'Alice',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: 'second question',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/pass.json',
            eventId: 'evt-pass',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const directThreadId = input.captureId === 'cap-fail' ? '123' : '456'
      const actorId = input.captureId === 'cap-fail' ? '111' : '222'
      const actorName = input.captureId === 'cap-fail' ? 'Bob' : 'Alice'
      const text = input.captureId === 'cap-fail' ? 'first question' : 'second question'
      const captureId = input.captureId

      return {
        capture: {
          captureId,
          source: 'telegram',
          accountId: 'bot',
          externalId: captureId === 'cap-fail' ? 'update:1' : 'update:2',
          threadId: directThreadId,
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId,
          actorName,
          actorIsSelf: false,
          occurredAt: captureId === 'cap-fail' ? '2026-03-18T09:00:00Z' : '2026-03-18T09:01:00Z',
          receivedAt: null,
          text,
          attachmentCount: 0,
          envelopePath: captureId === 'cap-fail' ? 'raw/inbox/fail.json' : 'raw/inbox/pass.json',
          eventId: captureId === 'cap-fail' ? 'evt-fail' : 'evt-pass',
          createdAt: captureId === 'cap-fail' ? '2026-03-18T09:00:00Z' : '2026-03-18T09:01:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    vault: vaultRoot,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 1,
    replied: 1,
    skipped: 0,
  })
  assert.deepEqual(stateProgress.at(-1), {
    cursor: {
      occurredAt: '2026-03-18T09:01:00Z',
      captureId: 'cap-pass',
    },
    primed: true,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 2)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-failed' &&
        event.captureId === 'cap-fail' &&
        event.errorCode === undefined &&
        event.safeDetails === 'outbound delivery failed',
    ),
    true,
  )

  const errorArtifactRaw = await readFile(
    path.join(
      vaultRoot,
      'derived',
      'inbox',
      'cap-fail',
      'assistant',
      'chat-error.json',
    ),
    'utf8',
  )
  const errorArtifact = JSON.parse(errorArtifactRaw)
  assert.equal(errorArtifact.schema, 'murph.assistant-chat-error.v1')
  assert.equal(errorArtifact.code, null)
  assert.equal(errorArtifact.kind, 'delivery')
  assert.equal(errorArtifact.retryable, null)
  assert.equal(errorArtifact.safeSummary, 'outbound delivery failed')
  assert.match(errorArtifact.context.outboxIntentId, /^outbox_[a-z0-9]+$/u)
  assert.equal(
    (
      await readdir(resolveAssistantStatePaths(vaultRoot).outboxDirectory)
    ).includes(`${errorArtifact.context.outboxIntentId}.json`),
    true,
  )
  assert.equal('target' in errorArtifact.context, false)
  assert.equal('migrateToChatId' in errorArtifact.context, false)
  assert.equal('error' in errorArtifact.context, false)
  assert.equal(errorArtifactRaw.includes('private-target-987'), false)
  assert.equal(errorArtifactRaw.includes('private-chat-654'), false)

  const successArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-pass',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.equal(successArtifact.captureId, 'cap-pass')
})

test('scanAssistantAutoReplyOnce records provider quota failures with a safe summary', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-auto-reply-usage-limit-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockRejectedValueOnce(
    new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      "Codex CLI failed. exit code 1. You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Apr 3rd, 2026 1:20 PM.",
      {
        providerSessionId: 'thread-usage-limit',
        retryable: false,
      },
    ),
  )

  const events: Array<{
    captureId?: string
    details?: string
    errorCode?: string
    safeDetails?: string
    type: string
  }> = []

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices: {
      async list() {
        return {
          items: [
            {
              captureId: 'cap-usage-limit',
              source: 'telegram',
              accountId: 'bot',
              externalId: 'update:usage-limit',
              threadId: '123',
              threadTitle: 'Direct',
              actorId: '111',
              actorName: 'Bob',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:00:00Z',
              receivedAt: null,
              text: 'hello there',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/usage-limit.json',
              eventId: 'evt-usage-limit',
              promotions: [],
            },
          ],
        }
      },
      async show() {
        return {
          capture: {
            captureId: 'cap-usage-limit',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:usage-limit',
            threadId: '123',
            threadTitle: 'Direct',
            threadIsDirect: true,
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'hello there',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/usage-limit.json',
            eventId: 'evt-usage-limit',
            createdAt: '2026-03-18T09:00:00Z',
            promotions: [],
            attachments: [],
          },
        }
      },
    } as any,
    onEvent(event) {
      events.push(event)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 1,
    replied: 0,
    skipped: 0,
  })
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-failed' &&
        event.captureId === 'cap-usage-limit' &&
        event.errorCode === 'ASSISTANT_CODEX_FAILED' &&
        event.safeDetails ===
          'provider usage limit reached (ASSISTANT_CODEX_FAILED)' &&
        event.details?.includes('usage limit'),
    ),
    true,
  )

  const errorArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-usage-limit',
        'assistant',
        'chat-error.json',
      ),
      'utf8',
    ),
  )

  assert.equal(errorArtifact.schema, 'murph.assistant-chat-error.v1')
  assert.equal(errorArtifact.code, 'ASSISTANT_CODEX_FAILED')
  assert.equal(errorArtifact.kind, 'provider')
  assert.equal(errorArtifact.retryable, false)
  assert.equal(
    errorArtifact.safeSummary,
    'provider usage limit reached (ASSISTANT_CODEX_FAILED)',
  )
  assert.equal(errorArtifact.context.providerSessionId, 'thread-usage-limit')
})

test('scanAssistantAutoReplyOnce groups Telegram media albums into one assistant reply', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-telegram-album-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(path.join(vaultRoot, 'raw', 'inbox'), {
    recursive: true,
  })
  cleanupPaths.push(parent)

  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-1.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            message_id: 101,
            media_group_id: 'album-7',
          },
        },
      },
    }),
    'utf8',
  )
  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-2.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            message_id: 102,
            media_group_id: 'album-7',
          },
        },
      },
    }),
    'utf8',
  )

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-album',
    response: 'album reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      providerBinding: {
        provider: 'codex-cli',
        providerSessionId: 'thread-telegram-album',
        providerState: null,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
      },
      alias: null,
      binding: {
        conversationKey: 'channel:telegram|thread:123',
        channel: 'telegram',
        identityId: null,
        actorId: '111',
        threadId: '123',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: '123',
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: '123',
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-album-1',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'photo set',
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-1.json',
            eventId: 'evt-album-1',
            promotions: [],
          },
          {
            captureId: 'cap-album-2',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:01Z',
            receivedAt: null,
            text: null,
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-2.json',
            eventId: 'evt-album-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const first = input.captureId === 'cap-album-1'
      return {
        capture: {
          captureId: input.captureId,
          source: 'telegram',
          accountId: 'bot',
          externalId: first ? 'update:1' : 'update:2',
          threadId: '123',
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId: '111',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: first ? '2026-03-18T09:00:00Z' : '2026-03-18T09:00:01Z',
          receivedAt: null,
          text: first ? 'photo set' : null,
          attachmentCount: 1,
          envelopePath: first ? 'raw/inbox/album-1.json' : 'raw/inbox/album-2.json',
          eventId: first ? 'evt-album-1' : 'evt-album-2',
          createdAt: first ? '2026-03-18T09:00:00Z' : '2026-03-18T09:00:01Z',
          promotions: [],
          attachments: [
            {
              ordinal: 1,
              kind: 'image',
              fileName: first ? 'meal-1.jpg' : 'meal-2.jpg',
              transcriptText: null,
              extractedText: first ? 'plate one' : 'plate two',
              parseState: 'succeeded',
            },
          ],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  const deliveryCall = runtimeMocks.deliverAssistantMessageOverBinding.mock.calls[0]?.[0]
  assert.equal(deliveryCall?.replyToMessageId, '102')

  const firstArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-album-1',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  const secondArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-album-2',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.deepEqual(firstArtifact.groupCaptureIds, ['cap-album-1', 'cap-album-2'])
  assert.deepEqual(secondArtifact.groupCaptureIds, ['cap-album-1', 'cap-album-2'])
})

test('scanAssistantAutoReplyOnce does not group Telegram media albums across accounts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-telegram-album-accounts-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(path.join(vaultRoot, 'raw', 'inbox'), {
    recursive: true,
  })
  cleanupPaths.push(parent)

  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-a.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            message_id: 201,
            media_group_id: 'album-9',
          },
        },
      },
    }),
    'utf8',
  )
  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-b.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            message_id: 202,
            media_group_id: 'album-9',
          },
        },
      },
    }),
    'utf8',
  )

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-album-accounts',
    response: 'album reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    message: input.message,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      providerBinding: {
        provider: 'codex-cli',
        providerSessionId: 'thread-telegram-album-accounts',
        providerState: null,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
      },
      alias: null,
      binding: {
        conversationKey: `channel:telegram|thread:${input.threadId}`,
        channel: 'telegram',
        identityId: null,
        actorId: '111',
        threadId: input.threadId,
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: input.threadId,
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: input.threadId,
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-album-a',
            source: 'telegram',
            accountId: 'bot-a',
            externalId: 'update:10',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T10:00:00Z',
            receivedAt: null,
            text: 'photo from bot a',
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-a.json',
            eventId: 'evt-album-a',
            promotions: [],
          },
          {
            captureId: 'cap-album-b',
            source: 'telegram',
            accountId: 'bot-b',
            externalId: 'update:11',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T10:00:01Z',
            receivedAt: null,
            text: 'photo from bot b',
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-b.json',
            eventId: 'evt-album-b',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const first = input.captureId === 'cap-album-a'
      return {
        capture: {
          captureId: input.captureId,
          source: 'telegram',
          accountId: first ? 'bot-a' : 'bot-b',
          externalId: first ? 'update:10' : 'update:11',
          threadId: '123',
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId: '111',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: first ? '2026-03-18T10:00:00Z' : '2026-03-18T10:00:01Z',
          receivedAt: null,
          text: first ? 'photo from bot a' : 'photo from bot b',
          attachmentCount: 1,
          envelopePath: first ? 'raw/inbox/album-a.json' : 'raw/inbox/album-b.json',
          eventId: first ? 'evt-album-a' : 'evt-album-b',
          createdAt: first ? '2026-03-18T10:00:00Z' : '2026-03-18T10:00:01Z',
          promotions: [],
          attachments: [
            {
              ordinal: 1,
              kind: 'image',
              fileName: first ? 'meal-a.jpg' : 'meal-b.jpg',
              transcriptText: null,
              extractedText: first ? 'plate a' : 'plate b',
              parseState: 'succeeded',
            },
          ],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 0,
    replied: 2,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 2)
})

test('runAssistantAutomation merges routing and reply into one inbox decision pass', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-unified-scan-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.routeInboxCaptureWithModel.mockResolvedValue({
    plan: {
      actions: [
        {
          tool: 'meal.add',
        },
      ],
    },
  })
  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-auto',
    response: 'auto reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(
    async (input: any) => ({
      message: input.message,
      session: {
        schema: 'murph.assistant-session.v3',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-auto',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: 'channel:imessage|thread:chat-2',
          channel: 'imessage',
          identityId: null,
          actorId: '+15551234567',
          threadId: 'chat-2',
          threadIsDirect: true,
          delivery: {
            kind: 'participant',
            target: '+15551234567',
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'imessage',
        target: '+15551234567',
        targetKind: 'participant',
        sentAt: '2026-03-18T00:00:01.000Z',
        messageLength: input.message.length,
      },
    }),
  )

  await saveAssistantAutomationState(vaultRoot, {
    version: 2,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: ['imessage'],
    preferredChannels: [],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    updatedAt: '2026-03-18T00:00:00.000Z',
  })

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const listCalls: Array<{
    afterCaptureId?: string | null
    afterOccurredAt?: string | null
    oldestFirst?: boolean
  }> = []
  const inboxServices = {
    async list(input: any) {
      listCalls.push({
        afterCaptureId: input.afterCaptureId,
        afterOccurredAt: input.afterOccurredAt,
        oldestFirst: input.oldestFirst,
      })
      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-2',
            threadId: 'chat-2',
            threadTitle: null,
            actorId: '+15551234567',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:05:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/2.json',
            eventId: 'evt-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      assert.equal(input.captureId, 'cap-new')
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-2',
          threadIsDirect: true,
          actorId: '+15551234567',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: true,
    startDaemon: false,
    inboxServices,
    modelSpec: {
      model: 'gpt-oss:20b',
    },
    onEvent(event) {
      events.push(event)
    },
  })

  assert.equal(result.considered, 1)
  assert.equal(result.routed, 1)
  assert.equal(result.replyConsidered, 1)
  assert.equal(result.replied, 1)
  assert.equal(listCalls.length, 2)
  assert.equal(
    events.filter((event) => event.type === 'scan.started').length,
    1,
  )
  assert.equal(
    events.some((event) => event.type === 'reply.scan.started'),
    false,
  )
  assert.equal(
    events.some(
      (event) => event.type === 'capture.routed' && event.captureId === 'cap-new',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) => event.type === 'capture.replied' && event.captureId === 'cap-new',
    ),
    true,
  )

  const state = await readAssistantAutomationState(vaultRoot)
  assert.deepEqual(state.inboxScanCursor, {
    occurredAt: '2026-03-18T09:05:00Z',
    captureId: 'cap-new',
  })
  assert.deepEqual(state.autoReplyScanCursor, {
    occurredAt: '2026-03-18T09:05:00Z',
    captureId: 'cap-new',
  })
})

test('runAssistantAutomation rejects concurrent runs for the same vault and releases the lock after shutdown', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-run-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const signal = new AbortController()
  const firstRun = runAssistantAutomation({
    vault: vaultRoot,
    once: false,
    startDaemon: false,
    scanIntervalMs: 1_000,
    signal: signal.signal,
    inboxServices: {} as any,
  })

  await new Promise((resolve) => setTimeout(resolve, 25))

  await assert.rejects(
    () =>
      runAssistantAutomation({
        vault: vaultRoot,
        once: true,
        startDaemon: false,
        inboxServices: {} as any,
      }),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_AUTOMATION_ALREADY_RUNNING')
      assert.equal(error.context?.pid, process.pid)
      return true
    },
  )

  signal.abort()
  const firstResult = await firstRun
  assert.equal(firstResult.reason, 'signal')

  const secondResult = await runAssistantAutomation({
    vault: vaultRoot,
    once: true,
    startDaemon: false,
    inboxServices: {} as any,
  })
  assert.equal(secondResult.reason, 'completed')
})

test('runAssistantAutomation clears stale run locks before starting', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-stale-run-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.join(paths.assistantStateRoot, '.automation-run.lock'), {
    recursive: true,
  })
  await writeFile(
    path.join(paths.assistantStateRoot, '.automation-run-lock.json'),
    JSON.stringify({
      command: 'node murph assistant run',
      mode: 'continuous',
      pid: 999_999,
      startedAt: '2026-03-26T00:00:00.000Z',
    }),
    'utf8',
  )

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: true,
    startDaemon: false,
    inboxServices: {} as any,
  })

  assert.equal(result.reason, 'completed')
})

test('runAssistantAutomation reports daemon failures as error results', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-daemon-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const assistantEvents: Array<{ type: string; details?: string }> = []
  const inboxEvents: Array<{ type: string; connectorId?: string; source?: string }> = []

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: false,
    scanIntervalMs: 5,
    modelSpec: {
      model: 'gpt-oss:20b',
    },
    inboxServices: {
      list: async () => ({
        items: [],
      }),
      run: async (_input: unknown, options?: { onEvent?: (event: unknown) => void }) => {
        options?.onEvent?.({
          type: 'connector.watch.started',
          connectorId: 'imessage:self',
          source: 'imessage',
        })
        throw new Error('daemon exploded')
      },
    } as any,
    onEvent(event) {
      assistantEvents.push(event)
    },
    onInboxEvent(event) {
      inboxEvents.push(event)
    },
  })

  assert.equal(result.reason, 'error')
  assert.equal(result.daemonStarted, true)
  assert.equal(result.lastError, 'daemon exploded')
  assert.equal(result.scans, 0)
  assert.equal(result.replyConsidered, 0)
  assert.equal(result.replied, 0)
  assert.equal(result.replySkipped, 0)
  assert.equal(result.replyFailed, 0)
  assert.equal(
    inboxEvents.some(
      (event) =>
        event.type === 'connector.watch.started' &&
        event.connectorId === 'imessage:self' &&
        event.source === 'imessage',
    ),
    true,
  )
  assert.equal(
    assistantEvents.some(
      (event) => event.type === 'daemon.failed' && event.details === 'daemon exploded',
    ),
    true,
  )
})

test('runAssistantAutomation preserves structured daemon failure details in the aggregate result', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-daemon-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const assistantEvents: Array<{ type: string; details?: string }> = []
  const structuredError = Object.assign(
    new Error('Vault metadata failed contract validation.'),
    {
      code: 'VAULT_INVALID_METADATA',
      details: {
        errors: [
          '$.idPolicy.prefixes.protocol: Invalid input: expected "prot"',
          '$.paths: Unrecognized key: "regimensRoot"',
        ],
        repairedFields: ['paths.protocolsRoot'],
      },
    },
  )

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: false,
    scanIntervalMs: 5,
    modelSpec: {
      model: 'gpt-oss:20b',
    },
    inboxServices: {
      list: async () => ({
        items: [],
      }),
      run: async () => {
        throw structuredError
      },
    } as any,
    onEvent(event) {
      assistantEvents.push(event)
    },
  })

  const expectedDetail = [
    'Vault metadata failed contract validation.',
    'details:',
    '- $.idPolicy.prefixes.protocol: Invalid input: expected "prot"',
    '- $.paths: Unrecognized key: "regimensRoot"',
    'compatibility repairs detected:',
    '- paths.protocolsRoot',
  ].join('\n')

  assert.equal(result.reason, 'error')
  assert.equal(result.lastError, expectedDetail)
  assert.equal(
    assistantEvents.some(
      (event) => event.type === 'daemon.failed' && event.details === expectedDetail,
    ),
    true,
  )
})

test('bridgeAbortSignals forces process exit after local SIGINT grace when teardown hangs', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, undefined, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    process.emit('SIGINT')
    assert.equal(controller.signal.aborted, true)
    assert.deepEqual(exitCodes, [])

    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [130])
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})

test('bridgeAbortSignals cancels forced exit when teardown completes inside the grace period', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, undefined, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    process.emit('SIGINT')
    assert.equal(controller.signal.aborted, true)

    cleanup()
    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [])
  } finally {
    vi.useRealTimers()
  }
})

test('bridgeAbortSignals keeps upstream aborts non-fatal', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const upstream = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, upstream.signal, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    upstream.abort()
    assert.equal(controller.signal.aborted, true)

    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [])
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})

test('runAssistantChat delegates to the Ink UI implementation', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-chat-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.runAssistantChatWithInk.mockResolvedValue({
    vault: vaultRoot,
    startedAt: '2026-03-17T00:00:00.000Z',
    stoppedAt: '2026-03-17T00:00:01.000Z',
    turns: 2,
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: 'asst_123',
      provider: 'codex-cli',
      providerSessionId: 'thread-ink',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: 'chat:bob',
      binding: {
        conversationKey: null,
        channel: null,
        identityId: null,
        actorId: null,
        threadId: null,
        threadIsDirect: null,
        delivery: null,
      },
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:01.000Z',
      lastTurnAt: '2026-03-17T00:00:01.000Z',
      turnCount: 2,
    },
  })

  const result = await runAssistantChat({
    vault: vaultRoot,
    alias: 'chat:bob',
    initialPrompt: 'hello',
  })

  assert.equal(result.session.sessionId, 'asst_123')
  assert.equal(result.turns, 2)
  assert.deepEqual(runtimeMocks.runAssistantChatWithInk.mock.calls, [
    [
      {
        vault: vaultRoot,
        alias: 'chat:bob',
        initialPrompt: 'hello',
      },
    ],
  ])
})

test('runAssistantChat surfaces Ink chat errors to the caller', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-chat-error-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.runAssistantChatWithInk.mockRejectedValue(new Error('ink exploded'))

  await assert.rejects(
    runAssistantChat({
      vault: vaultRoot,
    }),
    /ink exploded/u,
  )
})

test('assistant Ink resyncs the next turn selection after a failover-updated session', () => {
  const previousSession = {
    schema: 'murph.assistant-session.v3',
    sessionId: 'asst_failover_prev',
    provider: 'codex-cli',
    providerSessionId: 'thread-primary',
    providerOptions: {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      profile: null,
      oss: false,
    },
    alias: 'chat:failover-sync',
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: '2026-03-17T00:00:00.000Z',
    turnCount: 1,
  } as const
  const nextSession = {
    ...previousSession,
    provider: 'openai-compatible',
    providerSessionId: 'thread-backup',
    updatedAt: '2026-03-17T00:00:02.000Z',
    providerOptions: {
      ...previousSession.providerOptions,
      model: 'backup-model',
      reasoningEffort: null,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama',
    },
  } as const

  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'gpt-5.4',
        activeReasoningEffort: 'high',
      },
      previousSession,
      nextSession,
    }),
    {
      activeModel: 'backup-model',
      activeReasoningEffort: null,
    },
  )
})

test('assistant Ink preserves explicit selections when unrelated same-provider session options change', () => {
  const previousSession = {
    schema: 'murph.assistant-session.v3',
    sessionId: 'asst_same_provider_route_change',
    provider: 'openai-compatible',
    providerSessionId: null,
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama-a',
      headers: null,
    },
    alias: 'chat:same-provider-route-change',
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 1,
  } as const
  const nextSession = {
    ...previousSession,
    updatedAt: '2026-03-17T00:00:02.000Z',
    providerOptions: {
      ...previousSession.providerOptions,
      baseUrl: 'http://127.0.0.1:22434/v1',
      apiKeyEnv: 'BACKUP_OLLAMA_API_KEY',
      providerName: 'ollama-b',
    },
  } as const

  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'stale-default-model',
        activeReasoningEffort: null,
      },
      previousSession,
      nextSession,
    }),
    {
      activeModel: 'stale-default-model',
      activeReasoningEffort: null,
    },
  )
})

test('assistant Ink view-model replays persisted local transcript entries', () => {
  const entries = seedChatEntries([
    {
      schema: 'murph.assistant-transcript-entry.v1',
      kind: 'user',
      text: 'hello',
      createdAt: '2026-03-17T00:00:00.000Z',
    },
    {
      schema: 'murph.assistant-transcript-entry.v1',
      kind: 'assistant',
      text: 'hi',
      createdAt: '2026-03-17T00:00:01.000Z',
    },
    {
      schema: 'murph.assistant-transcript-entry.v1',
      kind: 'error',
      text: 'boom',
      createdAt: '2026-03-17T00:00:02.000Z',
    },
  ])

  assert.deepEqual(entries, [
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'assistant',
      text: 'hi',
    },
    {
      kind: 'error',
      text: 'boom',
    },
  ])
})

test('assistant Ink view-model merges streaming trace updates by stream key', () => {
  const entries = applyInkChatTraceUpdates(
    [
      {
        kind: 'user',
        text: 'hello',
      },
    ],
    [
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: 'turn-1:thinking:main',
        text: 'Checking files',
      },
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: 'turn-1:thinking:main',
        text: '…',
      },
      {
        kind: 'assistant',
        mode: 'replace',
        streamKey: 'turn-1:assistant:main',
        text: 'Hi there.',
      },
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'turn-1:status:connection',
        text: 'Reconnecting…',
      },
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'turn-1:status:connection',
        text: 'Reconnected.',
      },
    ],
  )

  assert.deepEqual(entries, [
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'thinking',
      streamKey: 'turn-1:thinking:main',
      text: 'Checking files…',
    },
    {
      kind: 'assistant',
      streamKey: 'turn-1:assistant:main',
      text: 'Hi there.',
    },
    {
      kind: 'status',
      streamKey: 'turn-1:status:connection',
      text: 'Reconnected.',
    },
  ])
})

test('assistant Ink view-model upserts provider progress rows and ignores final message events', () => {
  const started = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'turn-1:reason-1',
      kind: 'reasoning',
      state: 'running',
      text: 'Thinking…',
      rawEvent: {
        type: 'item.started',
      },
    },
  })

  assert.deepEqual(started, [
    {
      kind: 'trace',
      pending: true,
      text: 'Thinking…',
      traceId: 'turn-1:reason-1',
      traceKind: 'reasoning',
    },
  ])

  const completed = applyProviderProgressEventToEntries({
    entries: started,
    event: {
      id: 'turn-1:reason-1',
      kind: 'reasoning',
      state: 'completed',
      text: 'Thought through the next step.',
      rawEvent: {
        type: 'item.completed',
      },
    },
  })

  assert.deepEqual(completed, [
    {
      kind: 'trace',
      pending: false,
      text: 'Thought through the next step.',
      traceId: 'turn-1:reason-1',
      traceKind: 'reasoning',
    },
  ])

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: completed,
      event: {
        id: 'turn-1:msg-1',
        kind: 'message',
        state: 'completed',
        text: 'final answer',
        rawEvent: {
          type: 'item.completed',
        },
      },
    }),
    completed,
  )
})

test('assistant Ink view-model preserves prior progress rows when later turns use the same raw provider item ids', () => {
  const firstTurn = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'turn-1:codex-connection-status',
      kind: 'status',
      state: 'running',
      text: 'Re-connecting...',
      rawEvent: {
        type: 'stderr',
      },
    },
  })

  const secondTurn = applyProviderProgressEventToEntries({
    entries: firstTurn,
    event: {
      id: 'turn-2:codex-connection-status',
      kind: 'status',
      state: 'completed',
      text: 'Exceeded retry limit.',
      rawEvent: {
        type: 'stderr',
      },
    },
  })

  assert.deepEqual(secondTurn, [
    {
      kind: 'trace',
      pending: true,
      text: 'Re-connecting...',
      traceId: 'turn-1:codex-connection-status',
      traceKind: 'status',
    },
    {
      kind: 'trace',
      pending: false,
      text: 'Exceeded retry limit.',
      traceId: 'turn-2:codex-connection-status',
      traceKind: 'status',
    },
  ])
})

test('assistant Ink view-model exposes codex-style footer metadata and busy copy', () => {
  const session = {
    schema: 'murph.assistant-session.v3',
    sessionId: 'asst_demo',
    provider: 'codex-cli',
    providerSessionId: null,
    providerOptions: {
      model: 'gpt-5.4',
      reasoningEffort: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: null,
      oss: false,
    },
    alias: null,
    binding: {
      conversationKey: null,
      channel: 'imessage',
      identityId: null,
      actorId: 'contact:bob',
      threadId: 'thread-123',
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  } as const

  assert.equal(
    CHAT_BANNER,
    'Local-first chat backed by transcript history and resumable provider sessions when available.',
  )
  assert.equal(
    CHAT_COMPOSER_HINT,
    'Enter send · Tab queue when busy · Shift+Enter newline · Esc pause · /model switch model · /session show session · /exit quit',
  )
  assert.deepEqual(CHAT_STARTER_SUGGESTIONS, [
    'Summarize recent sleep and recovery',
    'Review meal and workout patterns',
    'Find recent health anomalies',
  ])
  assert.equal(shouldShowChatComposerGuidance(0), true)
  assert.equal(shouldShowChatComposerGuidance(1), false)
  assert.equal(resolveMessageRoleLabel('assistant'), null)
  assert.equal(resolveMessageRoleLabel('error'), 'error')
  assert.equal(resolveMessageRoleLabel('user'), null)

  const plainPanel = resolveChromePanelBoxProps({})
  const tintedPanel = resolveChromePanelBoxProps({
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    marginBottom: 0,
    paddingY: 1,
  })
  const fixedWidthPanel = resolveChromePanelBoxProps({
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    width: 78,
  })

  assert.equal('borderColor' in plainPanel, false)
  assert.equal('borderStyle' in plainPanel, false)
  assert.equal(resolveAssistantChatViewportWidth(80), 78)
  assert.equal(resolveAssistantChatViewportWidth(2), 1)
  assert.equal(resolveAssistantPlainTextWrapColumns(80), 77)
  assert.equal(resolveAssistantPlainTextWrapColumns(2), 1)
  assert.deepEqual(plainPanel, {
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 0,
    paddingY: 0,
    width: '100%',
  })
  assert.deepEqual(tintedPanel, {
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    flexDirection: 'column',
    marginBottom: 0,
    paddingX: 1,
    paddingY: 1,
    width: '100%',
  })
  assert.deepEqual(fixedWidthPanel, {
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 1,
    paddingY: 0,
    width: 78,
  })

  assert.equal(
    formatFooterBadgeText({
      key: 'model',
      label: 'model',
      value: 'gpt-5.4',
    }),
    ' gpt-5.4 ',
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'reasoning',
      label: 'reasoning',
      value: 'high',
    }),
    ' high ',
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'vault',
      label: 'vault',
      value: '~/vault',
    }),
    ' vault: ~/vault ',
  )
  assert.equal(DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS[0]?.value, 'gpt-5.4')
  assert.equal(DEFAULT_ASSISTANT_REASONING_OPTIONS[3]?.value, 'xhigh')
  assert.equal(CHAT_SLASH_COMMANDS[0]?.command, '/model')
  assert.equal(
    findAssistantModelOptionIndex(
      'gpt-5.3-codex',
      DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS,
    ),
    2,
  )
  assert.equal(
    findAssistantReasoningOptionIndex(
      'xhigh',
      DEFAULT_ASSISTANT_REASONING_OPTIONS,
    ),
    3,
  )
  assert.equal(
    findAssistantReasoningOptionIndex(null, DEFAULT_ASSISTANT_REASONING_OPTIONS),
    1,
  )
  assert.deepEqual(
    getMatchingSlashCommands('/m').map((command) => command.command),
    ['/model'],
  )
  assert.equal(getMatchingSlashCommands('hello').length, 0)
  assert.equal(formatElapsedClock(0), '0:00')
  assert.equal(formatElapsedClock(73), '1:13')
  assert.equal(formatBusyStatus(0), 'Working · 0:00')
  assert.equal(formatBusyStatus(13), 'Working · 0:13')
  assert.equal(
    formatChatMetadata(
      {
        provider: session.provider,
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    'gpt-5.4 xhigh · ~/vault',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        provider: session.provider,
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'gpt-5.4',
      },
      {
        key: 'reasoning',
        label: 'reasoning',
        value: 'xhigh',
      },
      {
        key: 'vault',
        label: 'vault',
        value: '~/vault',
      },
    ],
  )
  assert.equal(
    formatChatMetadata(
      {
        baseUrl: 'http://127.0.0.1:11434/v1',
        provider: 'openai-compatible',
        model: 'gpt-oss:20b',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    'gpt-oss:20b · ~/vault',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        baseUrl: 'http://127.0.0.1:11434/v1',
        provider: 'openai-compatible',
        model: 'gpt-oss:20b',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'gpt-oss:20b',
      },
      {
        key: 'vault',
        label: 'vault',
        value: '~/vault',
      },
    ],
  )
  assert.equal(
    formatChatMetadata(
      {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-compatible',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      '~/vault',
    ),
    'gpt-5.4 medium · ~/vault',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-compatible',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      '~/vault',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'gpt-5.4',
      },
      {
        key: 'reasoning',
        label: 'reasoning',
        value: 'medium',
      },
      {
        key: 'vault',
        label: 'vault',
        value: '~/vault',
      },
    ],
  )
  assert.equal(
    formatSessionBinding(session),
    'imessage · contact:bob · thread-123',
  )
})

test('assistant Ink raw-mode support helper only accepts TTY streams with setRawMode', () => {
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: true,
      setRawMode: () => {},
    } as unknown as NodeJS.ReadStream),
    true,
  )
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: true,
    } as unknown as NodeJS.ReadStream),
    false,
  )
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: false,
      setRawMode: () => {},
    } as unknown as NodeJS.ReadStream),
    false,
  )
})

test('assistant Ink input adapter reuses process stdin when raw mode is supported', () => {
  const stdin = {
    isTTY: true,
    setRawMode: () => {},
  } as unknown as NodeJS.ReadStream

  const adapter = resolveAssistantInkInputAdapter({
    stdin,
  })

  assert.equal(adapter.source, 'stdin')
  assert.equal(adapter.stdin, stdin)
})

test('assistant Ink input adapter falls back to the controlling terminal when needed', () => {
  const destroyTtyInput = vi.fn()
  const ttyInput = {
    destroy: destroyTtyInput,
    isTTY: true,
    setRawMode: () => {},
  } as unknown as NodeJS.ReadStream
  const openTtyFd = vi.fn(() => 42)
  const createTtyReadStream = vi.fn(() => ttyInput)

  const adapter = resolveAssistantInkInputAdapter({
    createTtyReadStream,
    openTtyFd,
    stdin: {
      isTTY: false,
    } as unknown as NodeJS.ReadStream,
    ttyPath: '/dev/test-tty',
  })

  assert.equal(adapter.source, 'tty')
  assert.equal(adapter.stdin, ttyInput)
  assert.deepEqual(openTtyFd.mock.calls, [['/dev/test-tty', 'r']])
  assert.deepEqual(createTtyReadStream.mock.calls, [[42]])
  adapter.close()
  assert.equal(destroyTtyInput.mock.calls.length, 1)
})

test('assistant Ink view-model resolves composer submit actions and clear behavior', () => {
  assert.deepEqual(resolveChatSubmitAction('   ', false), {
    kind: 'ignore',
  })
  assert.deepEqual(resolveChatSubmitAction('hello', true), {
    kind: 'ignore',
  })
  assert.deepEqual(
    resolveChatSubmitAction('hello', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'queue',
      prompt: 'hello',
    },
  )
  assert.deepEqual(
    resolveChatSubmitAction('/model', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'ignore',
    },
  )
  assert.deepEqual(resolveChatSubmitAction('/quit', false), {
    kind: 'exit',
  })
  assert.deepEqual(resolveChatSubmitAction('/session', false), {
    kind: 'session',
  })

  const modelAction = resolveChatSubmitAction('/model', false)
  const promptAction = resolveChatSubmitAction('  hello Bob  ', false)
  const queueAction = resolveChatSubmitAction('  hello Bob  ', {
    busy: true,
    trigger: 'tab',
  })

  assert.deepEqual(modelAction, {
    kind: 'model',
  })
  assert.equal(shouldClearComposerForSubmitAction(modelAction), true)
  assert.deepEqual(promptAction, {
    kind: 'prompt',
    prompt: 'hello Bob',
  })
  assert.equal(shouldClearComposerForSubmitAction(promptAction), true)
  assert.deepEqual(queueAction, {
    kind: 'queue',
    prompt: 'hello Bob',
  })
  assert.equal(shouldClearComposerForSubmitAction(queueAction), true)
  assert.equal(
    shouldClearComposerForSubmitAction(resolveChatSubmitAction('/session', false)),
    false,
  )
})

test('assistant Ink merges queued follow-ups back into the composer draft with blank lines', () => {
  assert.equal(mergeComposerDraftWithQueuedPrompts('', []), '')
  assert.equal(
    mergeComposerDraftWithQueuedPrompts('', ['first follow-up', 'second follow-up']),
    'first follow-up\n\nsecond follow-up',
  )
  assert.equal(
    mergeComposerDraftWithQueuedPrompts('existing draft', ['queued follow-up']),
    'existing draft\n\nqueued follow-up',
  )
})

test('assistant Ink prompt queue reducer preserves enqueue, pop-last, dequeue, and clear semantics', () => {
  const queued = reduceAssistantPromptQueueState(
    {
      prompts: [],
    },
    {
      kind: 'enqueue',
      prompt: 'first follow-up',
    },
  )

  const queuedAgain = reduceAssistantPromptQueueState(queued, {
    kind: 'enqueue',
    prompt: 'second follow-up',
  })

  assert.deepEqual(queuedAgain, {
    prompts: ['first follow-up', 'second follow-up'],
  })
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'pop-last',
    }),
    {
      prompts: ['first follow-up'],
    },
  )
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'dequeue',
    }),
    {
      prompts: ['second follow-up'],
    },
  )
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'clear',
    }),
    {
      prompts: [],
    },
  )
})

test('assistant Ink turn reducer keeps pause requests scoped to the active turn', () => {
  const running = reduceAssistantTurnState(
    {
      pauseRequested: false,
      phase: 'idle',
    },
    {
      kind: 'start',
    },
  )

  assert.deepEqual(running, {
    pauseRequested: false,
    phase: 'running',
  })
  assert.deepEqual(
    reduceAssistantTurnState(running, {
      kind: 'request-pause',
    }),
    {
      pauseRequested: true,
      phase: 'running',
    },
  )
  assert.deepEqual(
    reduceAssistantTurnState(running, {
      kind: 'finish',
    }),
    {
      pauseRequested: false,
      phase: 'idle',
    },
  )
})

test('assistant Ink queued prompt disposition replays completed follow-ups and restores interrupted or failed queues', () => {
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['queued next', 'queued later'],
      turnOutcome: 'completed',
    }),
    {
      kind: 'replay-next',
      nextQueuedPrompt: 'queued next',
      remainingQueuedPrompts: ['queued later'],
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['queued next'],
      turnOutcome: 'interrupted',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['queued next'],
      turnOutcome: 'failed',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: true,
      queuedPrompts: ['queued next'],
      turnOutcome: 'completed',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )
})

test('assistant Ink view-model falls back to default model labels when needed', () => {
  const ossSession = {
    schema: 'murph.assistant-session.v3',
    sessionId: 'asst_demo',
    provider: 'codex-cli',
    providerSessionId: null,
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: null,
      oss: true,
    },
    alias: null,
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  } as const

  const defaultSession = {
    ...ossSession,
    providerOptions: {
      ...ossSession.providerOptions,
      oss: false,
    },
  } as const

  assert.equal(
    formatChatMetadata(
      {
        provider: ossSession.provider,
        model: null,
        reasoningEffort: 'high',
      },
      '~/vault',
    ),
    'codex-cli high · ~/vault',
  )
  assert.equal(
    formatChatMetadata(
      {
        provider: defaultSession.provider,
        model: null,
        reasoningEffort: null,
      },
      '~/vault',
    ),
    'codex-cli · ~/vault',
  )
  assert.equal(formatSessionBinding(defaultSession), null)
})

test('assistant Ink composer editing supports line kills and yank', () => {
  const afterKillEnd = applyComposerEditingInput(
    {
      cursorOffset: 5,
      killBuffer: '',
      value: 'hello there',
    },
    'k',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterKillEnd, {
    cursorOffset: 5,
    handled: true,
    killBuffer: ' there',
    value: 'hello',
  })

  const afterYank = applyComposerEditingInput(
    afterKillEnd,
    'y',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterYank, {
    cursorOffset: 11,
    handled: true,
    killBuffer: ' there',
    value: 'hello there',
  })

  const afterKillStart = applyComposerEditingInput(
    {
      cursorOffset: 5,
      killBuffer: '',
      value: 'hello there',
    },
    'u',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterKillStart, {
    cursorOffset: 0,
    handled: true,
    killBuffer: 'hello',
    value: ' there',
  })
})

test('assistant Ink composer editing supports word movement and word deletion', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 16,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        leftArrow: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 11,
      handled: true,
      killBuffer: '',
      value: 'alpha beta gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        rightArrow: true,
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'alpha beta gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 10,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        backspace: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha  gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 6,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      'd',
      createComposerKey({
        meta: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha  gamma',
    },
  )
})

test('assistant Ink composer editing supports forward delete and best-effort super shortcuts', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        delete: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'alphabeta',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        rightArrow: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 10,
      handled: true,
      killBuffer: '',
      value: 'alpha beta',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 10,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        backspace: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: 'alpha beta',
      value: '',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 6,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        delete: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha ',
    },
  )
})

test('assistant Ink composer editing normalizes pasted carriage returns to newlines', () => {
  assert.equal(
    normalizeComposerInsertedText('alpha\r\nbeta\rgamma'),
    'alpha\nbeta\ngamma',
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: '',
      },
      'alpha\r\nbeta\rgamma',
      createComposerKey(),
    ),
    {
      cursorOffset: 16,
      handled: true,
      killBuffer: '',
      value: 'alpha\nbeta\ngamma',
    },
  )
})

test('assistant Ink composer controlled sync keeps the latest local draft visible while older controlled paste chunks catch up', () => {
  assert.deepEqual(
    reconcileComposerControlledValue({
      cursorOffset: 15,
      currentValue: 'hello brave new world',
      nextControlledValue: 'hello brave world',
      pendingValues: ['hello brave world', 'hello brave new world'],
      previousControlledValue: 'hello world',
    }),
    {
      cursorOffset: 15,
      nextValue: 'hello brave new world',
      pendingValues: ['hello brave new world'],
    },
  )
})

test('assistant Ink composer controlled sync treats unrelated controlled updates as external draft restores and moves the cursor to the end', () => {
  assert.deepEqual(
    reconcileComposerControlledValue({
      cursorOffset: 0,
      currentValue: '',
      nextControlledValue: 'queued follow-up',
      pendingValues: [],
      previousControlledValue: '',
    }),
    {
      cursorOffset: 16,
      nextValue: 'queued follow-up',
      pendingValues: [],
    },
  )
})

test('assistant Ink composer controlled sync clears pending local values once the parent catches up fully', () => {
  assert.deepEqual(
    reconcileComposerControlledValue({
      cursorOffset: 21,
      currentValue: 'hello brave new world',
      nextControlledValue: 'hello brave new world',
      pendingValues: ['hello brave world', 'hello brave new world'],
      previousControlledValue: 'hello brave world',
    }),
    {
      cursorOffset: 21,
      nextValue: 'hello brave new world',
      pendingValues: [],
    },
  )
})

test('assistant Ink composer render highlights the active character instead of inserting a spacer', () => {
  const rendered = renderComposerValue({
    cursorOffset: 2,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: 'alpha',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerTextColor)
  assert.deepEqual(children.length, 3)
  assert.equal(children[0], 'al')
  assert.equal(children[2], 'ha')
  assert.equal(React.isValidElement(children[1]), true)

  if (!React.isValidElement(children[1])) {
    throw new Error('Expected the cursor segment to render as a React element.')
  }

  const cursorProps = children[1].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, 'p')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

test('assistant Ink transcript partition keeps completed turns static while the current busy turn stays live', () => {
  const entries = [
    {
      kind: 'user' as const,
      text: 'previous turn',
    },
    {
      kind: 'assistant' as const,
      text: 'previous reply',
    },
    {
      kind: 'user' as const,
      text: 'current turn',
    },
    {
      kind: 'thinking' as const,
      text: 'working on it',
      streamKey: 'thinking:1',
    },
  ]

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: false,
      entries,
    }),
    {
      liveEntries: [],
      staticEntries: entries,
    },
  )
  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries,
    }),
    {
      liveEntries: entries.slice(3),
      staticEntries: entries.slice(0, 3),
    },
  )
})

test('assistant Ink transcript partition keeps all rows live when no user turn has been committed yet', () => {
  const entries = [
    {
      kind: 'thinking' as const,
      text: 'warming up',
      streamKey: 'thinking:1',
    },
    {
      kind: 'assistant' as const,
      text: 'partial reply',
      streamKey: 'assistant:1',
    },
  ]

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries,
    }),
    {
      liveEntries: entries,
      staticEntries: [],
    },
  )
})

test('assistant Ink busy status hides once the current turn already has a visible assistant row', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'assistant',
          text: 'partial reply',
          streamKey: 'assistant:1',
        },
      ],
    }),
    false,
  )
})

test('assistant Ink busy status hides once the current turn already has a visible error row', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'error',
          text: 'provider blew up',
        },
      ],
    }),
    false,
  )
})

test('assistant Ink busy status stays visible while the current turn has no visible reply yet', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'thinking',
          text: 'working on it',
          streamKey: 'thinking:1',
        },
      ],
    }),
    true,
  )
})

test('assistant Ink transcript feed renders the header and committed rows via Ink Static output', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: 'imessage · assistant:primary · chat-123',
    busy: true,
    entries: [
      {
        kind: 'user',
        text: 'previous turn',
      },
      {
        kind: 'assistant',
        text: 'previous reply',
      },
      {
        kind: 'user',
        text: 'current turn',
      },
      {
        kind: 'assistant',
        text: 'streaming now',
        streamKey: 'assistant:live',
      },
    ],
    sessionId: 'asst_test_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(rendered.type, React.Fragment)
  assert.equal(fragmentChildren.length, 2)
  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  assert.equal(React.isValidElement(fragmentChildren[1]), true)

  if (
    !React.isValidElement(fragmentChildren[0]) ||
    !React.isValidElement(fragmentChildren[1])
  ) {
    throw new Error('Expected transcript feed children to be valid React elements.')
  }

  assert.equal(fragmentChildren[0].type, Static)
  assert.equal(fragmentChildren[1].type, Box)

  const staticProps = fragmentChildren[0].props as {
    items?: unknown[]
  }
  const liveProps = fragmentChildren[1].props as {
    children?: React.ReactNode
    flexDirection?: string
    width?: string
  }
  const liveChildren = React.Children.toArray(liveProps.children)

  assert.equal(staticProps.items?.length, 4)
  assert.equal(liveProps.flexDirection, 'column')
  assert.equal(liveProps.width, '100%')
  assert.equal(liveChildren.length, 1)
})

test('assistant Ink transcript feed header omits the session id label', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: 'imessage · assistant:primary · chat-123',
    busy: false,
    entries: [],
    sessionId: 'asst_test_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  if (!React.isValidElement(fragmentChildren[0])) {
    throw new Error('Expected transcript feed static output to be a valid React element.')
  }

  const staticProps = fragmentChildren[0].props as {
    children?: ((item: unknown, index: number) => React.ReactElement) | React.ReactNode
    items?: unknown[]
  }
  const renderStaticRow = staticProps.children

  assert.equal(typeof renderStaticRow, 'function')
  assert.equal(staticProps.items?.length, 1)
  if (typeof renderStaticRow !== 'function') {
    throw new Error('Expected transcript feed static output to expose a row renderer.')
  }

  const header = renderStaticRow(staticProps.items?.[0], 0)
  assert.equal(React.isValidElement(header), true)
  if (!React.isValidElement(header)) {
    throw new Error('Expected transcript feed header to be a valid React element.')
  }

  assert.deepEqual(Object.keys(header.props as Record<string, unknown>), ['bindingSummary'])
  assert.equal((header.props as { bindingSummary?: string | null }).bindingSummary, 'imessage · assistant:primary · chat-123')
  assert.doesNotMatch(JSON.stringify(header.props), /asst_test_session/u)
})

test('assistant Ink transcript feed keeps the empty chat state free of an intro banner', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: null,
    busy: false,
    entries: [],
    sessionId: 'asst_empty_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(fragmentChildren.length, 2)
  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  assert.equal(React.isValidElement(fragmentChildren[1]), true)

  if (
    !React.isValidElement(fragmentChildren[0]) ||
    !React.isValidElement(fragmentChildren[1])
  ) {
    throw new Error('Expected transcript feed children to be valid React elements.')
  }

  const staticProps = fragmentChildren[0].props as {
    items?: unknown[]
  }
  const liveProps = fragmentChildren[1].props as {
    children?: React.ReactNode
  }
  const liveChildren = React.Children.toArray(liveProps.children)

  assert.equal(fragmentChildren[0].type, Static)
  assert.equal(fragmentChildren[1].type, Box)
  assert.equal(staticProps.items?.length, 1)
  assert.equal(liveChildren.length, 0)
})

test('assistant Ink link helpers split markdown links and map absolute file paths to file URLs', () => {
  const fileTarget = '/tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10'

  assert.deepEqual(
    splitAssistantMarkdownLinks(
      `See [workout.ts](${fileTarget}) and [docs](https://example.com/reference).`,
    ),
    [
      {
        kind: 'text',
        text: 'See ',
      },
      {
        kind: 'link',
        label: 'workout.ts',
        target: fileTarget,
      },
      {
        kind: 'text',
        text: ' and ',
      },
      {
        kind: 'link',
        label: 'docs',
        target: 'https://example.com/reference',
      },
      {
        kind: 'text',
        text: '.',
      },
    ],
  )

  assert.equal(
    resolveAssistantHyperlinkTarget(fileTarget),
    'file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10',
  )
  assert.equal(
    resolveAssistantHyperlinkTarget('https://example.com/reference'),
    'https://example.com/reference',
  )
  assert.equal(resolveAssistantHyperlinkTarget('packages/cli/src/usecases/workout.ts'), null)
  assert.equal(
    formatAssistantTerminalHyperlink(
      'workout.ts',
      'file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10',
    ),
    '\u001B]8;;file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10\u0007workout.ts\u001B]8;;\u0007',
  )
})

test('assistant Ink wrapped text block keeps assistant replies in a single full-width wrapped block', () => {
  const text =
    'All good. What do you want to sort out: a health question, something in the vault, or a reminder/routine?'
  const rendered = renderWrappedTextBlock({ children: text })

  assert.equal(rendered.type, Box)

  const wrapperProps = rendered.props as {
    children?: React.ReactNode
    flexDirection?: string
    width?: string
  }
  const children = React.Children.toArray(wrapperProps.children)

  assert.equal(wrapperProps.flexDirection, 'column')
  assert.equal(wrapperProps.width, '100%')
  assert.equal(children.length, 1)
  assert.equal(React.isValidElement(children[0]), true)

  if (!React.isValidElement(children[0])) {
    throw new Error('Expected the wrapped assistant message child to render as a React element.')
  }

  const textProps = children[0].props as {
    children?: React.ReactNode
    wrap?: string
  }

  assert.equal(textProps.wrap, 'wrap')
  assert.equal(textProps.children, text)
})

test('assistant Ink wrapped plain-text block renders one styled Text node per wrapped line', () => {
  const rendered = renderWrappedPlainTextBlock({
    color: LIGHT_ASSISTANT_INK_THEME.mutedColor,
    columns: 18,
    text: '  ↳ name should be optional and only asked once',
  })

  assert.equal(rendered.type, Box)

  const wrapperProps = rendered.props as {
    children?: React.ReactNode
    flexDirection?: string
    width?: string
  }
  const children = React.Children.toArray(wrapperProps.children)

  assert.equal(wrapperProps.flexDirection, 'column')
  assert.equal(wrapperProps.width, '100%')
  assert.ok(children.length > 1)

  for (const child of children) {
    assert.equal(React.isValidElement(child), true)
    if (!React.isValidElement(child)) {
      throw new Error('Expected wrapped plain-text lines to render as Text elements.')
    }

    const textProps = child.props as {
      children?: React.ReactNode
      color?: string
    }

    assert.equal(textProps.color, LIGHT_ASSISTANT_INK_THEME.mutedColor)
  }
})

test('assistant Ink plain-text wrapping keeps words intact on narrow widths', () => {
  assert.equal(
    wrapAssistantPlainText('pull context from the vault if you want', 10),
    'pull\ncontext\nfrom the\nvault if\nyou want',
  )
})

test('assistant Ink hyperlink support only enables terminal links on supported tty environments', () => {
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: true,
    }),
    true,
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: false,
    }),
    false,
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        CI: 'true',
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: true,
    }),
    false,
  )
})

test('assistant Ink composer render highlights the first placeholder character when empty', () => {
  const rendered = renderComposerValue({
    cursorOffset: 0,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: '',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerPlaceholderColor)
  assert.deepEqual(children.length, 2)
  assert.equal(children[1], 'ype a message')
  assert.equal(React.isValidElement(children[0]), true)

  if (!React.isValidElement(children[0])) {
    throw new Error('Expected the placeholder cursor segment to render as a React element.')
  }

  const cursorProps = children[0].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, 'T')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

test('assistant Ink composer vertical cursor movement preserves preferred columns across uneven lines', () => {
  const firstMove = resolveComposerVerticalCursorMove({
    cursorOffset: 5,
    direction: 'down',
    preferredColumn: null,
    value: 'alpha\nbe\ncharlie',
  })

  assert.deepEqual(firstMove, {
    cursorOffset: 8,
    preferredColumn: 5,
  })

  const secondMove = resolveComposerVerticalCursorMove({
    cursorOffset: firstMove.cursorOffset,
    direction: 'down',
    preferredColumn: firstMove.preferredColumn,
    value: 'alpha\nbe\ncharlie',
  })

  assert.deepEqual(secondMove, {
    cursorOffset: 14,
    preferredColumn: 5,
  })

  assert.deepEqual(
    resolveComposerVerticalCursorMove({
      cursorOffset: secondMove.cursorOffset,
      direction: 'up',
      preferredColumn: secondMove.preferredColumn,
      value: 'alpha\nbe\ncharlie',
    }),
    {
      cursorOffset: 8,
      preferredColumn: 5,
    },
  )
})

test('assistant Ink composer terminal actions treat tab as a queue submit', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      tab: true,
    }),
  )

  assert.deepEqual(action, {
    kind: 'submit',
    mode: 'tab',
  })
})

test('assistant Ink normalizes raw arrow escape sequences into arrow key flags', () => {
  assert.deepEqual(
    normalizeAssistantInkArrowKey('\u001b[A', createComposerKey()),
    createComposerKey({
      upArrow: true,
    }),
  )

  assert.deepEqual(
    normalizeAssistantInkArrowKey('\u001bOB', createComposerKey()),
    createComposerKey({
      downArrow: true,
    }),
  )

  assert.deepEqual(
    normalizeAssistantInkArrowKey('\u001b[1;3A', createComposerKey()),
    createComposerKey({
      meta: true,
      upArrow: true,
    }),
  )
})

test('assistant Ink composer terminal actions treat raw arrow escape sequences as arrow navigation', () => {
  const action = resolveComposerTerminalAction('\u001b[A', createComposerKey())

  assert.equal(action.kind, 'edit')
  assert.equal(action.key.upArrow, true)
  assert.equal(action.key.downArrow, false)
})

test('assistant Ink composer terminal actions treat option+up as editing the last queued follow-up', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      meta: true,
      upArrow: true,
    }),
  )

  assert.deepEqual(action, {
    kind: 'edit-last-queued',
  })
})

test('assistant Ink composer terminal actions treat raw option+up escape sequences as editing the last queued follow-up', () => {
  const action = resolveComposerTerminalAction('\u001b[1;3A', createComposerKey())

  assert.deepEqual(action, {
    kind: 'edit-last-queued',
  })
})

test('assistant Ink composer terminal actions treat shift+enter as a newline edit', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      return: true,
      shift: true,
    }),
  )

  assert.equal(action.kind, 'edit')
  assert.equal(action.input, '\n')
  assert.equal(action.key.return, false)

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      action.input,
      action.key,
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: '',
      value: 'hello\n',
    },
  )
})

test('assistant Ink composer terminal actions treat raw DEL bytes as backspace edits', () => {
  const action = resolveComposerTerminalAction('\u007f', createComposerKey())

  assert.equal(action.kind, 'edit')
  assert.equal(action.input, '')
  assert.equal(action.key.backspace, true)
  assert.equal(action.key.delete, false)
})

test('assistant Ink composer terminal actions treat xterm-style shift+enter escape sequences as a newline edit', () => {
  for (const rawInput of ['[27;2;13~', '\u001b[27;2;13~']) {
    const action = resolveComposerTerminalAction(rawInput, createComposerKey())

    assert.equal(action.kind, 'edit')
    assert.equal(action.input, '\n')
    assert.equal(action.key.return, false)
    assert.equal(action.key.shift, true)
  }
})

test('assistant Ink composer terminal actions map terminal delete keypresses to backward delete', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      delete: true,
    }),
  )

  assert.equal(action.kind, 'edit')
  assert.equal(action.key.backspace, true)
  assert.equal(action.key.delete, false)

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      action.input,
      action.key,
    ),
    {
      cursorOffset: 4,
      handled: true,
      killBuffer: '',
      value: 'hell',
    },
  )
})

test('assistant Ink queued follow-up previews collapse whitespace and truncate long prompts', () => {
  assert.equal(
    formatQueuedFollowUpPreview('  name should be optional\nand only asked once  '),
    'name should be optional and only asked once',
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      'This is a deliberately long queued follow-up prompt that should collapse whitespace and trim down to a concise single-line preview for the Ink queue panel.',
    ),
    'This is a deliberately long queued follow-up prompt that should collapse whitespace…',
  )
})

test('assistant Ink composer render keeps newline-adjacent cursors in one wrapped text flow', () => {
  const rendered = renderComposerValue({
    cursorOffset: 5,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: 'alpha\nbeta gamma',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerTextColor)
  assert.deepEqual(children.length, 3)
  assert.equal(children[0], 'alpha')
  assert.equal(children[2], '\nbeta gamma')
  assert.equal(React.isValidElement(children[1]), true)

  if (!React.isValidElement(children[1])) {
    throw new Error('Expected the cursor segment to render as a React element.')
  }

  const cursorProps = children[1].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, ' ')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

async function listDirectoryEntries(directoryPath: string): Promise<string[]> {
  try {
    return (await readdir(directoryPath)).sort()
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return []
    }

    throw error
  }
}
