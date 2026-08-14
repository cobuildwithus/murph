import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  type AssistantCronPresetVariable,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockAutomationRecord = {
  automationId: string
  assistantTargetOverride?: {
    model?: string | null
    modelProvider?: string | null
    reasoningEffort?: string | null
  } | null
  continuityPolicy: 'preserve' | 'reset'
  createdAt: string
  instructions: string
  route: {
    channel: string
    deliveryTarget: string | null
    identityId: string | null
    participantId: string | null
    threadId: string | null
  }
  schedule: AssistantCronSchedule
  slug?: string
  status: 'active' | 'paused' | 'archived'
  summary?: string
  tags: string[]
  title: string
  updatedAt: string
}

const runtimeMocks = vi.hoisted(() => ({
  sendLinqChatMessage: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
}))

const cronMocks = vi.hoisted(() => ({
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  automationsByVault: new Map<string, MockAutomationRecord[]>(),
  getAssistantChannelAdapter: vi.fn(),
  listCanonicalAutomations: vi.fn(),
  loadImporterRuntime: vi.fn(),
  loadRuntimeModule: vi.fn(),
  loadVault: vi.fn(),
  nextAutomationId: 1,
  renderAutoLoggedFoodMealNote: vi.fn(),
  resolveAssistantBindingDelivery: vi.fn(),
  sendAssistantMessageLocal: vi.fn(),
  showCanonicalAutomation: vi.fn(),
  upsertAutomation: vi.fn(),
}))

vi.mock('@murphai/operator-config/linq-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/linq-runtime')>()
  return {
    ...actual,
    sendLinqChatMessage: runtimeMocks.sendLinqChatMessage,
    startLinqChatTypingIndicator: runtimeMocks.startLinqChatTypingIndicator,
    stopLinqChatTypingIndicator: runtimeMocks.stopLinqChatTypingIndicator,
  }
})

vi.mock('@murphai/core', () => ({
  loadVault: cronMocks.loadVault,
  upsertAutomation: cronMocks.upsertAutomation,
}))

vi.mock('@murphai/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/query')>()
  return {
    ...actual,
    listAutomations: cronMocks.listCanonicalAutomations,
    showAutomation: cronMocks.showCanonicalAutomation,
  }
})

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadImporterRuntime: cronMocks.loadImporterRuntime,
  loadRuntimeModule: cronMocks.loadRuntimeModule,
}))

vi.mock('@murphai/vault-usecases/records', () => ({
  renderAutoLoggedFoodMealNote: cronMocks.renderAutoLoggedFoodMealNote,
}))

vi.mock('../src/assistant-service.ts', () => ({
  sendAssistantNotificationLocal: cronMocks.sendAssistantMessageLocal,
  sendAssistantMessageLocal: cronMocks.sendAssistantMessageLocal,
}))

vi.mock('../src/assistant/channel-adapters.ts', () => ({
  getAssistantChannelAdapter: cronMocks.getAssistantChannelAdapter,
}))

vi.mock('../src/assistant/bindings.ts', async (importOriginal) => ({
  // The conversation-key predicate is pure routing logic; keep the real one
  // so continuity gating behaves as in production.
  resolveAssistantConversationKey: (
    await importOriginal<typeof import('../src/assistant/bindings.ts')>()
  ).resolveAssistantConversationKey,
  resolveAssistantBindingDelivery: cronMocks.resolveAssistantBindingDelivery,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyAssistantSelfDeliveryTargetDefaults:
    cronMocks.applyAssistantSelfDeliveryTargetDefaults,
}))

