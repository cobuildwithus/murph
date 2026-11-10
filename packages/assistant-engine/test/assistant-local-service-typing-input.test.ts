import { expect, test, vi } from 'vitest'

import { assistantInputCandidateFromStoredEvent } from '../src/assistant/input-source.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { createTempVaultContext } from './test-helpers.ts'
import {
  createAssistantSession,
  createDeferred,
  createHostedMailboxSourceRef,
  createSharedPlan,
  loadLocalServiceModule,
  tempRoots,
} from './assistant-local-service-runtime.harness.ts'

test.each((['linq', 'telegram'] as const).flatMap((channel) =>
  [false, true].map((pending) => ({ channel, pending })),
))('starts $channel typing at the provider request and records earlier inputs (pending: $pending)', async ({ channel, pending }) => {
  const context = await createTempVaultContext('assistant-typing-admission-')
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({ binding: {
    actorId: null, channel, conversationKey: null, identityId: null,
    delivery: { kind: 'thread', target: '12345' }, threadId: '12345', threadIsDirect: true,
  } })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience,
    actorId: null, channel, threadId: '12345', threadIsDirect: true,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan, session, realAcceptedInputPersistence: true,
  })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const providerReady = createDeferred<void>()
  const stop = vi.fn(async () => undefined)
  const startTyping = vi.fn(async () => {
    if (pending) await providerReady.promise
    return { stop }
  })
  const onTypingAccepted = vi.fn()
  let followup: Awaited<ReturnType<typeof upsertAssistantInputEvent>> | null = null
  // Receipt and pre-provider admission must not start typing.
  mocks.createAssistantTurnReceipt.mockImplementationOnce(async () => {
    followup = await upsertAssistantInputEvent({ vault: context.vaultRoot, event: {
      content: { text: 'Synthetic follow-up' }, occurredAt: '2026-09-11T00:00:00.000Z',
      sourceRef: createHostedMailboxSourceRef({ eventId: 'evt_pre_typing_followup', laneSeq: '2' }),
    } })
    expect(startTyping).not.toHaveBeenCalled()
    return { turnId: 'turn-1' }
  })
  const activeTurnInput = vi.fn().mockImplementationOnce(async () => {
    if (!followup) throw new Error('Expected staged follow-up')
    return {
      acceptedInputs: [{
        ...assistantInputCandidateFromStoredEvent(followup).acceptedInput,
        promptFallbackText: 'Synthetic follow-up',
      }],
      kind: 'accepted', prompt: 'Synthetic follow-up', transcriptText: 'Synthetic follow-up',
    }
  }).mockResolvedValue({ kind: 'no-new-input' })
  const execute = mocks.executeCodexTurnWithRecovery.getMockImplementation()!
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (input) => {
    expect(activeTurnInput).toHaveBeenCalled()
    expect(startTyping).not.toHaveBeenCalled()
    const outcome = await execute(input)
    await vi.waitFor(() => expect(startTyping).toHaveBeenCalledOnce())
    // Retries/recovery share the handle, including while provider acceptance is pending.
    await input.onProviderRequestStarted?.({ startedAt: new Date().toISOString(), providerRequestOrdinal: 1 })
    if (pending) expect(onTypingAccepted).not.toHaveBeenCalled()
    providerReady.resolve()
    await vi.waitFor(() => expect(onTypingAccepted).toHaveBeenCalledWith({
      acceptedInputIds: ['initial', followup!.inputId], at: expect.any(String), channel,
    }))
    return outcome
  })
  try {
    await sendAssistantMessageLocal({
      activeTurnInput, channel, deliverResponse: true, prompt: 'Synthetic initial input',
      vault: context.vaultRoot,
      executionContext: { hosted: {
        memberId: 'synthetic-member', userEnvKeys: [],
        channelTypingDependencies: {
          startLinqTyping: startTyping, startTelegramTyping: startTyping, onTypingAccepted,
        },
      } },
    })
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
    expect(startTyping).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  } finally {
    providerReady.resolve()
  }
})

