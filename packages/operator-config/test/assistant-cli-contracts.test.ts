import { describe, expect, it } from 'vitest'
import {
  automationRouteSchema,
  automationScheduleAtSchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
  automationScheduleEverySchema,
  automationScheduleKindValues,
  automationScheduleSchema,
  automationTimeScheduleKindValues,
  automationTimeScheduleSchema,
} from '@murphai/contracts'

import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
} from '@murphai/gateway-core'

import {
  ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT,
  assistantAskResultSchema,
  assistantCronAtScheduleSchema,
  assistantCronDailyLocalScheduleSchema,
  assistantCronEveryScheduleSchema,
  assistantCronExpressionScheduleInputSchema,
  assistantCronExpressionScheduleSchema,
  assistantCronJobSchema,
  assistantCronJobStateSchema,
  assistantCronScheduleKindValues,
  assistantCronScheduleSchema,
  assistantCronTargetSchema,
  assistantCronRunRecordSchema,
  assistantBindingDeliveryKindValues,
  assistantChannelNameSchema,
  assistantChannelNameValues,
  assistantChannelDeliveryTargetKindValues,
  assistantOutboxIntentSchema,
  assistantResponseMediaSchema,
  assistantSessionSecretsSchema,
  assistantSessionIdSchema,
  assistantSelfDeliveryTargetSchema,
  assistantTurnReceiptSchema,
  normalizeAssistantResponseMediaUrl,
} from '../src/assistant-cli-contracts.ts'

const NUTRITION_RESPONSE_CARD = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
} as const

const EXERCISE_ROUTINE_RESPONSE_CARD = {
  exercises: [{
    dose: '8 repetitions',
    estimatedSeconds: 45,
    images: [],
    instructions: ['Move slowly.'],
    name: 'Shoulder circles',
  }],
  footer: null,
  intensity: 'Easy',
  kind: 'exercise_routine',
  labels: {
    dose: 'Dose',
    exercise: 'Exercise',
    time: 'Time',
    visualGuide: 'Visual guide',
  },
  safety: 'Stop if pain increases.',
  subtitle: null,
  title: 'Short reset',
  totalSeconds: 60,
  transitionSeconds: 15,
  version: 1,
} as const

const TELEGRAM_RICH_CONTENT_RESPONSE_CARD = {
  html: '<h2>Travel prep</h2><ol><li>Pack the charger.</li></ol>',
  kind: 'telegram_rich_content',
  version: 1,
} as const