import { ASSISTANT_CHANNEL_ADAPTERS } from '../src/assistant/channels/descriptors.ts'
import { createAssistantBindingDelivery } from '../src/assistant/channels/helpers.ts'
import {
  sendLinqMessage,
  sendTelegramMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from '../src/assistant/channels/runtime.ts'
import { withAssistantCronWriteLock } from '../src/assistant/cron/locking.ts'
import {
  renderAssistantCronPreset,
} from '../src/assistant/cron/presets.ts'
import {
  computeAssistantCronNextRunAt,
  findNextAssistantCronOccurrence,
  parseAssistantCronEveryDuration,
  validateAssistantCronExpression,
} from '../src/assistant/cron/schedule.ts'
import {
  readAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import {
  appendAssistantCronRun,
} from '../src/assistant/cron/store.ts'
import {
  addAssistantCronJob,
  getAssistantCronJobTarget,
  getAssistantCronPreset,
  installAssistantCronPreset,
  listAssistantCronJobs,
  listAssistantCronPresets,
  listAssistantCronRuns,
  removeAssistantCronJob,
} from '../src/assistant-cron.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []
const tempModulePaths: string[] = []

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()

  runtimeMocks.sendLinqChatMessage.mockReset()
  runtimeMocks.startLinqChatTypingIndicator.mockReset()
  runtimeMocks.stopLinqChatTypingIndicator.mockReset()

  cronMocks.automationsByVault.clear()
  cronMocks.nextAutomationId = 1
  cronMocks.applyAssistantSelfDeliveryTargetDefaults
    .mockReset()
    .mockImplementation(
      async (input: Record<string, string | null | undefined>) => ({
        channel: input.channel ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
        identityId: input.identityId ?? null,
        participantId: input.participantId ?? null,
        threadId: input.threadId ?? null,
      }),
    )
  cronMocks.getAssistantChannelAdapter
    .mockReset()
    .mockImplementation((channel) => (channel ? { channel } : null))
  cronMocks.resolveAssistantBindingDelivery
    .mockReset()
    .mockImplementation(
      ({
        actorId,
        channel,
        deliveryTarget,
        threadId,
      }: {
        actorId?: string | null
        channel?: string | null
        deliveryTarget?: string | null
        threadId?: string | null
      }) => {
        if (!channel) {
          return null
        }

        if (deliveryTarget) {
          return {
            channel,
            deliveryTarget,
            kind: 'direct',
          }
        }

        if (actorId || threadId) {
          return {
            actorId: actorId ?? null,
            channel,
            kind: 'binding',
            threadId: threadId ?? null,
          }
        }

        return null
      },
    )
  cronMocks.loadVault.mockReset().mockResolvedValue({
    metadata: {
      timezone: 'UTC',
    },
  })
  cronMocks.sendAssistantMessageLocal.mockReset().mockResolvedValue({
    response: 'Completed scheduled check-in.',
    session: {
      sessionId: 'session-default',
    },
  })
  cronMocks.loadRuntimeModule.mockReset().mockResolvedValue({
    readFood: vi.fn(async ({ foodId }: { foodId?: string }) => ({
      foodId: foodId ?? 'food-1',
      title: 'Daily Oats',
    })),
  })
  cronMocks.renderAutoLoggedFoodMealNote
    .mockReset()
    .mockImplementation((food: { title: string }) => `Meal note for ${food.title}`)
  cronMocks.loadImporterRuntime.mockReset().mockResolvedValue({
    addMeal: vi.fn(async () => ({
      mealId: 'meal-1',
    })),
  })
  cronMocks.listCanonicalAutomations.mockReset().mockImplementation(
    async (
      vault: string,
      options?: {
        status?: ReadonlyArray<'active' | 'paused' | 'archived'>
      },
    ) => {
      const records = getVaultAutomationStore(vault)
      const allowed = options?.status
      return records.filter((record) =>
        allowed ? allowed.includes(record.status) : true,
      )
    },
  )
  cronMocks.showCanonicalAutomation
    .mockReset()
    .mockImplementation(async (vault: string, lookup: string) => {
      const normalized = lookup.trim()
      return (
        getVaultAutomationStore(vault).find(
          (record) =>
            record.automationId === normalized || record.title === normalized,
        ) ?? null
      )
    })
  cronMocks.upsertAutomation.mockReset().mockImplementation(
    async (input: {
      automationId?: string
      assistantTargetOverride?: MockAutomationRecord['assistantTargetOverride']
      continuityPolicy?: 'preserve' | 'reset'
      instructions: string
      route: MockAutomationRecord['route']
      schedule: AssistantCronSchedule
      slug?: string
      status: MockAutomationRecord['status']
      summary?: string
      tags?: string[]
      title: string
      vaultRoot: string
    }) => {
      const records = getVaultAutomationStore(input.vaultRoot)
      const now = new Date().toISOString()
      const existingIndex = input.automationId
        ? records.findIndex((record) => record.automationId === input.automationId)
        : -1

      if (existingIndex >= 0) {
        const existing = records[existingIndex] as MockAutomationRecord
        const updated: MockAutomationRecord = {
          ...existing,
          assistantTargetOverride:
            input.assistantTargetOverride === undefined
              ? existing.assistantTargetOverride ?? null
              : input.assistantTargetOverride,
          continuityPolicy: input.continuityPolicy ?? existing.continuityPolicy,
          instructions: input.instructions,
          route: { ...input.route },
          schedule: input.schedule,
          slug: input.slug,
          status: input.status,
          summary: input.summary,
          tags: input.tags ?? existing.tags,
          title: input.title,
          updatedAt: now,
        }
        records.splice(existingIndex, 1, updated)
        return {
          record: updated,
        }
      }

      const created: MockAutomationRecord = {
        automationId: `automation-${cronMocks.nextAutomationId++}`,
        assistantTargetOverride: input.assistantTargetOverride ?? null,
        continuityPolicy: input.continuityPolicy ?? 'preserve',
        createdAt: now,
        instructions: input.instructions,
        route: { ...input.route },
        schedule: input.schedule,
        slug: input.slug,
        status: input.status,
        summary: input.summary,
        tags: input.tags ?? ['assistant', 'scheduled'],
        title: input.title,
        updatedAt: now,
      }
      records.push(created)
      return {
        record: created,
      }
    },
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await Promise.all(
    tempModulePaths.splice(0).map((filePath) =>
      unlink(filePath).catch(() => undefined),
    ),
  )
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant channel descriptors and runtime edges', () => {
  it('covers direct descriptor adapter send and typing branches', async () => {
    const telegramTyping = vi.fn().mockResolvedValue(undefined)
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.startTypingIndicator?.(
        {
          bindingDelivery: createAssistantBindingDelivery('thread', 'room-1'),
          explicitTarget: null,
          identityId: null,
        },
        {
          startTelegramTyping: telegramTyping,
        },
      ),
    ).resolves.toBeNull()
    expect(telegramTyping).toHaveBeenCalledWith({
      target: 'room-1',
    })

    const sendTelegram = vi.fn().mockResolvedValue({
      providerMessageId: '  tg-1  ',
    })
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-1'),
          explicitTarget: null,
          identityId: null,
          message: 'telegram hello',
          replyToMessageId: ' 55 ',
        },
        {
          sendTelegram,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'tg-1',
      target: 'thread-1',
      targetKind: 'thread',
    })

    const linqTyping = vi.fn().mockResolvedValue(undefined)
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.startTypingIndicator?.(
        {
          bindingDelivery: createAssistantBindingDelivery('thread', 'linq-room'),
          explicitTarget: null,
          identityId: null,
        },
        {
          startLinqTyping: linqTyping,
        },
      ),
    ).resolves.toBeNull()

    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: '  linq-1  ',
    })
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: null,
          explicitTarget: ' linq-chat ',
          identityId: null,
          message: 'linq hello',
        },
        {
          sendLinq,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'linq-1',
      target: 'linq-chat',
      targetKind: 'explicit',
    })

    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({
        providerMessageId: '  email-1  ',
        providerThreadId: ' thread-1 ',
      })
      .mockResolvedValueOnce({
        providerMessageId: '  email-2  ',
        providerThreadId: ' thread-2 ',
        target: ' delivered@example.com ',
      })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-target'),
          explicitTarget: null,
          identityId: null,
          message: 'email hello',
        },
        {
          sendEmail,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'email-1',
      providerThreadId: 'thread-1',
      target: 'thread-target',
      targetKind: 'thread',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          actorId: null,
          bindingDelivery: null,
          explicitTarget: 'person@example.com',
          identityId: ' identity-1 ',
          message: 'email hello',
        },
        {
          sendEmail,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'email-2',
      providerThreadId: 'thread-2',
      target: 'delivered@example.com',
      targetKind: 'explicit',
    })
  })

  it('covers runtime fallbacks and error shaping for telegram and linq', async () => {
    await expect(
      sendLinqMessage(
        {
          message: 'hello',
          target: 'linq-chat',
        },
        {
          env: {},
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
    })

    await expect(
      startLinqTypingIndicator(
        {
          target: '   ',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CHANNEL_TARGET_REQUIRED',
    })

    const malformedTargetFetch = createQueuedFetch([])
    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: 'bad-target',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: malformedTargetFetch,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
    })
    expect(malformedTargetFetch).toHaveBeenCalledTimes(1)

    await expect(
      startTelegramTypingIndicator(
        {
          target: '123',
        },
        {
          env: {},
          fetchImplementation: createQueuedFetch([]),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
    })

    const fallbackTelegramFetch = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {},
      }),
      createTelegramResponse(400, {
        description: 'forbidden',
        error_code: 403,
        ok: false,
      }),
    ])

    vi.useFakeTimers()
    const typingHandle = await startTelegramTypingIndicator(
      {
        target: '123',
      },
      {
        env: {
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation: fallbackTelegramFetch,
      },
    )
    const stopPromise = typingHandle.stop()
    await vi.advanceTimersByTimeAsync(4000)
    await expect(stopPromise).resolves.toBeUndefined()
    vi.useRealTimers()

    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          replyToMessageId: 'not-a-number',
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: fallbackTelegramFetch,
        },
      ),
    ).resolves.toEqual({
      providerMessageId: null,
      target: '123',
    })
    expect(readJsonBody(fallbackTelegramFetch.mock.calls[1]?.[1]?.body)).not.toHaveProperty(
      'reply_to_message_id',
    )

    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: fallbackTelegramFetch,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
      message: 'forbidden',
    })
  })
})