test.each([
  { channel: 'linq', kind: 'message' },
  { channel: 'linq', kind: 'reaction' },
  { channel: 'linq', kind: 'edit' },
  { channel: 'telegram', kind: 'message' },
] as const)('group $channel $kind starts no typing before the reply decision or for joined inputs', async ({ channel, kind }) => {
  const context = await createTempVaultContext('assistant-group-typing-')
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({ binding: {
    actorId: null, channel, conversationKey: null, identityId: null,
    delivery: { kind: 'thread', target: '12345' }, threadId: '12345', threadIsDirect: false,
  } })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience, channel, threadId: '12345', threadIsDirect: false,
  }
  const initial = await upsertAssistantInputEvent({ vault: context.vaultRoot, event: {
    content: { text: 'Synthetic group input' }, occurredAt: '2026-09-11T00:00:00.000Z',
    sourceRef: createHostedMailboxSourceRef({ eventId: `evt_group_${kind}`, laneSeq: '1' }),
    ...(channel === 'linq' ? { sourceMetadata: {
      kind: 'linq' as const, partCount: 1, replyToMessageId: null, service: 'iMessage',
      externalThreadRouteAuthorityPresent: true,
      ...(kind === 'reaction' ? { affirmativeReaction: true as const } : {}),
      ...(kind === 'edit' ? { editedSourceInputId: `ain_${'a'.repeat(32)}`, editedTextPartIndex: 0 } : {}),
    } } : {}),
  } })
  const followup = await upsertAssistantInputEvent({ vault: context.vaultRoot, event: {
    content: { text: 'Synthetic joined input' }, occurredAt: '2026-09-11T00:00:01.000Z',
    sourceRef: createHostedMailboxSourceRef({ eventId: 'evt_group_joined', laneSeq: '2' }),
  } })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan, session, realAcceptedInputPersistence: true,
    providerOutcome: { kind: 'succeeded', providerTurn: {
      onboardingGuidanceInjected: false, codexContinuation: { kind: 'explicit-structured-history' },
      finalAction: { kind: 'none' }, response: '', responseDeliveryContextOrdinal: 0,
      transcriptResponse: null, session,
    } },
  })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const startTyping = vi.fn(async () => ({ stop: vi.fn() }))
  const onTypingAccepted = vi.fn()
  const activeTurnInput = vi.fn().mockImplementationOnce(async () => ({
    acceptedInputs: [{ ...assistantInputCandidateFromStoredEvent(followup).acceptedInput,
      promptFallbackText: 'Synthetic joined input' }],
    kind: 'accepted', prompt: 'Synthetic joined input', transcriptText: 'Synthetic joined input',
  })).mockResolvedValue({ kind: 'no-new-input' })
  const execute = mocks.executeCodexTurnWithRecovery.getMockImplementation()!
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (input) => {
    expect(activeTurnInput).toHaveBeenCalled()
    expect(startTyping).not.toHaveBeenCalled()
    return execute(input)
  })
  await sendAssistantMessageLocal({
    acceptedTurnInput: { initialInputs: [assistantInputCandidateFromStoredEvent(initial).acceptedInput] },
    activeTurnInput, channel, deliverResponse: true, prompt: 'Synthetic group input',
    vault: context.vaultRoot,
    executionContext: { hosted: {
      memberId: 'synthetic-member', userEnvKeys: [],
      channelTypingDependencies: {
        startLinqTyping: startTyping, startTelegramTyping: startTyping, onTypingAccepted,
      },
    } },
  })
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
  expect(startTyping).not.toHaveBeenCalled()
  expect(onTypingAccepted).not.toHaveBeenCalled()
})

test('receipt failure never starts direct typing', async () => {
  const context = await createTempVaultContext('assistant-typing-receipt-failure-')
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({ binding: {
    actorId: null, channel: 'linq', conversationKey: null, identityId: null,
    delivery: { kind: 'thread', target: 'synthetic-direct' }, threadId: 'synthetic-direct', threadIsDirect: true,
  } })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience, channel: 'linq', threadId: 'synthetic-direct', threadIsDirect: true,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({ plan, session })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>('../src/assistant/channel-adapters.ts')
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const stop = vi.fn(async () => undefined)
  const startLinqTyping = vi.fn(async () => ({ stop }))
  mocks.createAssistantTurnReceipt.mockImplementationOnce(async () => {
    expect(startLinqTyping).not.toHaveBeenCalled()
    throw new Error('Synthetic receipt failure')
  })
  await expect(sendAssistantMessageLocal({
    channel: 'linq', deliverResponse: true, prompt: 'Synthetic input', vault: context.vaultRoot,
    executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [],
      channelTypingDependencies: { startLinqTyping },
    } },
  })).rejects.toThrow('Synthetic receipt failure')
  expect(startLinqTyping).not.toHaveBeenCalled()
  expect(stop).not.toHaveBeenCalled()
  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
})