describe('assistant CLI delivery contracts', () => {
  it('accepts hash-bound private vault images without a public URL', () => {
    const media = {
      alt: 'Generated mobility setup',
      contentType: 'image/webp' as const,
      filename: 'generated-mobility.webp',
      kind: 'vault_image' as const,
      ref: 'raw/captures/generated-mobility.webp',
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
      source: 'gpt-image-2',
    }

    expect(assistantResponseMediaSchema.parse(media)).toEqual(media)
    expect(() => assistantResponseMediaSchema.parse({
      ...media,
      ref: '../generated-mobility.webp',
    })).toThrow()
    expect(() => assistantResponseMediaSchema.parse({
      ...media,
      contentType: 'image/svg+xml',
    })).toThrow()
    expect(() => assistantResponseMediaSchema.parse({
      ...media,
      url: 'https://example.test/private-image',
    })).toThrow()
  })

  it('keeps the supported messaging channels explicit after the hard cut', () => {
    expect(assistantChannelNameValues).toEqual(['telegram', 'linq', 'email'])
    expect(() => assistantChannelNameSchema.parse('whatsapp')).toThrow()
  })

  it('reuses gateway-owned delivery target kinds', () => {
    expect(assistantChannelDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues)
  })

  it('reuses gateway-owned reply route kinds for bindings', () => {
    expect(assistantBindingDeliveryKindValues).toEqual(gatewayReplyRouteKindValues)
  })

  it('trims assistant session ids before returning them', () => {
    expect(assistantSessionIdSchema.parse('  session_123  ')).toBe('session_123')
  })

  it('normalizes assistant turn and outbox ids inside persisted assistant records', () => {
    const receipt = assistantTurnReceiptSchema.parse({
      schema: 'murph.assistant-turn-receipt.v1',
      turnId: '  turn_123  ',
      sessionId: '  session_123  ',
      provider: 'codex-cli',
      providerModel: null,
      promptPreview: null,
      responsePreview: null,
      status: 'running',
      deliveryRequested: false,
      deliveryDisposition: 'not-requested',
      deliveryIntentId: null,
      startedAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      completedAt: null,
      lastError: null,
      timeline: [],
    })

    expect(receipt.turnId).toBe('turn_123')
    expect(receipt.sessionId).toBe('session_123')

    const intent = assistantOutboxIntentSchema.parse({
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: '  outbox_123  ',
      sessionId: '  session_123  ',
      turnId: '  turn_123  ',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message: 'hello',
      dedupeKey: 'dedupe',
      targetFingerprint: 'target',
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      replyToMessageId: null,
      bindingDelivery: null,
      explicitTarget: null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      lastError: null,
    })

    expect(intent.intentId).toBe('outbox_123')
    expect(intent.sessionId).toBe('session_123')
    expect(intent.turnId).toBe('turn_123')
    expect(intent.automationAuthority).toBeUndefined()

    const authorizedIntent = assistantOutboxIntentSchema.parse({
      ...intent,
      automationAuthority: {
        automationId: ' automation_sleep_reminder ',
        supportSeriesId: 'experiment:exp_sleep',
        expectedSemanticRevision: 'a'.repeat(64),
        expectedUpdatedAt: '2026-04-12T00:00:00.000Z',
      },
    })
    expect(authorizedIntent.automationAuthority).toEqual({
      automationId: 'automation_sleep_reminder',
      supportSeriesId: 'experiment:exp_sleep',
      expectedSemanticRevision: 'a'.repeat(64),
      expectedUpdatedAt: '2026-04-12T00:00:00.000Z',
    })
    expect(() => assistantOutboxIntentSchema.parse({
      ...intent,
      automationAuthority: {
        automationId: 'automation_sleep_reminder',
        expectedStatus: 'active',
        expectedUpdatedAt: '2026-04-12T00:00:00.000Z',
      },
    })).toThrow()
  })

  it('defaults legacy outbox cards to null and enforces card boundaries', () => {
    const baseIntent = {
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_card_contract',
      sessionId: 'session_card_contract',
      turnId: 'turn_card_contract',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message: 'nutrition summary',
      media: [],
      operation: null,
      subject: null,
      dedupeKey: 'dedupe-card-contract',
      targetFingerprint: 'target-card-contract',
      channel: 'linq',
      identityId: null,
      actorId: '+15550001',
      answeredMailboxItemIds: [],
      threadId: 'linq-thread-card-contract',
      threadIsDirect: true,
      replyToMessageId: null,
      bindingDelivery: {
        kind: 'thread',
        target: 'linq-thread-card-contract',
      },
      deliverySource: null,
      explicitTarget: null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      preparedDispatchToken: null,
      lastError: null,
    }

    expect(assistantOutboxIntentSchema.parse(baseIntent).card).toBeNull()
    expect(assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: NUTRITION_RESPONSE_CARD,
    }).card).toEqual(NUTRITION_RESPONSE_CARD)
    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: NUTRITION_RESPONSE_CARD,
      media: [{
        alt: null,
        kind: 'image',
        source: null,
        url: 'https://cdn.example.test/nutrition.png',
      }],
    })).toThrow('Assistant response cards cannot be combined with response media.')
    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: NUTRITION_RESPONSE_CARD,
      operation: {
        kind: 'message-reaction',
        reaction: 'heart',
      },
    })).toThrow('Assistant response cards require a normal message intent.')
    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: NUTRITION_RESPONSE_CARD,
      channel: 'telegram',
      threadIsDirect: false,
    })).toThrow('Assistant response cards require a private direct conversation.')

    for (const card of [
      EXERCISE_ROUTINE_RESPONSE_CARD,
      TELEGRAM_RICH_CONTENT_RESPONSE_CARD,
    ]) {
      expect(assistantOutboxIntentSchema.parse({
        ...baseIntent,
        card,
        channel: 'telegram',
        threadIsDirect: false,
      }).card).toEqual(card)
      expect(() => assistantOutboxIntentSchema.parse({
        ...baseIntent,
        card,
        channel: 'linq',
        threadIsDirect: false,
      })).toThrow('Assistant response cards require a private direct conversation.')
    }
  })

  it('accepts only valid true-only native reply message intents', () => {
    const legacyIntent = assistantOutboxIntentSchema.parse({
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_native_reply',
      sessionId: 'session_native_reply',
      turnId: 'turn_native_reply',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message: 'hello',
      dedupeKey: 'dedupe-native-reply',
      targetFingerprint: 'target-native-reply',
      channel: 'linq',
      identityId: null,
      actorId: null,
      threadId: 'linq-thread',
      threadIsDirect: true,
      replyToMessageId: 'linq-message',
      bindingDelivery: {
        kind: 'thread',
        target: 'linq-thread',
      },
      explicitTarget: null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      lastError: null,
    })

    expect(legacyIntent).not.toHaveProperty('nativeReplyRequested')
    expect(assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      nativeReplyRequested: true,
    }).nativeReplyRequested).toBe(true)
    expect(assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      channel: 'telegram',
      nativeReplyRequested: true,
      replyToMessageId: '42',
    }).nativeReplyRequested).toBe(true)

    expect(() => assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      nativeReplyRequested: false,
    })).toThrow()
    expect(() => assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      nativeReplyRequested: true,
      replyToMessageId: null,
    })).toThrow('Assistant native replies require a target message id.')
    expect(() => assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      nativeReplyRequested: true,
      operation: {
        kind: 'message-reaction',
        reaction: 'thumbs_up',
      },
    })).toThrow('Assistant native replies must use a normal message intent.')
    expect(() => assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      channel: 'email',
      nativeReplyRequested: true,
    })).toThrow('Assistant native replies require a supported message channel.')
    expect(() => assistantOutboxIntentSchema.parse({
      ...legacyIntent,
      channel: 'telegram',
      nativeReplyRequested: true,
      replyToMessageId: 'not-numeric',
    })).toThrow(
      'Assistant Telegram native replies require a numeric target message id.',
    )
    for (const channel of ['linq', 'telegram']) {
      for (const replyToMessageId of [
        'ain_private-ref',
        'hid_private-ref',
        'h1_0123456789abcdef01234567',
        '[redacted provider message]',
        'hbid:private-ref',
        'hbidx:private-ref',
        'linq:ain_private-ref',
        'linq:hid_private-ref',
        'provider:hbid:private-ref',
        'provider:hbidx:private-ref',
      ]) {
        expect(() => assistantOutboxIntentSchema.parse({
          ...legacyIntent,
          channel,
          nativeReplyRequested: true,
          replyToMessageId,
        })).toThrow('Assistant native replies require a provider message id.')
      }
    }
  })

  it('bounds assistant outbox answered mailbox item ids above the hosted import default', () => {
    const baseIntent = {
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_123',
      sessionId: 'session_123',
      turnId: 'turn_123',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message: 'hello',
      dedupeKey: 'dedupe',
      targetFingerprint: 'target',
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      replyToMessageId: null,
      bindingDelivery: null,
      explicitTarget: null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      lastError: null,
    }
    const maxIds = Array.from(
      { length: ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT },
      (_, index) => `mailbox_item_${index}`,
    )

    expect(assistantOutboxIntentSchema.parse({
      ...baseIntent,
      answeredMailboxItemIds: maxIds,
    }).answeredMailboxItemIds).toEqual(maxIds)
    expect(() =>
      assistantOutboxIntentSchema.parse({
        ...baseIntent,
        answeredMailboxItemIds: [
          ...maxIds,
          'mailbox_item_over_limit',
        ],
      }),
    ).toThrow()
  })

  it('normalizes assistant cron ids and nullable session ids', () => {
    const job = assistantCronJobSchema.parse({
      schema: 'murph.assistant-cron-job.v1',
      jobId: '  cronjob_123  ',
      name: 'Daily check-in',
      enabled: true,
      keepAfterRun: false,
      prompt: 'Ping me',
      schedule: {
        kind: 'every',
        everyMs: 60_000,
      },
      target: {
        sessionId: '  session_123  ',
        alias: null,
        channel: null,
        identityId: null,
        participantId: null,
        threadId: null,
        deliveryTarget: null,
      },
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      state: {
        nextRunAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      },
    })

    expect(job.jobId).toBe('cronjob_123')
    expect(job.target.sessionId).toBe('session_123')

    const run = assistantCronRunRecordSchema.parse({
      schema: 'murph.assistant-cron-run.v1',
      runId: '  cronrun_123  ',
      jobId: '  cronjob_123  ',
      trigger: 'manual',
      status: 'succeeded',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:01:00.000Z',
      sessionId: '  session_123  ',
      response: null,
      responseLength: 0,
      error: null,
    })

    expect(run.runId).toBe('cronrun_123')
    expect(run.jobId).toBe('cronjob_123')
    expect(run.sessionId).toBe('session_123')
    expect(run.notificationDecision).toBeUndefined()
    expect(run.scheduledOccurrenceAt).toBeUndefined()

    expect(assistantCronRunRecordSchema.parse({
      ...run,
      notificationDecision: {
        kind: 'skip',
        reasonCode: 'provider_skip',
      },
      scheduledOccurrenceAt: '2026-04-12T00:00:00.000Z',
    })).toMatchObject({
      notificationDecision: {
        kind: 'skip',
        reasonCode: 'provider_skip',
      },
      scheduledOccurrenceAt: '2026-04-12T00:00:00.000Z',
    })

    expect(() => assistantCronRunRecordSchema.parse({
      ...run,
      notificationDecision: {
        kind: 'skip',
        reasonCode: 'provider_send_message',
      },
    })).toThrow()
  })

  it('rejects the removed assistant cron deliverResponse field', () => {
    expect(() =>
      assistantCronJobSchema.parse({
        schema: 'murph.assistant-cron-job.v1',
        jobId: 'cronjob_456',
        name: 'Daily check-in',
        enabled: true,
        keepAfterRun: false,
        prompt: 'Ping me',
        schedule: {
          kind: 'every',
          everyMs: 60_000,
        },
        target: {
          sessionId: null,
          alias: null,
          channel: 'telegram',
          identityId: null,
          participantId: 'user_123',
          threadId: 'thread_123',
          deliveryTarget: null,
          deliverResponse: true,
        },
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        state: {
          nextRunAt: null,
          lastRunAt: null,
          lastSucceededAt: null,
          lastFailedAt: null,
          consecutiveFailures: 0,
          lastError: null,
          runningAt: null,
          runningPid: null,
        },
      }),
    ).toThrow()
  })

  it('normalizes assistant response media URLs to public image URLs only', () => {
    expect(
      assistantResponseMediaSchema.parse({
        kind: 'image',
        url: ' https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/889a5f43-1d35-4eae-a98e-7ae69e96a800/public ',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      }),
    ).toEqual({
      kind: 'image',
      url: 'https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/889a5f43-1d35-4eae-a98e-7ae69e96a800/public',
      alt: 'Dead bug setup',
      source: 'dead-bug-setup',
    })

    expect(normalizeAssistantResponseMediaUrl('https://cdn.example.test/dead-bug/setup.png'))
      .toBe('https://cdn.example.test/dead-bug/setup.png')

    for (const url of [
      'http://cdn.example.test/dead-bug/setup.png',
      'https://user:pass@cdn.example.test/dead-bug/setup.png',
      'https://cdn.example.test/dead-bug/setup.png?token=secret',
      'https://cdn.example.test/dead-bug/setup.png#step',
      'https://localhost/dead-bug/setup.png',
      'https://assets.local/dead-bug/setup.png',
      'https://127.0.0.1/dead-bug/setup.png',
      'https://8.8.8.8/dead-bug/setup.png',
      'https://10.0.0.5/dead-bug/setup.png',
      'https://172.16.0.5/dead-bug/setup.png',
      'https://192.168.1.5/dead-bug/setup.png',
      'https://169.254.169.254/dead-bug/setup.png',
      'https://[::1]/dead-bug/setup.png',
      'https://[fe80::1]/dead-bug/setup.png',
      'https://[fd00::1]/dead-bug/setup.png',
      'https://[2001:db8::1]/dead-bug/setup.png',
      'https://[2606:4700:4700::1111]/dead-bug/setup.png',
      'https://[::ffff:127.0.0.1]/dead-bug/setup.png',
      'https://cdn.example.test/dead-bug/setup',
      'https://example.test/dead-bug/setup.txt',
    ]) {
      expect(() => normalizeAssistantResponseMediaUrl(url), url).toThrow()
    }
  })

  it('accepts only the exact assistant runtime generated-delivery ref exception', () => {
    const media = {
      approvalGeneration: null,
      approvalId: null,
      contentType: 'application/pdf',
      filename: 'report.pdf',
      kind: 'vault_file' as const,
      ref: '.runtime/operations/assistant/generated-deliveries/report.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
    }

    expect(assistantResponseMediaSchema.parse(media)).toEqual(media)
    expect(assistantResponseMediaSchema.parse({
      ...media,
      ref: 'documents/report.pdf',
    })).toMatchObject({ ref: 'documents/report.pdf' })

    for (const ref of [
      '.runtime/operations/assistant/generated-deliveries-backup/report.pdf',
      '.runtime/operations/assistant/generated-deliveries/nested/report.pdf',
      '.runtime/operations/assistant/generated-deliveries/.hidden.pdf',
      '.runtime/operations/assistant/generated-deliveries/report.pdf.tmp',
      '.runtime/operations/assistant/outbox/intent.json',
      '.hidden/report.pdf',
      '../report.pdf',
      '/report.pdf',
    ]) {
      expect(() => assistantResponseMediaSchema.parse({
        ...media,
        ref,
      }), ref).toThrow()
    }
  })

  it('accepts Linq-backed voice memo media via a discriminated transport', () => {
    expect(
      assistantResponseMediaSchema.parse({
        kind: 'voice_memo',
        filename: ' memo.mp3 ',
        transport: {
          attachmentId: ' attachment_123 ',
          kind: 'linq_attachment',
        },
      }),
    ).toEqual({
      kind: 'voice_memo',
      filename: 'memo.mp3',
      transcript: null,
      transport: {
        attachmentId: 'attachment_123',
        kind: 'linq_attachment',
      },
    })

    expect(
      assistantResponseMediaSchema.parse({
        kind: 'voice_memo',
        filename: ' telegram-memo.mp3 ',
        transcript: ' Telegram memo transcript. ',
        transport: {
          generation: {
            kind: 'elevenlabs_speech',
            modelId: ' eleven_multilingual_v2 ',
            outputFormat: 'mp3_44100_128',
            text: ' Telegram memo transcript. ',
            voiceId: ' voice_murph ',
          },
          kind: 'telegram_generation',
        },
      }),
    ).toEqual({
      kind: 'voice_memo',
      filename: 'telegram-memo.mp3',
      transcript: 'Telegram memo transcript.',
      transport: {
        generation: {
          kind: 'elevenlabs_speech',
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
          text: 'Telegram memo transcript.',
          voiceId: 'voice_murph',
        },
        kind: 'telegram_generation',
      },
    })

    expect(
      assistantResponseMediaSchema.parse({
        kind: 'voice_memo',
        filename: 'song.mp3',
        transport: {
          generation: {
            durationMs: 30_000,
            forceInstrumental: true,
            kind: 'elevenlabs_music',
            modelId: 'music_v2',
            outputFormat: 'mp3_48000_192',
            prompt: 'Upbeat lo-fi piano motif',
          },
          kind: 'telegram_generation',
        },
      }),
    ).toEqual({
      kind: 'voice_memo',
      filename: 'song.mp3',
      transcript: null,
      transport: {
        generation: {
          durationMs: 30_000,
          forceInstrumental: true,
          kind: 'elevenlabs_music',
          modelId: 'music_v2',
          outputFormat: 'mp3_48000_192',
          prompt: 'Upbeat lo-fi piano motif',
        },
        kind: 'telegram_generation',
      },
    })

    expect(() =>
      assistantResponseMediaSchema.parse({
        kind: 'voice_memo',
        filename: 'memo.mp3',
      }),
    ).toThrow()
  })

  it('keeps assistant ask results backward compatible when response disposition is absent', () => {
    const session = {
      schema: 'murph.assistant-conversation.v2',
      conversationId: 'session_contract_ask',
      sessionId: 'session_contract_ask',
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
      codexTarget: {
        adapter: 'codex-cli',
        approvalPolicy: null,
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
      },
      target: {
        adapter: 'codex-cli',
        approvalPolicy: null,
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
      },
      codexResume: null,
      resumeState: null,
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      lastTurnAt: null,
      turnCount: 1,
      provider: 'codex-cli',
      providerOptions: {
        continuityFingerprint: 'assistant-contract-fingerprint',
        provider: 'codex-cli',
        model: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        executionDriver: 'codex-app-server',
        resumeKind: 'codex-thread',
      },
    }

    const normal = assistantAskResultSchema.parse({
      vault: '/vaults/test',
      prompt: 'hello',
      response: 'normal reply',
      session,
      delivery: null,
      deliveryError: null,
    })

    expect(normal.responseDisposition).toBeUndefined()
    expect(normal.deliveryDeferred).toBe(false)
    expect(normal.deliveryIntentId).toBeNull()

    expect(
      assistantAskResultSchema.parse({
        vault: '/vaults/test',
        prompt: 'hello',
        response: '',
        responseDisposition: 'none',
        session,
        delivery: null,
        deliveryError: null,
      }).responseDisposition,
    ).toBe('none')
  })

  it('rejects assistant ids with path separators or traversal segments', () => {
    expect(() => assistantSessionIdSchema.parse('../session_123')).toThrow(
      /opaque runtime ids/i,
    )
  })

  it('rejects the obsolete provider binding header bucket', () => {
    expect(() =>
      assistantSessionSecretsSchema.parse({
        schema: 'murph.assistant-session-secrets.v1',
        sessionId: 'sess_headers_roundtrip',
        updatedAt: '2026-04-13T00:00:00.000Z',
        providerHeaders: {
          'X-Upstream-Auth': 'Bearer firstsecret123',
        },
        providerBindingHeaders: {
          'X-Old-Binding-Auth': 'Bearer oldsecret456',
        },
      }),
    ).toThrow()
  })
})