describe('assistant cron helpers and wrappers', () => {
  it('covers preset variable guards and internal validation branches', async () => {
    expect(
      listAssistantCronPresets().some((preset) => preset.id === 'morning-mindfulness'),
    ).toBe(true)
    expect(getAssistantCronPreset('morning-mindfulness')).toMatchObject({
      id: 'morning-mindfulness',
      title: 'Morning mindfulness',
    })

    expect(() =>
      renderAssistantCronPreset({
        presetId: 'weekly-health-snapshot',
        variables: {
          badOne: 'x',
          badTwo: 'y',
        },
      }),
    ).toThrowError(/does not define variables "badOne", "badTwo"/u)

    const tempModulePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      `.__assistant-cron-preset-hooks-${process.pid}-${Date.now()}.ts`,
    )
    const originalSource = await readFile(
      new URL('../src/assistant/cron/presets.ts', import.meta.url),
      'utf8',
    )
    const transformedSource = originalSource
      .replace(
        "from '../shared.js'",
        "from '../src/assistant/shared.ts'",
      )
      .concat(
        '\nexport const __testHooks = { validateAssistantCronPresetDefinitions, resolveAssistantCronPresetVariables }\n',
      )
    await writeFile(tempModulePath, transformedSource, 'utf8')
    tempModulePaths.push(tempModulePath)

    const loaded = await import(
      `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
    ) as typeof import('../src/assistant/cron/presets.ts') & {
      __testHooks: {
        resolveAssistantCronPresetVariables: (
          variables: readonly AssistantCronPresetVariable[],
          input: Record<string, string | null | undefined> | null,
          presetId: string,
        ) => Record<string, string>
        validateAssistantCronPresetDefinitions: (presets: readonly unknown[]) => void
      }
    }

    const optionalOnly = loaded.__testHooks.resolveAssistantCronPresetVariables(
      [
        {
          defaultValue: null,
          description: 'Optional value',
          example: null,
          key: 'optional_value',
          label: 'Optional value',
          required: false,
        },
      ],
      {
        optional_value: '   ',
      },
      'custom-preset',
    )
    expect(optionalOnly).toEqual({
      optional_value: '',
    })

    expect(() =>
      loaded.__testHooks.resolveAssistantCronPresetVariables(
        [
          {
            defaultValue: null,
            description: 'Required value',
            example: null,
            key: 'required_value',
            label: 'Required value',
            required: true,
          },
        ],
        {
          required_value: '   ',
        },
        'custom-preset',
      ),
    ).toThrowError(/requires --var required_value=/u)

    expect(() =>
      loaded.__testHooks.validateAssistantCronPresetDefinitions([
        {
          category: 'tests',
          description: 'first',
          id: 'duplicate-id',
          promptTemplate: 'Prompt {{value}}',
          suggestedName: 'first',
          suggestedSchedule: {
            expression: '0 7 * * *',
            kind: 'cron',
          },
          suggestedScheduleLabel: 'Daily',
          title: 'First',
          variables: [
            {
              defaultValue: 'value',
              description: 'value',
              example: 'value',
              key: 'value',
              label: 'Value',
              required: true,
            },
          ],
        },
        {
          category: 'tests',
          description: 'second',
          id: 'duplicate-id',
          promptTemplate: 'Prompt {{missing}}',
          suggestedName: 'second',
          suggestedSchedule: {
            expression: '0 8 * * *',
            kind: 'cron',
          },
          suggestedScheduleLabel: 'Daily',
          title: 'Second',
          variables: [
            {
              defaultValue: 'value',
              description: 'value',
              example: 'value',
              key: 'value',
              label: 'Value',
              required: true,
            },
          ],
        },
      ]),
    ).toThrowError(/Duplicate assistant cron preset id/u)

    expect(() =>
      loaded.__testHooks.validateAssistantCronPresetDefinitions([
        {
          category: 'tests',
          description: 'unknown placeholder',
          id: 'placeholder-mismatch',
          promptTemplate: 'Prompt {{missing}}',
          suggestedName: 'placeholder-mismatch',
          suggestedSchedule: {
            expression: '0 7 * * *',
            kind: 'cron',
          },
          suggestedScheduleLabel: 'Daily',
          title: 'Mismatch',
          variables: [
            {
              defaultValue: 'value',
              description: 'value',
              example: 'value',
              key: 'value',
              label: 'Value',
              required: true,
            },
          ],
        },
      ]),
    ).toThrowError(/references unknown variable "missing"/u)
  })

  it('covers schedule parsing and cron matching edge branches', () => {
    expect(() => parseAssistantCronEveryDuration('0ms')).toThrowError(
      /ASSISTANT_CRON_INVALID_SCHEDULE|sequence of number\+unit pairs/u,
    )

    expect(() => validateAssistantCronExpression('1,,2 * * * *')).toThrowError(
      /Invalid cron minute field/u,
    )
    expect(() => validateAssistantCronExpression('*/0 * * * *')).toThrowError(
      /Invalid cron minute field/u,
    )
    expect(() => validateAssistantCronExpression('5-1 * * * *')).toThrowError(
      /Invalid cron minute field/u,
    )
    expect(() => validateAssistantCronExpression('61 * * * *')).toThrowError(
      /Invalid cron minute field/u,
    )

    expect(
      findNextAssistantCronOccurrence(
        '0 9 * * 1',
        new Date('2026-04-08T08:59:00.000Z'),
        'UTC',
      ),
    ).toBe('2026-04-13T09:00:00.000Z')

    expect(
      findNextAssistantCronOccurrence(
        '0 9 13 * *',
        new Date('2026-04-08T08:59:00.000Z'),
        'UTC',
      ),
    ).toBe('2026-04-13T09:00:00.000Z')

    expect(() =>
      computeAssistantCronNextRunAt(
        {
          kind: 'dailyLocal',
          localTime: '25:61',
        },
        new Date('2026-04-08T00:00:00.000Z'),
      ),
    ).toThrowError(/valid HH:MM local time/u)

    expect(() =>
      findNextAssistantCronOccurrence(
        '0 9 * * *',
        new Date('2026-04-08T08:59:00.000Z'),
        'Not/A_Real_Zone',
      ),
    ).toThrowError(/valid IANA timezone/u)
  })

  it('covers cron install, default timezone resolution, targets, runs, and removal', async () => {
    const { vaultRoot } = await createRuntimeContext('assistant-cron-owned-branches-')

    cronMocks.loadVault.mockResolvedValueOnce({
      metadata: {
        timezone: 'Australia/Sydney',
      },
    })

    const installed = await installAssistantCronPreset({
      channel: 'telegram',
      deliveryTarget: 'telegram-room',
      name: '   ',
      presetId: 'morning-mindfulness',
      schedule: {
        expression: '0 7 * * *',
        kind: 'cron',
      },
      vault: vaultRoot,
    })
    expect(installed.preset.id).toBe('morning-mindfulness')
    expect(installed.job.name).toBe('morning-mindfulness')
    expect(installed.job.schedule).toMatchObject({
      expression: '0 7 * * *',
      kind: 'cron',
    })
    expect(installed.resolvedPrompt).toContain('Send me a short morning mindfulness prompt')

    const slugLookupJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'slug-room',
      name: 'Morning Check In',
      prompt: 'slug lookup job',
      schedule: {
        kind: 'dailyLocal',
        localTime: '09:00',
      },
      vault: vaultRoot,
    })
    const slugLookupRecord = getVaultAutomationStore(vaultRoot).find(
      (record) => record.automationId === slugLookupJob.jobId,
    )
    if (slugLookupRecord) {
      slugLookupRecord.slug = 'morning-check-in'
    }
    await expect(
      getAssistantCronJobTarget(vaultRoot, 'morning-check-in'),
    ).resolves.toMatchObject({
      target: {
        channel: 'telegram',
        deliveryTarget: 'slug-room',
      },
    })
    await expect(
      getAssistantCronJobTarget(vaultRoot, 'MORNING CHECK IN'),
    ).resolves.toMatchObject({
      target: {
        channel: 'telegram',
        deliveryTarget: 'slug-room',
      },
    })

    cronMocks.loadVault.mockRejectedValueOnce(new Error('vault unavailable'))
    const fallbackTimeZoneJob = await addAssistantCronJob({
      channel: 'telegram',
      deliveryTarget: 'fallback-room',
      name: 'fallback-timezone',
      prompt: 'fallback timezone job',
      schedule: {
        expression: '0 8 * * *',
        kind: 'cron',
      },
      vault: vaultRoot,
    })
    expect(fallbackTimeZoneJob.schedule).toMatchObject({
      expression: '0 8 * * *',
      kind: 'cron',
    })
    await expect(
      addAssistantCronJob({
        channel: 'email',
        deliveryTarget: 'team@example.com',
        name: 'unsupported-local-email',
        prompt: 'email route is unavailable locally',
        schedule: {
          expression: '0 9 * * *',
          kind: 'cron',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_DELIVERY_REQUIRED',
      message: expect.stringMatching(/local email automation delivery is not supported/i),
    })

    const canonicalRecords = getVaultAutomationStore(vaultRoot)
    expect(canonicalRecords).toHaveLength(3)
    if (canonicalRecords[0]) {
      const [firstRecord] = canonicalRecords
      firstRecord.continuityPolicy = 'reset'
    }

    const listedJobs = await listAssistantCronJobs(vaultRoot)
    expect(listedJobs).toHaveLength(3)
    const resetJob = listedJobs.find((job) => job.jobId === installed.job.jobId)
    expect(resetJob?.target.alias).toBeNull()
    expect(resetJob?.target.sessionId).toBeNull()
    expect(listedJobs.find((job) => job.jobId === slugLookupJob.jobId)?.name).toBe(
      'Morning Check In',
    )

    await expect(getAssistantCronJobTarget(vaultRoot, installed.job.jobId)).resolves.toMatchObject({
      bindingDelivery: null,
      target: {
        channel: 'telegram',
        deliveryTarget: 'telegram-room',
        sessionId: null,
      },
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    await appendAssistantCronRun(paths, {
      error: null,
      finishedAt: '2026-04-08T09:05:00.000Z',
      outcome: 'delivered',
      reason: 'sent',
      startedAt: '2026-04-08T09:00:00.000Z',
      status: 'succeeded',
      trigger: 'manual',
      jobId: fallbackTimeZoneJob.jobId,
      response: null,
      responseLength: 0,
      runId: 'cronrun_owned_branch',
      schema: 'murph.assistant-cron-run.v1',
      sessionId: null,
    })

    await expect(
      listAssistantCronRuns({
        job: fallbackTimeZoneJob.jobId,
        limit: 1,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      jobId: fallbackTimeZoneJob.jobId,
      runs: [
        expect.objectContaining({
          jobId: fallbackTimeZoneJob.jobId,
          runId: 'cronrun_owned_branch',
          status: 'succeeded',
        }),
      ],
    })

    await expect(
      listAssistantCronRuns({
        job: ' missing-job ',
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      jobId: 'missing-job',
      runs: [],
    })

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    expect(runtimeStore.jobs.some((record) => record.jobId === installed.job.jobId)).toBe(
      true,
    )

    const removed = await removeAssistantCronJob(vaultRoot, installed.job.jobId)
    expect(removed.jobId).toBe(installed.job.jobId)
    expect(findCanonicalAutomation(vaultRoot, installed.job.jobId)?.status).toBe(
      'archived',
    )

    const updatedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    expect(
      updatedRuntimeStore.jobs.some(
        (record) => record.jobId === installed.job.jobId,
      ),
    ).toBe(false)
  })
})

describe('assistant cron write locking', () => {
  it('ignores an empty lock directory and surfaces held-lock messages with readable owner metadata', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-cron-lock-branches-',
    )
    tempRoots.push(parentRoot)

    const paths = resolveAssistantStatePaths(vaultRoot)
    const lockDirectory = path.join(
      paths.assistantStateRoot,
      '.locks',
      'assistant-cron-write',
    )
    const metadataPath = path.join(lockDirectory, 'owner.json')

    await mkdir(lockDirectory, {
      recursive: true,
    })

    await expect(
      withAssistantCronWriteLock(paths, async () => undefined),
    ).resolves.toBeUndefined()

    await mkdir(lockDirectory, {
      recursive: true,
    })

    await writeFile(
      metadataPath,
      JSON.stringify({
        command: 'assistant cron test',
        pid: process.pid,
        startedAt: '2026-04-08T12:00:00.000Z',
      }),
      'utf8',
    )

    await expect(
      withAssistantCronWriteLock(paths, async () => undefined),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CRON_LOCKED',
      message:
        'Assistant cron writes are already in progress (pid=' +
        `${process.pid}, startedAt=2026-04-08T12:00:00.000Z, command=assistant cron test).`,
    })
  })
})

function getVaultAutomationStore(vault: string): MockAutomationRecord[] {
  const existing = cronMocks.automationsByVault.get(vault)
  if (existing) {
    return existing
  }

  const created: MockAutomationRecord[] = []
  cronMocks.automationsByVault.set(vault, created)
  return created
}

function findCanonicalAutomation(
  vault: string,
  lookup: string,
): MockAutomationRecord | undefined {
  const normalized = lookup.trim()
  return getVaultAutomationStore(vault).find(
    (record) => record.automationId === normalized || record.title === normalized,
  )
}

async function createRuntimeContext(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

function createTelegramResponse(
  status: number,
  payload: unknown,
): {
  json: () => Promise<unknown>
  ok: boolean
  status: number
} {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  }
}

function createQueuedFetch(
  queue: Array<
    | Error
    | {
        json: () => Promise<unknown>
        ok: boolean
        status: number
      }
  >,
) {
  return vi.fn(
    async (
      _input: string,
      _init: {
        body?: string | Blob | FormData
        headers?: Record<string, string>
        method: string
        signal?: AbortSignal
      },
    ) => {
      const next = queue.shift()
      if (!next) {
        throw new Error('missing queued fetch response')
      }
      if (next instanceof Error) {
        throw next
      }
      return next
    },
  )
}

function readJsonBody(body: string | Blob | FormData | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    return {}
  }

  const parsed = JSON.parse(body)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function createInboxCapture(
  threadIsDirect: boolean,
): InboxShowResult['capture'] {
  return {
    accountId: null,
    actorId: null,
    actorIsSelf: false,
    actorName: null,
    attachmentCount: 0,
    attachments: [],
    captureId: 'capture-1',
    createdAt: '2026-04-08T00:00:00.000Z',
    sourceDirectory: 'raw/inbox/telegram/capture-1',
    eventId: 'event-1',
    externalId: 'external-1',
    occurredAt: '2026-04-08T00:00:00.000Z',
    promotions: [],
    receivedAt: null,
    source: 'telegram',
    text: null,
    threadId: 'thread-1',
    threadIsDirect,
    threadTitle: null,
  }
}