test.each((['linq', 'telegram'] as const).flatMap((channel) => [
  { channel, draft: 'text', selected: null },
  { channel, draft: 'media', selected: null },
  { channel, draft: 'none', selected: null },
  { channel, draft: 'reaction', selected: null },
  { channel, draft: 'text', selected: 'none' },
  { channel, draft: 'text', selected: 'reaction' },
  { channel, draft: 'text', selected: 'text' },
  { channel, draft: 'none', selected: 'text' },
]))('held $channel draft $draft -> $selected owns typing only while a reply is pending', async ({ channel, draft, selected }) => {
  const session = createAssistantSession({ binding: {
    actorId: null, channel, conversationKey: null, identityId: null,
    delivery: { kind: 'thread', target: '12345' }, threadId: '12345', threadIsDirect: false,
  } })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience, channel, threadId: '12345',
    explicitTarget: '12345', threadIsDirect: false,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({ plan, session })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const stop = vi.fn(async () => undefined)
  const refreshAfterMessage = vi.fn(async () => undefined)
  const startTyping = vi.fn(async () => ({ stop, refreshAfterMessage }))
  const onTypingAccepted = vi.fn()
  const draftReady = createDeferred<void>()
  const draftTypes = draft === 'text' || draft === 'media'
  const selectedReplies = selected === null ? draftTypes : selected === 'text'
  const stopsAtResumeCleanup: number[] = []
  const result = (kind: string) => ({
    kind: 'succeeded' as const,
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' as const },
      codexThreadId: 'synthetic-held-thread', route: { routeFingerprint: 'synthetic-held-route' },
      session, responseDeliveryContextOrdinal: 0,
      response: kind === 'text' ? 'Synthetic reply' : '', transcriptResponse: null,
      ...(kind === 'none' || kind === 'reaction' ? { finalAction: { kind: 'none' as const } } : {}),
      ...(kind === 'reaction' ? { reactions: [{
        deliveryContextOrdinal: 0, reaction: 'thumbs_up', targetInputId: 'manual-1',
      }] } : {}),
      ...(kind === 'media' ? { responseMedia: [{
        kind: 'image', alt: 'Synthetic image', source: null, url: 'https://example.test/image.png',
      }] } : {}),
    },
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    expect(startTyping).not.toHaveBeenCalled()
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: 'synthetic-draft', codexContinuation: { kind: 'explicit-structured-history' },
    })
    providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
    draftReady.resolve()
    return result(draft)
  })
  if (selected !== null) {
    mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
      expect(startTyping).toHaveBeenCalledTimes(draftTypes ? 1 : 0)
      expect(stop).not.toHaveBeenCalled()
      if (draftTypes && selectedReplies) {
        expect(providerInput.progressDelivery).toBeDefined()
        await providerInput.progressDelivery?.send('Synthetic progress', { required: true, source: 'system' })
        expect(refreshAfterMessage).toHaveBeenCalledOnce()
      }
      return result(selected)
    })
    mocks.clearAssistantSessionCodexResumeState.mockImplementationOnce(async (input) => {
      // The replacement decision stops typing before resume cleanup or commit work.
      stopsAtResumeCleanup.push(stop.mock.calls.length)
      return input.session
    })
  }
  const dispatch = mocks.dispatchAssistantReply.getMockImplementation()!
  mocks.dispatchAssistantReply.mockImplementation(async (input) => {
    expect(startTyping).toHaveBeenCalledTimes(draftTypes ? 1 : 0)
    expect(stop).not.toHaveBeenCalled()
    return dispatch(input)
  })
  vi.useFakeTimers()
  const conversation = { channel, directness: 'group' as const, identityId: null, threadId: '12345' }
  const turn = sendAssistantMessageLocal({
    activeTurnInput: async () => ({ kind: 'no-new-input' }),
    conversation, channel, deliverResponse: true, prompt: 'Synthetic group input',
    turnTrigger: 'automation-auto-reply', vault: '/vaults/test',
    executionContext: { hosted: {
      memberId: 'synthetic-member', userEnvKeys: [],
      progressDeliveryDependencies: {
        sendLinq: vi.fn(), sendTelegram: vi.fn(),
      },
      channelTypingDependencies: { startLinqTyping: startTyping, startTelegramTyping: startTyping, onTypingAccepted },
    } },
  })
  await draftReady.promise
  await vi.advanceTimersByTimeAsync(0)
  expect(startTyping).toHaveBeenCalledTimes(draftTypes ? 1 : 0)
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  const joined = selected === null ? null : sendAssistantMessageLocal({
    conversation, expectedActiveTurnId: 'turn-1', prompt: 'Synthetic joined message', vault: '/vaults/test',
  })
  await vi.advanceTimersByTimeAsync(3_999)
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(stop).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await Promise.all([turn, joined])
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(selected === null ? 1 : 2)
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(selectedReplies ? 1 : 0)
  expect(stopsAtResumeCleanup).toEqual(selected === null ? [] : [draftTypes && !selectedReplies ? 1 : 0])
  expect(startTyping).toHaveBeenCalledTimes(draftTypes ? 1 : 0)
  expect(stop).toHaveBeenCalledTimes(draftTypes ? 1 : 0)
  if (draftTypes) {
    expect(stop).toHaveBeenCalledWith(selectedReplies ? { providerStop: false } : {})
    expect(onTypingAccepted).toHaveBeenCalled()
    if (selected !== null) {
      expect(onTypingAccepted).toHaveBeenCalledWith(expect.objectContaining({ acceptedInputIds: ['manual-1'] }))
    }
  } else {
    expect(onTypingAccepted).not.toHaveBeenCalled()
  }
})

