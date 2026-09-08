import { rm } from 'node:fs/promises'
import { writeAssistantStateVersionedJson } from '@murphai/runtime-state/node'
import { expect, test, vi } from 'vitest'
import {
  executeMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  assistantInputCandidateFromStoredEvent,
} from '../src/assistant/input-source.ts'
import {
  ASSISTANT_INPUT_EVENT_SCHEMA,
  ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
  resolveAssistantInputEventPath,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import {
  applyAssistantReplyDeliveryContext,
} from '../src/assistant/reply-delivery-context.ts'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
} from '../src/assistant/service-contracts.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import type {
  AssistantActiveTurnInputAdmissionHook,
} from '../src/assistant/turn-input.ts'
import { readAssistantAcceptedTurnInputJournal } from '../src/assistant/active-turn-input-journal.ts'
import { createTempVaultContext } from './test-helpers.ts'
import {
  createAssistantSession,
  createDeferred,
  createHostedMailboxSourceRef,
  createSharedPlan,
  loadLocalServiceModule,
  tempRoots,
} from './assistant-local-service-runtime.harness.ts'

test.each([
  { channel: 'telegram', direct: true },
  { channel: 'telegram', direct: false },
  { channel: 'linq', direct: true },
  { channel: 'linq', direct: false },
] as const)(
  'native reply prefix preserves $channel direct=$direct targeting after live admission',
  async (route) => {
    const result = await runLivePrefixScenario(route)
    expect(result.outcome).toMatchObject({ kind: 'completed' })
    expect(result.precedingInputs).toHaveLength(1)
    expect(result.mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
    const final = result.mocks.dispatchAssistantReply.mock.calls[0]?.[0]
    expect(final?.response).toBe('Final detail.')
    for (const deliveryInput of [result.precedingInputs[0], final?.input]) {
      expect(deliveryInput).toMatchObject({
        deliveryNativeReplyRequested: true,
        deliveryReplyToMessageId: '101',
      })
      expect(deliveryInput?.deliveryTarget).toBeUndefined()
    }
    expect(final?.session.binding).toEqual(result.session.binding)
    expect(final?.sharedPlan.conversationPolicy.audience)
      .toEqual(result.plan.conversationPolicy.audience)
    expect(result.mocks.deliverAssistantReaction).not.toHaveBeenCalled()
    expect(result.mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
  },
  20_000,
)

test('native reply prefix rebases held group reconsideration without resending the draft', async () => {
  const result = await runLivePrefixScenario({ held: true })
  expect(result.outcome).toMatchObject({ kind: 'completed' })
  expect(result.precedingInputs).toEqual([])
  expect(result.mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
  expect(result.mocks.dispatchAssistantReply.mock.calls[0]?.[0]).toMatchObject({
    input: { deliveryNativeReplyRequested: true, deliveryReplyToMessageId: '101' },
    response: 'Final detail.',
  })
  expect(result.mocks.executeCodexTurnWithRecovery.mock.calls.map(
    ([input]) => input.providerRequestOrdinal,
  )).toEqual([0, 1])
  expect(result.mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult)
    .toMatchObject({ responseDeliveryContextOrdinal: 1, precedingResponseSegments: [] })
}, 20_000)

test('native reply prefix validates targeted progress during group reconsideration', async () => {
  const result = await runLivePrefixScenario({ held: true, targetedProgress: true })
  expect(result.outcome).toMatchObject({ kind: 'completed' })
  expect(result.mocks.deliverAssistantProgressUpdate).toHaveBeenCalledOnce()
  expect(result.mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]).toMatchObject({
    input: { deliveryNativeReplyRequested: true, deliveryReplyToMessageId: '101' },
  })
  expect(result.precedingInputs).toEqual([])
  expect(result.mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
}, 20_000)

test.each(['deleted', 'revoked'] as const)(
  'native reply prefix rechecks a %s earlier target before preceding and final delivery',
  async (invalidation) => {
    const result = await runLivePrefixScenario({ invalidation })
    expect(result.outcome).toMatchObject({ kind: 'completed' })
    expect(result.precedingInputs).toEqual([])
    expect(result.mocks.dispatchAssistantReply).not.toHaveBeenCalled()
    expect(result.mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0])
      .toMatchObject({ outcome: { kind: 'failed' } })
  },
  20_000,
)

test('native reply prefix rejects a final reply aimed at a later ordinal', async () => {
  const result = await runLivePrefixScenario({ futureFinal: true })
  expect(result.precedingInputs).toHaveLength(1)
  expect(result.mocks.dispatchAssistantReply).not.toHaveBeenCalled()
}, 20_000)

test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 99])(
  'native reply prefix rejects final ordinal %s after group rebasing',
  async (responseOrdinal) => {
    const result = await runLivePrefixScenario({ held: true, responseOrdinal })
    expect(result.outcome).toMatchObject({
      kind: 'failed',
      error: { code: 'ASSISTANT_DELIVERY_CONTEXT_ORDINAL_INVALID' },
    })
    expect(result.precedingInputs).toEqual([])
    expect(result.mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  },
  20_000,
)

async function runLivePrefixScenario(options: {
  channel?: 'linq' | 'telegram'
  direct?: boolean
  futureFinal?: boolean
  held?: boolean
  invalidation?: 'deleted' | 'revoked'
  responseOrdinal?: number
  targetedProgress?: boolean
}) {
  const channel = options.channel ?? 'telegram'
  const direct = options.direct ?? false
  const context = await createTempVaultContext('assistant-native-reply-prefix-')
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({
    binding: {
      actorId: direct ? 'actor-1' : null,
      channel,
      conversationKey: 'synthetic-prefix-conversation',
      delivery: { kind: 'thread', target: 'thread-1' },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: direct,
    },
  })
  const plan = createSharedPlan()
  Object.assign(plan.conversationPolicy.audience, {
    actorId: session.binding.actorId,
    channel,
    effectiveThreadIsDirect: direct,
    explicitTarget: null,
    threadIsDirect: direct,
  })
  const events = await Promise.all([1, 2, 3].map((ordinal) =>
    upsertAssistantInputEvent({
      vault: context.vaultRoot,
      event: {
        content: { attachmentDescriptors: [], text: `Synthetic request ${ordinal}.` },
        conversation: {
          accountId: 'identity-1',
          actorId: direct ? 'actor-1' : `actor-${ordinal}`,
          actorIsSelf: false,
          source: channel,
          threadId: 'thread-1',
          threadIsDirect: direct,
        },
        occurredAt: `2026-09-01T10:00:0${ordinal}.000Z`,
        receivedAt: `2026-09-01T10:00:0${ordinal}.000Z`,
        replyTarget: { channel, messageId: String(100 + ordinal), threadId: 'thread-1' },
        sourceMetadata: channel === 'linq'
          ? {
              externalThreadRouteAuthorityPresent: true,
              kind: 'linq',
              partCount: 1,
              reactionEligible: true,
              replyToMessageId: null,
              service: 'iMessage',
            }
          : {
              externalThreadRouteAuthorityPresent: true,
              kind: 'telegram',
              mediaGroupId: null,
              replyContext: null,
            },
        sourceRef: createHostedMailboxSourceRef({
          eventId: `evt_native_prefix_${ordinal}`,
          laneSeq: String(ordinal),
        }),
      },
    }),
  ))
  const [earlier, later, unadmitted] = events
  if (!earlier || !later || !unadmitted) throw new Error('Missing synthetic inputs.')
  const earlierText = earlier.content.text
  const laterText = later.content.text
  if (!earlierText || !laterText) throw new Error('Missing synthetic text.')
  const providerStarted = createDeferred<void>()
  const steerAcknowledged = createDeferred<void>()
  const executeTools = createDeferred<void>()
  const checkpointStarted = createDeferred<void>()
  const checkpointRelease = createDeferred<void>()
  let toolSelectionCompleted = false
  const activeTurnInput: AssistantActiveTurnInputAdmissionHook = async (input) => {
    if (!input.availableInputIds?.includes(later.inputId) ||
        input.knownInputIds?.includes(later.inputId)) return { kind: 'no-new-input' }
    return {
      acceptedInputs: [{
        ...assistantInputCandidateFromStoredEvent(later).acceptedInput,
        promptFallbackReason: 'missing-content-ref',
        promptFallbackText: laterText,
      }],
      kind: 'accepted',
      prompt: laterText,
      transcriptText: laterText,
    }
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: { setMessageReaction: vi.fn() },
    plan,
    realAcceptedInputPersistence: true,
    realMessageTargetSelection: true,
    session,
  })
  const { notifyAssistantActiveTurnInputAvailable } = await import(
    '../src/assistant/active-turn-input-controller.ts'
  )
  // Exercise the local owner's real pre-dispatch resolver; transport stays stubbed.
  const precedingInputs: AssistantMessageInput[] = []
  mocks.deliverAssistantPrecedingReplies.mockImplementation(async (input) => {
    const outcomes: AssistantDeliveryOutcome[] = []
    for (const segment of input.segments ?? []) {
      try {
        if (!input.resolveSegmentDeliveryInput) throw new Error('Missing recheck.')
        const resolved = await input.resolveSegmentDeliveryInput({
          input: applyAssistantReplyDeliveryContext({
            context: segment.deliveryContext ?? null,
            input: input.input,
          }),
          segment,
          session: input.session,
        })
        precedingInputs.push(resolved)
        expect(segment.response).toBe('Earlier detail.\n---\nAnother detail.')
        outcomes.push({ kind: 'queued', error: null, intentId: 'synthetic-preceding', media: [], session })
      } catch (error) {
        // The forged earlier-ordinal segment must fail, never silently go flat.
        expect(error).toMatchObject({ code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE' })
        outcomes.push({
          kind: 'failed', intentId: null, media: [], session,
          error: { code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE', message: 'Unavailable.' },
        })
      }
    }
    return outcomes
  })
  if (options.invalidation) {
    mocks.finalizeAssistantTurnArtifacts.mockImplementationOnce(async () => {
      const eventPath = resolveAssistantInputEventPath({
        inputId: earlier.inputId,
        paths: resolveAssistantStatePaths(context.vaultRoot),
      })
      if (options.invalidation === 'deleted') await rm(eventPath)
      else await writeAssistantStateVersionedJson({
        filePath: eventPath,
        schema: ASSISTANT_INPUT_EVENT_SCHEMA,
        schemaVersion: ASSISTANT_INPUT_EVENT_SCHEMA_VERSION,
        value: {
          ...earlier,
          sourceMetadata: { ...earlier.sourceMetadata, externalThreadRouteAuthorityPresent: false },
        },
      })
      return session
    })
  }
  mocks.executeCodexTurnWithRecovery.mockImplementation(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: { kind: 'explicit-structured-history' },
    })
    const ordinal = providerInput.providerRequestOrdinal === 1 ? 0 : 1
    const authorize = providerInput.authorizeAcceptedMessageTarget
    if (!authorize) throw new Error('Missing real target authorizer.')
    if (providerInput.providerRequestOrdinal === 0) {
      const release = providerInput.activeTurnSteering?.registerLiveProviderTurn({
        interrupt: async () => undefined,
        codexThreadId: 'thread-prefix-provider',
        providerTurnId: 'turn-prefix-provider',
        sessionId: session.sessionId,
        steer: async () => { steerAcknowledged.resolve() },
        turnId: 'turn-1',
      })
      providerStarted.resolve()
      await executeTools.promise
      expect(await authorize({ action: 'native-reply', deliveryContextOrdinal: 1,
        messageRef: later.inputId })).toBeNull()
      await providerInput.hostedToolContext?.beforeToolExecution?.(1)
      expect(await authorize({ action: 'native-reply', deliveryContextOrdinal: 0,
        messageRef: later.inputId })).toBeNull()
      release?.()
    }
    for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 99]) {
      expect(await authorize({ action: 'native-reply', deliveryContextOrdinal: invalid,
        messageRef: earlier.inputId })).toBeNull()
    }
    for (const messageRef of [unadmitted.inputId, 'ain_ffffffffffffffffffffffffffffffff']) {
      expect(await authorize({ action: 'native-reply', deliveryContextOrdinal: ordinal,
        messageRef })).toBeNull()
    }
    expect(await authorize({ action: 'reaction', deliveryContextOrdinal: ordinal,
      messageRef: earlier.inputId })).toBeNull()
    expect(await authorize({ action: 'reaction', deliveryContextOrdinal: ordinal,
      messageRef: later.inputId })).toEqual({ targetInputId: later.inputId })
    const selected = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorize,
      deliveryContextOrdinal: ordinal,
      env: {},
      fetchImpl: vi.fn(async () => { throw new Error('Unexpected network request.') }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: { kind: 'select-reply-target', messageRef: earlier.inputId },
    })
    expect(selected.rpcResult.success).toBe(true)
    expect(selected.replyTargetPatch).toEqual({ targetInputId: earlier.inputId })
    expect(JSON.stringify(selected)).not.toContain('"101"')
    if (options.targetedProgress && providerInput.providerRequestOrdinal === 1) {
      const progress = providerInput.progressDelivery
      if (!progress) throw new Error('Missing progress delivery.')
      for (const invalid of [-1, 0.5, 99]) {
        expect(await progress.send('Synthetic progress.', {
          deliveryContextOrdinal: invalid, required: true, targetInputId: earlier.inputId,
        })).toMatchObject({ kind: 'failed' })
      }
      expect(await progress.send('Synthetic progress.', {
        deliveryContextOrdinal: ordinal, required: true, targetInputId: earlier.inputId,
      })).toMatchObject({ kind: 'sent' })
    }
    toolSelectionCompleted = true
    providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'thread-prefix-provider',
        route: { routeId: 'route-prefix' },
        precedingResponseSegments: [
          { deliveryContextOrdinal: ordinal, response: 'Earlier detail.\n---\nAnother detail.',
            targetInputId: earlier.inputId },
          { deliveryContextOrdinal: 0, response: 'Must not reach later input.',
            targetInputId: later.inputId },
        ],
        response: options.held && providerInput.providerRequestOrdinal === 0
          ? 'Unsent draft.' : 'Final detail.',
        responseDeliveryContextOrdinal: options.futureFinal ? 0 : options.responseOrdinal ?? ordinal,
        session,
        targetInputId: options.futureFinal ? later.inputId : selected.replyTargetPatch?.targetInputId,
        transcriptResponse: 'Final detail.',
      },
    }
  })
  const unexpectedProviderSend = vi.fn(async () => {
    throw new Error('Unexpected provider transport call.')
  })
  const outcomePromise = sendAssistantMessageLocal({
    acceptedTurnInput: { initialInputs: [assistantInputCandidateFromStoredEvent(earlier).acceptedInput] },
    activeTurnInput,
    activeTurnCheckpoint: async () => {
      checkpointStarted.resolve()
      await checkpointRelease.promise
    },
    deliverResponse: true,
    executionContext: { hosted: {
      memberId: 'member-synthetic',
      progressDeliveryDependencies: {
        sendLinq: unexpectedProviderSend,
        sendTelegram: unexpectedProviderSend,
      },
      userEnvKeys: [],
    } },
    prompt: earlierText,
    ...(options.held ? { turnTrigger: 'automation-auto-reply' as const } : {}),
    vault: context.vaultRoot,
  }).then(
    (result) => ({ kind: 'completed' as const, result }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  await providerStarted.promise
  await notifyAssistantActiveTurnInputAvailable({
    conversation: { channel, identityId: 'identity-1', threadId: 'thread-1',
      ...(direct ? { participantId: 'actor-1' } : {}), directness: direct ? 'direct' : 'group' },
    inputIds: [later.inputId],
    vault: context.vaultRoot,
  })
  await steerAcknowledged.promise
  executeTools.resolve()
  await checkpointStarted.promise
  expect(toolSelectionCompleted).toBe(false)
  expect(await mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]
    .authorizeAcceptedMessageTarget?.({
      action: 'native-reply', deliveryContextOrdinal: 1, messageRef: later.inputId,
    })).toBeNull()
  checkpointRelease.resolve()
  const outcome = await outcomePromise
  if (outcome.kind === 'failed' && options.responseOrdinal === undefined) {
    throw outcome.error
  }
  expect(unexpectedProviderSend).not.toHaveBeenCalled()
  const journal = await readAssistantAcceptedTurnInputJournal(context.vaultRoot, 'turn-1')
  expect(journal?.inputIds).toEqual([earlier.inputId, later.inputId])
  return { mocks, outcome, plan, precedingInputs, session }
}