describe('assistant CLI automation shape ownership', () => {
  it('keeps assistant cron schedules on the canonical automation owners', () => {
    expect(automationScheduleKindValues).toContain('deviceActivity')
    expect(assistantCronScheduleKindValues).toBe(automationTimeScheduleKindValues)
    expect(assistantCronAtScheduleSchema).toBe(automationScheduleAtSchema)
    expect(assistantCronEveryScheduleSchema).toBe(automationScheduleEverySchema)
    expect(assistantCronExpressionScheduleSchema).toBe(automationScheduleCronSchema)
    expect(assistantCronDailyLocalScheduleSchema).toBe(automationScheduleDailyLocalSchema)
    expect(assistantCronScheduleSchema).toBe(automationTimeScheduleSchema)

    expect(
      assistantCronExpressionScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
        timeZone: 'America/Chicago',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
      timeZone: 'America/Chicago',
    })

    expect(
      assistantCronDailyLocalScheduleSchema.parse({
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'America/Chicago',
      }),
    ).toEqual({
      kind: 'dailyLocal',
      localTime: '09:00',
      timeZone: 'America/Chicago',
    })

    expect(() =>
      assistantCronScheduleSchema.parse({
        kind: 'deviceActivity',
        after: '2026-06-07T12:00:00.000Z',
      }),
    ).toThrow()

    expect(
      automationScheduleSchema.parse({
        kind: 'deviceActivity',
        after: '2026-06-07T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'deviceActivity',
      after: '2026-06-07T12:00:00.000Z',
    })
  })

  it('normalizes saved self-delivery targets from canonical automation routes', () => {
    const route = {
      channel: 'slack',
      deliveryTarget: 'channel:alerts',
      identityId: 'idn_123',
      participantId: 'user_123',
      threadId: 'thread_123',
    }

    expect(automationRouteSchema.parse(route)).toEqual(route)
    expect(assistantSelfDeliveryTargetSchema.parse(route)).toEqual({
      ...route,
      deliverySource: null,
    })
  })

  it('composes canonical route fields into cron targets while keeping local selector fields', () => {
    const target = assistantCronTargetSchema.parse({
      channel: 'telegram',
      deliveryTarget: 'chat:123',
      identityId: null,
      participantId: 'participant_123',
      threadId: null,
      alias: 'personal',
      sessionId: null,
    })

    const { alias, sessionId, threadId, ...route } = target
    expect({ alias, sessionId }).toEqual({
      alias: 'personal',
      sessionId: null,
    })
    expect({
      ...route,
      threadId: threadId,
    }).toEqual(
      automationRouteSchema.parse({
        ...route,
        threadId: threadId,
      }),
    )
  })

  it('keeps route-less cron targets valid for local-only jobs', () => {
    expect(
      assistantCronTargetSchema.parse({
        channel: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
        alias: null,
        sessionId: null,
      }),
    ).toEqual({
      channel: null,
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
      alias: null,
      sessionId: null,
    })
  })

  it('preserves explicit timezone on recurring cron inputs and persisted schedules', () => {
    expect(
      assistantCronExpressionScheduleInputSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
      timeZone: 'America/Los_Angeles',
    })

    expect(
      assistantCronScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
      timeZone: 'America/Los_Angeles',
    })

    expect(
      assistantCronScheduleSchema.parse({
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'dailyLocal',
      localTime: '09:00',
      timeZone: 'America/Los_Angeles',
    })
  })

  it('keeps the public cron job state surface stable on nextRunAt', () => {
    expect(
      assistantCronJobStateSchema.parse({
        nextRunAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      }),
    ).toEqual({
      nextRunAt: null,
      lastRunAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
      lastError: null,
      runningAt: null,
      runningPid: null,
    })

    expect(() =>
      assistantCronJobStateSchema.parse({
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      }),
    ).toThrow()
  })
})