test.each([{ channel: 'linq' }, { channel: 'telegram' }] as const)('scheduled $channel group replies never start typing', async ({ channel }) => {
  const plan = createSharedPlan()
  plan.conversationPolicy.audience.channel = channel
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({ plan })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const startTyping = vi.fn(async () => ({ stop: vi.fn() }))
  await sendAssistantMessageLocal({
    channel, deliverResponse: true, prompt: 'Synthetic scheduled input',
    turnTrigger: 'automation-auto-reply', scheduledOccurrenceAt: '2026-09-11T00:00:00.000Z',
    vault: '/vaults/test', executionContext: { hosted: {
      memberId: 'synthetic-member', userEnvKeys: [],
      channelTypingDependencies: { startLinqTyping: startTyping, startTelegramTyping: startTyping },
    } },
  })
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
  expect(startTyping).not.toHaveBeenCalled()
})

test.each(['setup failure', 'terminal no-reply'] as const)('direct %s before turn/start never types', async (outcome) => {
  const plan = createSharedPlan()
  plan.conversationPolicy.audience.threadIsDirect = true
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({ plan, session })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const startTyping = vi.fn(async () => ({ stop: vi.fn() }))
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: 'synthetic-setup', codexContinuation: { kind: 'explicit-structured-history' },
    })
    expect(startTyping).not.toHaveBeenCalled()
    if (outcome === 'setup failure') throw new Error('Synthetic pre-provider setup failure')
    return { kind: 'succeeded', providerTurn: {
      onboardingGuidanceInjected: false, codexContinuation: { kind: 'explicit-structured-history' },
      finalAction: { kind: 'none' }, response: '', responseDeliveryContextOrdinal: 0,
      transcriptResponse: null, session,
    } }
  })
  const turn = sendAssistantMessageLocal({
    channel: 'telegram', deliverResponse: true, prompt: 'Synthetic input', vault: '/vaults/test',
    executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [],
      channelTypingDependencies: { startTelegramTyping: startTyping },
    } },
  })
  if (outcome === 'setup failure') await expect(turn).rejects.toThrow('Synthetic pre-provider setup failure')
  else await turn
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
  expect(startTyping).not.toHaveBeenCalled()
})
