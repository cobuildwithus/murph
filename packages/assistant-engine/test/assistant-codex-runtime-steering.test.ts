import {
  DAILY_NUTRITION_RESPONSE_CARD,
  MockChildProcess,
  OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
  TRACKED_COMPACT_TABLE_RESPONSE_CARD,
  asRecord,
  codexMocks,
  createDeferred,
  createHostedToolContext,
  createProgressDeliveryMock,
  createTempDir,
  executeCodexAppServerTurn,
  jsonLine,
  sentProgressResult,
  waitForRpcMethod,
  waitForRpcResponse,
  writeContextCompactionStarted,
} from "./assistant-codex-runtime.harness.ts";

import path from 'node:path'
import type {
  AssistantResponseCard,
  CompactTableWorkoutResponseCardV1,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CodexAppServerLiveTurn,
  CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import {
  extractCodexAppServerUserMessageImages,
} from '../src/assistant-codex/images.ts'
import {
  GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  createAssistantActiveTurnInputController,
  steerAssistantActiveTurnInput,
} from '../src/assistant/active-turn-input-controller.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'

describe('steered final segments', () => {
  type ScriptedSteeredFinalStep =
    | {
        kind: 'callback'
        run: () => Promise<void> | void
      }
    | {
        kind?: 'event'
        event: Record<string, unknown>
      }
    | {
        deferResponse?: boolean
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'attach-response-media'
        media: readonly unknown[]
      }
    | {
        card: AssistantResponseCard
        deferResponse?: boolean
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'attach-response-card'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'finish-without-reply'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'generate-image'
        prompt: string
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'generate-voice-memo'
        text: string
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'send-vault-file'
        ref: string
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'react-to-message'
        messageRef: string
        reaction: 'heart' | 'thumbs_up' | 'laugh'
      }
    | {
        expectedSuccess?: boolean
        expectedText: string
        id: number
        kind: 'select-reply-target'
        messageRef: string
      }
    | {
        expectedText: string
        id: number
        kind: 'list-memberships'
      }
    | {
        expectedText: string
        id: number
        kind: 'offer-access'
      }

  function isAttachResponseMediaStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'attach-response-media' }> {
    return 'kind' in step && step.kind === 'attach-response-media'
  }

  function isCallbackStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'callback' }> {
    return 'kind' in step && step.kind === 'callback'
  }

  function isAttachResponseCardStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'attach-response-card' }> {
    return 'kind' in step && step.kind === 'attach-response-card'
  }

  function isFinishWithoutReplyStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'finish-without-reply' }> {
    return 'kind' in step && step.kind === 'finish-without-reply'
  }

  function isListMembershipsStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'list-memberships' }> {
    return 'kind' in step && step.kind === 'list-memberships'
  }

  function isOfferAccessStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'offer-access' }> {
    return 'kind' in step && step.kind === 'offer-access'
  }

  function isSendVaultFileStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'send-vault-file' }> {
    return 'kind' in step && step.kind === 'send-vault-file'
  }

  function isGenerateVoiceMemoStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'generate-voice-memo' }> {
    return 'kind' in step && step.kind === 'generate-voice-memo'
  }

  function isGenerateImageStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'generate-image' }> {
    return 'kind' in step && step.kind === 'generate-image'
  }

  function isReactToMessageStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'react-to-message' }> {
    return 'kind' in step && step.kind === 'react-to-message'
  }

  function isSelectReplyTargetStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { kind: 'select-reply-target' }> {
    return 'kind' in step && step.kind === 'select-reply-target'
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function isScriptedEventStep(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): step is Extract<ScriptedSteeredFinalStep, { event: Record<string, unknown> }> {
    return 'event' in step && isRecord(step.event)
  }

  function normalizeScriptedSteeredFinalEvent(
    step: Record<string, unknown> | ScriptedSteeredFinalStep,
  ): Record<string, unknown> {
    return isScriptedEventStep(step) ? step.event : step
  }

  async function runScriptedSteeredFinalSegmentsTurn(
    steps: Array<Record<string, unknown> | ScriptedSteeredFinalStep>,
    input: {
      abortSignal?: CodexAppServerTurnInput['abortSignal']
      authorizeAcceptedMessageTarget?:
        CodexAppServerTurnInput['authorizeAcceptedMessageTarget']
      hostedToolContext?: CodexAppServerTurnInput['hostedToolContext']
      onFirstAssistantResponseCompleted?:
        CodexAppServerTurnInput['onFirstAssistantResponseCompleted']
      onProgress?: CodexAppServerTurnInput['onProgress']
      onTraceEvent?: CodexAppServerTurnInput['onTraceEvent']
      progressDelivery?: CodexAppServerTurnInput['progressDelivery']
      responseCardsAvailable?: boolean
      trustedContextReferences?: CodexAppServerTurnInput['trustedContextReferences']
      turnStatus?: 'completed' | 'failed'
      voiceMemoRuntime?: CodexAppServerTurnInput['voiceMemoRuntime']
    } = {},
  ) {
    const workingDirectory = await createTempDir('assistant-codex-steered-finals-work-')
    const codexHome = await createTempDir('assistant-codex-steered-finals-home-')

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const deferredToolResponses: Promise<unknown>[] = []
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              thread: {
                id: 'thread-steered-finals',
              },
            },
          }))

          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-steered-finals',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-steered-finals',
              },
            },
          }))

          for (const step of steps) {
            if (isCallbackStep(step)) {
              await step.run()
              continue
            }

            if (isAttachResponseCardStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'attach_response_card',
                  arguments: {
                    card: step.card,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              const responseAssertion = expect(
                waitForRpcResponse(child, step.id),
              ).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              if (step.deferResponse === true) {
                deferredToolResponses.push(responseAssertion)
              } else {
                await responseAssertion
              }
              continue
            }

            if (isAttachResponseMediaStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'attach_response_media',
                  arguments: {
                    media: step.media,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              const responseAssertion = expect(
                waitForRpcResponse(child, step.id),
              ).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              if (step.deferResponse === true) {
                deferredToolResponses.push(responseAssertion)
              } else {
                await responseAssertion
              }
              continue
            }

            if (isFinishWithoutReplyStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'finish_without_reply',
                  arguments: {},
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isSendVaultFileStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  arguments: { ref: step.ref },
                  callId: `call-steered-vault-${step.id}`,
                  namespace: 'murph',
                  tool: 'send_vault_file',
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  contentItems: [{
                    text: step.expectedText,
                    type: 'inputText',
                  }],
                  success: step.expectedSuccess ?? true,
                },
              })
              continue
            }

            if (isGenerateVoiceMemoStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  arguments: { text: step.text },
                  namespace: 'murph',
                  tool: 'generate_voice_memo',
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  contentItems: [{
                    text: step.expectedText,
                    type: 'inputText',
                  }],
                  success: step.expectedSuccess ?? true,
                },
              })
              continue
            }

            if (isGenerateImageStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  arguments: { prompt: step.prompt },
                  namespace: 'murph',
                  tool: 'generate_image',
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  contentItems: [{
                    text: step.expectedText,
                    type: 'inputText',
                  }],
                  success: step.expectedSuccess ?? true,
                },
              })
              continue
            }

            if (isListMembershipsStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'group_membership',
                  arguments: { action: 'list_memberships' },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isOfferAccessStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'group_data',
                  arguments: { action: 'offer_access' },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isReactToMessageStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'react_to_message',
                  arguments: {
                    message_ref: step.messageRef,
                    reaction: step.reaction,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            if (isSelectReplyTargetStep(step)) {
              child.stdout.write(jsonLine({
                id: step.id,
                method: 'item/tool/call',
                params: {
                  namespace: 'murph',
                  tool: 'select_reply_target',
                  arguments: {
                    message_ref: step.messageRef,
                  },
                  turnId: 'turn-steered-finals',
                },
              }))
              await expect(waitForRpcResponse(child, step.id)).resolves.toEqual({
                id: step.id,
                result: {
                  success: step.expectedSuccess ?? true,
                  contentItems: [
                    {
                      type: 'inputText',
                      text: step.expectedText,
                    },
                  ],
                },
              })
              continue
            }

            child.stdout.write(jsonLine(normalizeScriptedSteeredFinalEvent(step)))
          }

          await Promise.all(deferredToolResponses)

          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-steered-finals',
                status: input.turnStatus ?? 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    return await executeCodexAppServerTurn({
      approvalPolicy: 'never',
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      authorizeAcceptedMessageTarget:
        input.authorizeAcceptedMessageTarget ?? null,
      codexCommand: 'codex',
      codexHome,
      ...(input.responseCardsAvailable === true || input.voiceMemoRuntime != null ||
          input.hostedToolContext?.vaultFileSendAvailable === true
        ? {
            dynamicTools: resolveMurphDynamicTools({
              responseCardsAvailable: input.responseCardsAvailable === true,
              vaultFileSendAvailable:
                input.hostedToolContext?.vaultFileSendAvailable === true,
              voiceMemoGenerationAvailable: input.voiceMemoRuntime != null,
            }),
            ...(input.responseCardsAvailable === true
              ? { groupConversation: false }
              : {}),
          }
        : {}),
      hostedToolContext: input.hostedToolContext,
      onFirstAssistantResponseCompleted:
        input.onFirstAssistantResponseCompleted,
      onProgress: input.onProgress,
      onTraceEvent: input.onTraceEvent,
      progressDelivery: input.progressDelivery,
      trustedContextReferences: input.trustedContextReferences,
      voiceMemoRuntime: input.voiceMemoRuntime,
      prompt: 'First question',
      sandbox: 'workspace-write',
      workingDirectory,
    })
  }

  function completedItemEvent(item: Record<string, unknown>) {
    const { message, ...itemWithoutMessage } = item
    const canonicalItem =
      (item.type === 'assistant_message' || item.type === 'agentMessage') &&
      typeof message === 'string'
        ? {
            ...itemWithoutMessage,
            text: message,
            type: 'agentMessage',
          }
        : (item.type === 'user_message' || item.type === 'userMessage') &&
            typeof message === 'string'
          ? {
              ...itemWithoutMessage,
              content: [{ type: 'text', text: message }],
              type: 'userMessage',
            }
          : item
    return {
      method: 'item/completed',
      params: {
        item: canonicalItem,
      },
    }
  }

  function scriptedWorkoutStartResult(eventId: string) {
    return {
      activityType: 'strength-training',
      created: true,
      distanceKm: null,
      durationMinutes: 60,
      eventId,
      kind: 'activity_session',
      ledgerFile: '/vault/bank/ledger.md',
      lookupId: eventId,
      note: 'Current workout',
      occurredAt: '2026-08-24T14:00:00.000Z',
      title: 'Current workout',
      vault: '/vault',
      workout: null,
    }
  }

  function scriptedWorkoutShowResult(eventId: string) {
    return {
      entity: {
        data: {},
        id: eventId,
        kind: 'activity_session',
        links: [],
        markdown: null,
        occurredAt: '2026-08-24T14:00:00.000Z',
        path: '/vault/bank/ledger.md',
        title: 'Current workout',
      },
      vault: '/vault',
    }
  }

  function createFreshNativeAccessOfferGroupTool() {
    return {
      request: vi.fn(async () => ({
        action: 'post_join_offer' as const,
        result: {
          group: {
            displayName: null,
            id: 'group_test',
            kind: 'friends' as const,
            memberCount: 1,
            members: [],
            requestedVaultShareProjectionKinds: ['steps-days.v0' as const],
            requestedVaultShareProjectionScopes: [
              { projectionKind: 'steps-days.v0' as const },
            ],
            status: 'active' as const,
          },
          joinUrl: 'https://example.test/groups/join/fresh-offer',
          offeredAt: '2026-08-08T12:00:00.000Z',
          offerState: 'posted' as const,
          status: 'sent' as const,
        },
      })),
    }
  }

  const freshNativeAccessOfferToolText = JSON.stringify({
    action: 'offer_access',
    result: {
      offeredAt: '2026-08-08T12:00:00.000Z',
      recencyEvidence: 'eligible',
      responseHandling: GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING,
      presentation: 'native',
      status: 'ok',
    },
  })

  it('preserves remaining output after a fresh native access offer', async () => {
    const groupTool = createFreshNativeAccessOfferGroupTool()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: freshNativeAccessOfferToolText,
        id: 82,
        kind: 'offer-access',
      },
      completedItemEvent({
        id: 'assistant-remaining-answer',
        type: 'assistant_message',
        message: 'The weekly update is scheduled for Monday.',
      }),
    ], {
      hostedToolContext: createHostedToolContext({ groupTool }),
    })

    expect(groupTool.request).toHaveBeenCalledWith(
      {
        action: 'post_join_offer',
        joinOffer: {
          messageTemplate: expect.any(String),
        },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(result.finalAction).toBeNull()
    expect(result.finalMessage).toBe('The weekly update is scheduled for Monday.')
  })

  it('finishes without a companion reply when a fresh offer completes the request', async () => {
    const groupTool = createFreshNativeAccessOfferGroupTool()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: freshNativeAccessOfferToolText,
        id: 83,
        kind: 'offer-access',
      },
      {
        expectedText: 'finished without reply',
        id: 84,
        kind: 'finish-without-reply',
      },
      completedItemEvent({
        id: 'assistant-suppressed-offer-acknowledgment',
        type: 'assistant_message',
        message: 'The consent message is ready.',
      }),
    ], {
      hostedToolContext: createHostedToolContext({ groupTool }),
    })

    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalMessage).toBe('')
  })

  it('returns successful membership reads while preserving Codex continuity', async () => {
    const response = {
      action: 'list_memberships' as const,
      result: {
        disclosureGrants: [],
        memberships: [{
          displayName: 'Sunday runners sentinel',
          grantedVaultShareProjectionScopes: [
            { projectionKind: 'profile-name.v0' as const },
          ],
          kind: 'friends',
          memberCount: 4,
          membershipId: 'hgm_current_member',
          permissionsUrl: 'https://example.test/groups/join/sentinel',
          requestedVaultShareProjectionScopes: [
            { projectionKind: 'hrv-days.v0' as const },
          ],
          role: 'owner',
          sponsorshipUrl: 'https://example.test/groups/fund/funding_locator',
        }],
        status: 'ok' as const,
        truncated: false,
      },
    }
    const groupTool = {
      request: vi.fn(async (
        _request: unknown,
        _context?: { signal?: AbortSignal | null },
      ) => response),
    }
    const abortController = new AbortController()

    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: JSON.stringify(response),
        id: 83,
        kind: 'list-memberships',
      },
      completedItemEvent({
        id: 'assistant-memberships',
        type: 'assistant_message',
        message: 'You belong to Sunday runners.',
      }),
    ], {
      abortSignal: abortController.signal,
      hostedToolContext: createHostedToolContext({ groupTool }),
    })

    expect(groupTool.request).toHaveBeenCalledWith(
      { action: 'list_memberships' },
      { signal: expect.any(AbortSignal) },
    )
    const forwardedSignal = groupTool.request.mock.calls[0]?.[1]?.signal
    if (!forwardedSignal) {
      throw new Error('Expected current-turn abort signal at group-tool boundary.')
    }
    expect(forwardedSignal.aborted).toBe(false)
    abortController.abort(new DOMException('turn cancelled', 'AbortError'))
    expect(forwardedSignal.aborted).toBe(true)
    expect(result.finalMessage).toBe('You belong to Sunday runners.')
  })

  it('lets the latest steered context replace an earlier response card', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-card-1',
        type: 'user_message',
        message: 'First nutrition question',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 84,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-card-1',
        type: 'assistant_message',
        message: 'Model prose replaced by card text.',
      }),
      completedItemEvent({
        id: 'user-card-2',
        type: 'user_message',
        message: 'Send the refreshed nutrition card',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 85,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-card-2',
        type: 'assistant_message',
        message: 'Final follow-up answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toEqual(DAILY_NUTRITION_RESPONSE_CARD)
    expect(result.responseMedia).toEqual([])
    expect(result.finalMessage).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (under target) · 100g protein (on target) · 220g carbs (on target) · 40g fat (on target) · 30g fiber (under target).',
    )
    expect(result.providerAuthoredFinalMessage).toBe('Final follow-up answer.')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.precedingAgentMessageSegments).toEqual([{
      deliveryContextOrdinal: 0,
      media: [],
      response:
        'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (under target) · 100g protein (on target) · 220g carbs (on target) · 40g fat (on target) · 30g fiber (under target).',
    }])
  })

  it('keeps tracked-card authority out of a steered preceding delivery', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-tracked-card-1',
        type: 'user_message',
        message: 'Track this workout in a table',
      }),
      {
        card: TRACKED_COMPACT_TABLE_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 840,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'assistant-tracked-card-1',
        type: 'assistant_message',
        message: 'Model prose replaced by card text.',
      }),
      completedItemEvent({
        id: 'user-tracked-card-2',
        type: 'user_message',
        message: 'One more thought',
      }),
      completedItemEvent({
        id: 'assistant-tracked-card-2',
        type: 'assistant_message',
        message: 'Final follow-up answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.precedingAgentMessageSegments).toEqual([{
      deliveryContextOrdinal: 0,
      media: [],
      response: 'Strength session\n\nBench press: Set 1: 185 lb × 8',
      transcriptResponse:
        'Strength session\n\nBench press: Set 1: 185 lb × 8\n\n' +
        '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-04T21:30:00.000Z]',
    }])
  })

  it('keeps a response card when the model finishes without authored text', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 87,
        kind: 'attach-response-card',
      },
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toEqual(DAILY_NUTRITION_RESPONSE_CARD)
    expect(result.providerAuthoredFinalMessage).toBe('')
    expect(result.finalMessage).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (under target) · 100g protein (on target) · 220g carbs (on target) · 40g fat (on target) · 30g fiber (under target).',
    )
  })

  it('keeps tracked-card authority only in the final transcript message', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        card: TRACKED_COMPACT_TABLE_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 870,
        kind: 'attach-response-card',
      },
    ], { responseCardsAvailable: true })

    expect(result.finalMessage).toBe(
      'Strength session\n\nBench press: Set 1: 185 lb × 8',
    )
    expect(result.finalMessage).not.toContain('evt_')
    expect(result.transcriptMessage).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ;',
    )
  })

  it('attaches a validated live-workout start to the exact response delivery', async () => {
    const workoutId = 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ'
    const command = 'vault-cli workout start Current --format json'
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        method: 'item/started',
        params: {
          item: {
            command,
            id: 'workout-start',
            type: 'commandExecution',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          item: {
            aggregatedOutput: JSON.stringify(
              scriptedWorkoutStartResult(workoutId),
            ),
            command,
            exitCode: 0,
            id: 'workout-start',
            type: 'commandExecution',
          },
        },
      },
      completedItemEvent({
        id: 'assistant-workout-follow-up',
        type: 'assistant_message',
        message: 'How many reps did you get on set 2?',
      }),
    ])

    expect(result.responseCard).toBeNull()
    expect(result.finalMessage).toBe('How many reps did you get on set 2?')
    expect(result.responseContextReferences).toEqual([{
      entityId: workoutId,
      entityKind: 'activity_session',
    }])
  })

  it('keeps validated workout identity on its own steered response segment', async () => {
    const workoutId = 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ'
    const startCommand = 'vault-cli workout start Current --format json'
    const setCommand =
      `vault-cli workout set log --workout-id ${workoutId} --set-order 2`
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-workout-follow-up-1',
        type: 'user_message',
        message: 'Ask me about my next set.',
      }),
      {
        method: 'item/started',
        params: {
          item: {
            command: startCommand,
            id: 'steered-workout-start',
            type: 'commandExecution',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          item: {
            aggregatedOutput: JSON.stringify(
              scriptedWorkoutStartResult(workoutId),
            ),
            command: startCommand,
            exitCode: 0,
            id: 'steered-workout-start',
            type: 'commandExecution',
          },
        },
      },
      completedItemEvent({
        id: 'assistant-workout-follow-up-1',
        type: 'assistant_message',
        message: 'What did you get on the next set?',
      }),
      completedItemEvent({
        id: 'user-workout-follow-up-2',
        type: 'user_message',
        message: 'One more thought.',
      }),
      {
        method: 'item/started',
        params: {
          item: {
            command: setCommand,
            id: 'steered-workout-set',
            type: 'commandExecution',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          item: {
            aggregatedOutput: JSON.stringify(
              scriptedWorkoutShowResult(workoutId),
            ),
            command: setCommand,
            exitCode: 0,
            id: 'steered-workout-set',
            type: 'commandExecution',
          },
        },
      },
      completedItemEvent({
        id: 'assistant-workout-follow-up-2',
        type: 'assistant_message',
        message: 'Final follow-up answer.',
      }),
    ])

    expect(result.precedingAgentMessageSegments).toEqual([{
      contextReferences: [{
        entityId: workoutId,
        entityKind: 'activity_session',
      }],
      deliveryContextOrdinal: 0,
      media: [],
      response: 'What did you get on the next set?',
    }])
    expect(result.responseContextReferences).toEqual([{
      entityId: workoutId,
      entityKind: 'activity_session',
    }])
  })

  it('renders oversized card recovery for the latest steered context', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-oversized-card-1',
        type: 'user_message',
        message: 'Show my workout',
      }),
      completedItemEvent({
        id: 'assistant-oversized-card-1',
        type: 'assistant_message',
        message: 'I can show that workout.',
      }),
      completedItemEvent({
        id: 'user-oversized-card-2',
        type: 'user_message',
        message: 'Use the full tracked-workout card',
      }),
      {
        card: OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
        expectedText:
          'workout card envelope too large; full text recovery selected',
        id: 871,
        kind: 'attach-response-card',
      },
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.providerAuthoredFinalMessage).toBe('')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.finalMessage).not.toMatch(/delete|merge|shorten|simplify/iu)
    for (let exerciseIndex = 0; exerciseIndex < 16; exerciseIndex += 1) {
      expect(result.finalMessage).toContain(
        `Capacity exercise ${exerciseIndex + 1}:`,
      )
      for (let setIndex = 0; setIndex < 16; setIndex += 1) {
        expect(result.finalMessage).toContain(
          `set ${setIndex + 1}: pending; target Exercise ${exerciseIndex + 1} set ${setIndex + 1} target ${'x'.repeat(12)}`,
        )
      }
    }
    expect(result.finalMessage).not.toContain('evt_')
    expect(result.transcriptMessage).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ;',
    )
  })

  it('emits generated-audio timing from the Codex voice-memo tool boundary', async () => {
    const onTraceEvent = vi.fn()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: 'generated voice memo attached to the final response',
        id: 872,
        kind: 'generate-voice-memo',
        text: 'Read this aloud.',
      },
    ], {
      onTraceEvent,
      voiceMemoRuntime: {
        elevenLabs: {
          apiKeyAvailable: true,
          modelId: 'eleven_multilingual_v2',
          voiceId: 'voice_murph',
        },
        async generateAndUpload(request) {
          request.recordPhaseTiming?.({
            deliveryMode: 'synchronous',
            generationDurationMs: 21,
            mediaKind: 'voice_memo',
            outcome: 'succeeded',
            terminalPhase: 'upload',
            uploadDurationMs: 13,
          })
          return {
            attachmentId: 'attachment_timing_trace',
            filename: 'timing-trace.mp3',
            ok: true,
          }
        },
        kind: 'linq',
      },
    })

    const timingEvents = onTraceEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => asRecord(event.rawEvent).schema ===
        'murph.assistant-codex-generated-audio-phase-timing.v1')

    expect(timingEvents).toEqual([
      {
        codexThreadId: 'thread-steered-finals',
        rawEvent: {
          schema: 'murph.assistant-codex-generated-audio-phase-timing.v1',
          type: 'assistant.codex.generated_audio_phase_timing',
          generatedAudioDeliveryMode: 'synchronous',
          generatedAudioGenerationDurationMs: 21,
          generatedAudioKind: 'voice_memo',
          generatedAudioOutcome: 'succeeded',
          generatedAudioTerminalPhase: 'upload',
          generatedAudioUploadDurationMs: 13,
        },
        updates: [],
      },
    ])
    expect(result.responseMedia).toEqual([
      expect.objectContaining({
        filename: 'timing-trace.mp3',
        kind: 'voice_memo',
      }),
    ])
  })

  it('blocks response effects before work after workout card overflow owns presentation', async () => {
    const generateAndUpload = vi.fn(async () => ({
      attachmentId: 'attachment_should_not_exist',
      filename: 'voice-should-not-exist.mp3',
    }))
    const sendVaultFile = vi.fn(async () => ({
      filename: 'report.pdf',
      status: 'approved' as const,
    }))
    const launchImageGeneration = vi.fn(() => 'started' as const)
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        card: OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
        expectedText:
          'workout card envelope too large; full text recovery selected',
        id: 872,
        kind: 'attach-response-card',
      },
      {
        expectedSuccess: false,
        expectedText:
          'voice memo generation cannot be combined with a response card',
        id: 873,
        kind: 'generate-voice-memo',
        text: 'Read the workout aloud.',
      },
      {
        expectedSuccess: false,
        expectedText: 'image generation cannot be combined with a response card',
        id: 874,
        kind: 'generate-image',
        prompt: 'Render the workout.',
      },
      {
        expectedSuccess: false,
        expectedText: 'vault-file sending cannot be combined with a response card',
        id: 875,
        kind: 'send-vault-file',
        ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`,
      },
    ], {
      hostedToolContext: createHostedToolContext({
        computerToolsAvailable: false,
        imageGenerationLauncher: { launch: launchImageGeneration },
        sendVaultFile,
        vaultFileSendAvailable: true,
      }),
      responseCardsAvailable: true,
      voiceMemoRuntime: {
        elevenLabs: {
          apiKeyAvailable: true,
          modelId: 'eleven_multilingual_v2',
          voiceId: 'voice_murph',
        },
        generateAndUpload,
        kind: 'linq',
      },
    })

    expect(generateAndUpload).not.toHaveBeenCalled()
    expect(launchImageGeneration).not.toHaveBeenCalled()
    expect(sendVaultFile).not.toHaveBeenCalled()
    expect(result.finalAction).toBeNull()
    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.finalMessage).toContain('Capacity exercise 1:')
    expect(result.finalMessage).toContain('Capacity exercise 16:')
    expect(result.finalMessage).not.toContain('evt_')
    expect(result.transcriptMessage).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ;',
    )
  })

  it('invalidates a card-only response when a live steer adds accepted work', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-card-only-request',
        type: 'user_message',
        message: 'Send today\'s nutrition card',
      }),
      {
        card: DAILY_NUTRITION_RESPONSE_CARD,
        expectedText: 'response card attached',
        id: 86,
        kind: 'attach-response-card',
      },
      completedItemEvent({
        id: 'user-card-follow-up',
        type: 'user_message',
        message: 'Also explain how to reach my protein goal',
      }),
      completedItemEvent({
        id: 'assistant-card-follow-up',
        type: 'assistant_message',
        message: 'Complete combined nutrition answer.',
      }),
    ], { responseCardsAvailable: true })

    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.finalMessage).toBe('Complete combined nutrition answer.')
    expect(result.providerAuthoredFinalMessage).toBe(
      'Complete combined nutrition answer.',
    )
  })

  it.each([
    {
      card: DAILY_NUTRITION_RESPONSE_CARD,
      label: 'normal card',
    },
    {
      card: OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
      label: 'oversized card text recovery',
    },
  ] satisfies Array<{ card: AssistantResponseCard; label: string }>)(
    'rejects an in-flight response card after accepted input advances ($label)',
    async ({ card }) => {
      const executionStarted = createDeferred<void>()
      const releaseExecution = createDeferred<void>()
      const result = await runScriptedSteeredFinalSegmentsTurn([
        completedItemEvent({
          id: 'user-before-in-flight-card',
          type: 'user_message',
          message: 'Send the response card',
        }),
        {
          card,
          deferResponse: true,
          expectedSuccess: false,
          expectedText: 'response card unavailable for this final response',
          id: 861,
          kind: 'attach-response-card',
        },
        completedItemEvent({
          id: 'user-after-in-flight-card',
          type: 'user_message',
          message: 'Answer this newer request instead',
        }),
        {
          kind: 'callback',
          run: async () => {
            await executionStarted.promise
            await Promise.resolve()
            releaseExecution.resolve()
          },
        },
        completedItemEvent({
          id: 'assistant-after-in-flight-card',
          type: 'assistant_message',
          message: 'Latest-context answer.',
        }),
      ], {
        hostedToolContext: createHostedToolContext({
          beforeToolExecution: async (deliveryContextOrdinal) => {
            expect(deliveryContextOrdinal).toBe(0)
            executionStarted.resolve()
            await releaseExecution.promise
          },
        }),
        responseCardsAvailable: true,
      })

      expect(result.responseCard).toBeNull()
      expect(result.responseMedia).toEqual([])
      expect(result.responseDeliveryContextOrdinal).toBe(1)
      expect(result.finalMessage).toBe('Latest-context answer.')
      expect(result.providerAuthoredFinalMessage).toBe('Latest-context answer.')
    },
  )

  it('rejects in-flight response media after accepted input advances', async () => {
    const executionStarted = createDeferred<void>()
    const releaseExecution = createDeferred<void>()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-before-in-flight-media',
        type: 'user_message',
        message: 'Attach the image to this answer',
      }),
      {
        deferResponse: true,
        expectedSuccess: false,
        expectedText: 'response media unavailable for this final response',
        id: 862,
        kind: 'attach-response-media',
        media: [{
          alt: 'Old-context image',
          source: 'old-context',
          url: 'https://cdn.example.test/assistant/old-context.png',
        }],
      },
      completedItemEvent({
        id: 'user-after-in-flight-media',
        type: 'user_message',
        message: 'Answer this newer request without that image',
      }),
      {
        kind: 'callback',
        run: async () => {
          await executionStarted.promise
          await Promise.resolve()
          releaseExecution.resolve()
        },
      },
      completedItemEvent({
        id: 'assistant-after-in-flight-media',
        type: 'assistant_message',
        message: 'Latest-context answer without old media.',
      }),
    ], {
      hostedToolContext: createHostedToolContext({
        beforeToolExecution: async (deliveryContextOrdinal) => {
          expect(deliveryContextOrdinal).toBe(0)
          executionStarted.resolve()
          await releaseExecution.promise
        },
      }),
    })

    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.finalMessage).toBe('Latest-context answer without old media.')
    expect(result.providerAuthoredFinalMessage).toBe(
      'Latest-context answer without old media.',
    )
  })

  it('clears attached media when accepted input advances before a response completes', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-before-attached-media',
        type: 'user_message',
        message: 'Attach the image to this answer',
      }),
      {
        expectedText: '1 response image attached',
        id: 863,
        kind: 'attach-response-media',
        media: [{
          alt: 'Old-context image',
          source: 'old-context',
          url: 'https://cdn.example.test/assistant/old-context.png',
        }],
      },
      completedItemEvent({
        id: 'user-after-attached-media',
        type: 'user_message',
        message: 'Answer this newer request without that image',
      }),
      completedItemEvent({
        id: 'assistant-after-attached-media',
        type: 'assistant_message',
        message: 'Latest-context answer without old media.',
      }),
    ])

    expect(result.precedingAgentMessageSegments).toEqual([])
    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([])
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.finalMessage).toBe('Latest-context answer without old media.')
    expect(result.providerAuthoredFinalMessage).toBe(
      'Latest-context answer without old media.',
    )
  })

  it('keeps independent last-successful reply and reaction targets per steered segment', async () => {
    const firstReplyRef = `ain_${'1'.repeat(32)}`
    const firstReactionRef = `ain_${'2'.repeat(32)}`
    const rejectedRef = `ain_${'3'.repeat(32)}`
    const finalReplyRef = `ain_${'4'.repeat(32)}`
    const authorizeAcceptedMessageTarget = vi.fn(async (input: {
      action: 'native-reply' | 'participant-effect' | 'reaction'
      deliveryContextOrdinal: number
      messageRef: string
    }) => input.messageRef === rejectedRef
      ? null
      : { targetInputId: input.messageRef })

    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        expectedText: 'selection recorded',
        id: 90,
        kind: 'select-reply-target',
        messageRef: firstReactionRef,
      },
      {
        expectedText: 'selection recorded',
        id: 91,
        kind: 'select-reply-target',
        messageRef: firstReplyRef,
      },
      {
        expectedSuccess: false,
        expectedText: 'message target unavailable',
        id: 92,
        kind: 'select-reply-target',
        messageRef: rejectedRef,
      },
      {
        expectedText: 'reaction queued',
        id: 93,
        kind: 'react-to-message',
        messageRef: firstReactionRef,
        reaction: 'heart',
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      {
        expectedText: 'selection recorded',
        id: 94,
        kind: 'select-reply-target',
        messageRef: finalReplyRef,
      },
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ], { authorizeAcceptedMessageTarget })

    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        media: [],
        response: 'Answer one.',
        targetInputId: firstReplyRef,
      },
    ])
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.targetInputId).toBe(finalReplyRef)
    expect(result.reactions).toEqual([
      {
        deliveryContextOrdinal: 0,
        reaction: 'heart',
        targetInputId: firstReactionRef,
      },
    ])
  })

  it('clears only the reply selection when finish_without_reply wins', async () => {
    const replyRef = `ain_${'5'.repeat(32)}`
    const reactionRef = `ain_${'6'.repeat(32)}`
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: 'selection recorded',
        id: 95,
        kind: 'select-reply-target',
        messageRef: replyRef,
      },
      {
        expectedText: 'reaction queued',
        id: 96,
        kind: 'react-to-message',
        messageRef: reactionRef,
        reaction: 'thumbs_up',
      },
      {
        expectedText: 'finished without reply',
        id: 97,
        kind: 'finish-without-reply',
      },
      completedItemEvent({
        id: 'assistant-suppressed',
        type: 'assistant_message',
        message: 'Do not deliver this.',
      }),
    ], {
      authorizeAcceptedMessageTarget: async (input) => ({
        targetInputId: input.messageRef,
      }),
    })

    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalMessage).toBe('')
    expect(result.targetInputId).toBeNull()
    expect(result.reactions).toEqual([
      {
        deliveryContextOrdinal: 0,
        reaction: 'thumbs_up',
        targetInputId: reactionRef,
      },
    ])
  })

  it('returns no final text or outbound progress for a commentary-only turn', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-commentary-only',
        type: 'assistant_message',
        message: 'Internal status only.',
        phase: 'commentary',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('')
    expect(result.precedingAgentMessageSegments).toEqual([])
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.transcriptMessage).toBeNull()
  })

  it('keeps a pre-steer final when only commentary follows the steer', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const retainedMedia = {
      url: 'https://cdn.example.test/assistant/retained-final.png',
      alt: 'Retained final image',
      source: 'retained-final',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'attach-response-media',
        id: 81,
        expectedText: '1 response image attached',
        media: [retainedMedia],
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'One more thought',
      }),
      completedItemEvent({
        id: 'assistant-2-commentary',
        type: 'assistant_message',
        message: 'Considering that.',
        phase: 'commentary',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Answer one.')
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.responseMedia).toEqual([
      {
        ...retainedMedia,
        kind: 'image',
      },
    ])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it.each([
    {
      card: DAILY_NUTRITION_RESPONSE_CARD,
      expectedText: 'response card attached',
      label: 'response card',
    },
    {
      card: OVERSIZED_TRACKED_WORKOUT_RESPONSE_CARD,
      expectedText: 'workout card envelope too large; full text recovery selected',
      label: 'oversized card text recovery',
    },
  ])('retains trailing $label and its delivery context after commentary', async ({ card, expectedText }) => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-retained-card',
        type: 'user_message',
        message: 'Show the saved summary.',
      }),
      { card, expectedText, id: 82, kind: 'attach-response-card' },
      completedItemEvent({
        id: 'assistant-retained-card',
        type: 'assistant_message',
        message: 'Saved summary.',
      }),
      completedItemEvent({
        id: 'user-after-retained-card',
        type: 'user_message',
        message: 'One more detail.',
      }),
      completedItemEvent({
        id: 'assistant-after-retained-card',
        type: 'assistant_message',
        message: 'Considering the detail.',
        phase: 'commentary',
      }),
    ], { responseCardsAvailable: true })

    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.precedingAgentMessageSegments).toEqual([])
    expect(result.responseMedia).toEqual([])
    expect(result.providerAuthoredFinalMessage).toBe('Saved summary.')
    expect(result.finalMessage).not.toContain('Considering the detail.')
    if (card === DAILY_NUTRITION_RESPONSE_CARD) {
      expect(result.responseCard).toEqual(card)
      expect(result.finalMessage).toContain('1,490.25 calories')
    } else {
      expect(result.responseCard).toBeNull()
      expect(result.finalMessage).toContain('Capacity exercise 16:')
      expect(result.finalMessage).toContain('Exercise 16 set 16 target')
      expect(result.finalMessage).not.toContain('evt_')
      expect(result.transcriptMessage).toContain('[Murph tracked workout source:')
    }
  })

  it('keeps steered final answers while commentary remains internal', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks mate I appreciate all this',
      }),
      completedItemEvent({
        id: 'assistant-2-commentary',
        type: 'assistant_message',
        message: 'Reworking that now.',
        phase: 'commentary',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Answer two.')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('collects every pre-steer final answer in order across multiple steer boundaries', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
      completedItemEvent({
        id: 'user-3',
        type: 'user_message',
        message: 'Third question',
      }),
      completedItemEvent({
        id: 'assistant-3',
        type: 'assistant_message',
        message: 'Answer three.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer three.')
    expect(result.responseDeliveryContextOrdinal).toBe(2)
    expect(result.precedingAgentMessageSegments.map((segment) => ({
      deliveryContextOrdinal: segment.deliveryContextOrdinal,
      response: segment.response,
    }))).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
      },
      {
        deliveryContextOrdinal: 1,
        response: 'Answer two.',
      },
    ])
  })

  it('does not return a trailing-steer final answer as a preceding segment', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks mate I appreciate all this',
      }),
    ])

    expect(result.finalMessage).toBe('Answer one.')
    expect(result.responseDeliveryContextOrdinal).toBe(0)
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('promotes a trailing-steer answer when the current segment has fallback text', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Answer this differently',
      }),
      {
        method: 'item/agentMessage/delta',
        params: {
          delta: 'Answer two from fallback.',
          itemId: 'assistant-2',
          threadId: 'thread-steered-finals',
          turnId: 'turn-steered-finals',
        },
      },
    ])

    expect(result.finalMessage).toBe('Answer two from fallback.')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('keeps repeated same-text final answers when they are distinct steered segments', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Done.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Say it again',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Done.',
      }),
    ])

    expect(result.finalMessage).toBe('Done.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Done.',
        media: [],
      },
    ])
  })

  it('segments response media at the same boundary as pre-steer final text', async () => {
    const firstMedia = {
      url: 'https://cdn.example.test/assistant/first.png',
      alt: 'First segment image',
      source: 'first-segment',
    }
    const finalMedia = {
      url: 'https://cdn.example.test/assistant/final.png',
      alt: 'Final segment image',
      source: 'final-segment',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 41,
        expectedText: '1 response image attached',
        media: [firstMedia],
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one with image.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Now answer differently',
      }),
      {
        kind: 'attach-response-media',
        id: 42,
        expectedText: '1 response image attached',
        media: [finalMedia],
      },
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two with a different image.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two with a different image.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one with image.',
        media: [
          {
            ...firstMedia,
            kind: 'image',
          },
        ],
      },
    ])
    expect(result.responseMedia).toEqual([
      {
        ...finalMedia,
        kind: 'image',
      },
    ])
  })

  it('closes admission and preserves a media-only response before a steer boundary', async () => {
    const firstMedia = {
      url: 'https://cdn.example.test/assistant/media-only.png',
      alt: 'Media-only first response',
      source: 'media-only-first-response',
    }
    const callbackOrder: string[] = []
    const onFirstAssistantResponseCompleted = vi.fn(() => {
      callbackOrder.push('response-completed')
    })
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 43,
        expectedText: '1 response image attached',
        media: [firstMedia],
      },
      completedItemEvent({
        id: 'assistant-media-only',
        type: 'assistant_message',
        message: '   ',
      }),
      completedItemEvent({
        id: 'user-after-media',
        type: 'user_message',
        message: 'This must wait for the next ordinary turn',
      }),
      completedItemEvent({
        id: 'assistant-after-media',
        type: 'assistant_message',
        message: 'Later response.',
      }),
    ], {
      onFirstAssistantResponseCompleted,
      onTraceEvent(event) {
        if (
          JSON.stringify(event.rawEvent).includes('"id":"user-after-media"')
        ) {
          callbackOrder.push('later-user-item')
        }
      },
    })

    expect(onFirstAssistantResponseCompleted).toHaveBeenCalledTimes(1)
    expect(callbackOrder).toEqual([
      'response-completed',
      'later-user-item',
    ])
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: '',
        media: [
          {
            ...firstMedia,
            kind: 'image',
          },
        ],
      },
    ])
    expect(result.finalMessage).toBe('Later response.')
    expect(result.responseMedia).toEqual([])
  })

  it('preserves provider acknowledgement when a steer response and first completion share one stdout batch', async () => {
    const workingDirectory = await createTempDir(
      'assistant-codex-batched-steer-ack-work-',
    )
    const liveTurnReady = createDeferred<void>()
    const controller = createAssistantActiveTurnInputController({
      conversationKeys: [
        'channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1',
      ],
      sessionId: 'session-batched-steer',
      turnId: 'turn-batched-owner',
      vault: '/vaults/test',
    })

    codexMocks.spawn.mockImplementation(() => {
      const child = new MockChildProcess()

      queueMicrotask(() => {
        void (async () => {
          const initialize = await waitForRpcMethod(child, 'initialize')
          child.stdout.write(jsonLine({ id: initialize.id, result: {} }))
          const threadStart = await waitForRpcMethod(child, 'thread/start')
          child.stdout.write(jsonLine({
            id: threadStart.id,
            result: {
              thread: {
                id: 'thread-batched-steer',
              },
            },
          }))
          const turnStart = await waitForRpcMethod(child, 'turn/start')
          child.stdout.write(jsonLine({
            id: turnStart.id,
            result: {
              turn: {
                id: 'turn-batched-steer',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/started',
            params: {
              turn: {
                id: 'turn-batched-steer',
              },
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-initial-question',
                content: [{ type: 'text', text: 'Initial question' }],
                type: 'userMessage',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))

          await liveTurnReady.promise
          const steerRequest = await waitForRpcMethod(child, 'turn/steer')
          expect(asRecord(steerRequest.params).input).toEqual([
            {
              type: 'text',
              text: 'Clarification accepted by the provider',
            },
            expect.objectContaining({
              detail: 'high',
              type: 'localImage',
            }),
          ])
          child.stdout.write([
            jsonLine({ id: steerRequest.id, result: {} }),
            jsonLine({
              method: 'item/completed',
              params: {
                item: {
                  id: 'assistant-before-batched-steer',
                  text: 'First response.',
                  type: 'agentMessage',
                },
                threadId: 'thread-batched-steer',
                turnId: 'turn-batched-steer',
              },
            }),
          ].join(''))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'user-batched-steer',
                content: [{ type: 'text', text: 'Clarification accepted by the provider' }],
                type: 'userMessage',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: {
              item: {
                id: 'assistant-after-batched-steer',
                text: 'Revised response.',
                type: 'agentMessage',
              },
              threadId: 'thread-batched-steer',
              turnId: 'turn-batched-steer',
            },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: {
              turn: {
                id: 'turn-batched-steer',
                status: 'completed',
              },
            },
          }))
        })()
      })

      return child
    })

    try {
      const turn = executeCodexAppServerTurn({
        onFirstAssistantResponseCompleted: () => {
          controller.closeTurnAdmission()
        },
        onLiveTurn: (liveTurn) => {
          const releaseLiveTurn = controller.registerLiveProviderTurn({
            interrupt: () => liveTurn.interrupt(),
            codexThreadId: liveTurn.threadId,
            providerTurnId: liveTurn.turnId,
            sessionId: 'session-batched-steer',
            steer: (input) => liveTurn.steer({
              images: extractCodexAppServerUserMessageImages(
                input.userMessageContent,
              ),
              prompt: input.prompt,
            }),
            turnId: 'turn-batched-owner',
          })
          liveTurnReady.resolve()
          return releaseLiveTurn
        },
        prompt: 'Initial question',
        model: 'gpt-5.6-terra',
        modelProvider: 'openai',
        workingDirectory,
      })

      await liveTurnReady.promise
      const completion = steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-batched-owner',
        prompt: 'Clarification accepted by the provider',
        userMessageContent: [
          {
            detail: 'original',
            image: Buffer.from([0xff, 0xd8, 0xff]),
            mediaType: 'image/jpeg',
            type: 'image',
          },
        ],
        vault: '/vaults/test',
      })
      expect(completion).not.toBeNull()
      completion?.catch(() => undefined)

      await expect(turn).resolves.toMatchObject({
        finalMessage: 'Revised response.',
        precedingAgentMessageSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'First response.',
          },
        ],
        responseDeliveryContextOrdinal: 1,
      })
      await expect(controller.admitLiveSteered()).resolves.toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            id: 'manual-1',
          }),
        ],
        providerAlreadySteered: true,
      })
    } finally {
      controller.fail(new Error('batched steer acknowledgement test complete'))
      controller.close()
    }
  })

  it('keeps last-wins behavior for multiple finals without a steer boundary', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('detects steer boundaries on the camelCase v2 wire item types', async () => {
    // Production app-server notifications use camelCase ThreadItem tags
    // (userMessage/agentMessage); the snake_case variants in the other tests
    // normalize to the same identifiers.
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'userMessage',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'agentMessage',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'userMessage',
        message: 'Thanks mate I appreciate all this',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'agentMessage',
        message: 'Answer two.',
      }),
    ])

    expect(result.finalMessage).toBe('Answer two.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })

  it('ignores commentary messages and steers that arrive before any final answer', async () => {
    const progressDelivery = createProgressDeliveryMock()
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-commentary',
        type: 'assistant_message',
        message: 'Working on it.',
        phase: 'commentary',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question while tools run',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Consolidated answer.',
      }),
    ], { progressDelivery })

    expect(progressDelivery.send).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe('Consolidated answer.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('uses the latest answered user-message ordinal when an earlier steer had no final answer', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question before the first final',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Consolidated answer.',
      }),
      completedItemEvent({
        id: 'user-3',
        type: 'user_message',
        message: 'Third question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Final answer.',
      }),
    ])

    expect(result.finalMessage).toBe('Final answer.')
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 1,
        response: 'Consolidated answer.',
        media: [],
      },
    ])
  })

  it('scopes finish_without_reply to the selected steered message', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'finish-without-reply',
        id: 71,
        expectedText: 'finished without reply',
      },
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'This first answer should not be delivered.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Visible answer.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('Visible answer.')
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('rejects finish_without_reply after response media is attached', async () => {
    const media = {
      kind: 'image',
      url: 'https://cdn.example.test/assistant/no-reply.png',
      alt: 'No-reply media that should still be delivered',
      source: 'no-reply-media-test',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'attach-response-media',
        id: 76,
        media: [media],
        expectedText: '1 response image attached',
      },
      {
        kind: 'finish-without-reply',
        id: 77,
        expectedSuccess: false,
        expectedText: 'finish_without_reply unavailable after assistant output',
      },
      completedItemEvent({
        id: 'assistant-no-reply-media',
        type: 'assistant_message',
        message: 'This final text should be delivered.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalMessage).toBe('This final text should be delivered.')
    expect(result.responseMedia).toEqual([media])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('keeps a different generated-file request replyable while a prior send is active', async () => {
    const media = {
      alt: 'Explanation attachment',
      kind: 'image' as const,
      source: 'active-vault-send-explanation',
      url: 'https://cdn.example.test/assistant/active-vault-send.png',
    }
    const sendVaultFile = vi.fn(async () => {
      throw new VaultCliError(
        'ASSISTANT_VAULT_FILE_SEND_ALREADY_ACTIVE',
        'A prior generated file remains active.',
      )
    })
    const note =
      'A different generated vault-file send for this conversation remains active, so this file was not queued. Do not call finish_without_reply; explain that the earlier send must finish before retrying this file.'
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        expectedText: JSON.stringify({
          note,
          status: 'already_in_progress',
        }),
        id: 76,
        kind: 'send-vault-file',
        ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/file-b.pdf`,
      },
      {
        expectedText: '1 response image attached',
        id: 77,
        kind: 'attach-response-media',
        media: [media],
      },
      completedItemEvent({
        id: 'assistant-active-vault-send',
        message: 'The earlier file must finish before I can retry this one.',
        type: 'assistant_message',
      }),
    ], {
      hostedToolContext: createHostedToolContext({
        computerToolsAvailable: false,
        sendVaultFile,
        vaultFileSendAvailable: true,
      }),
    })

    expect(sendVaultFile).toHaveBeenCalledWith(
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/file-b.pdf`,
      'call-steered-vault-76',
    )
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
    expect(result.finalAction).toBeNull()
    expect(result.finalMessage).toBe(
      'The earlier file must finish before I can retry this one.',
    )
    expect(result.responseMedia).toEqual([media])
  })

  it('rejects response media after finish_without_reply selects no final response', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      {
        kind: 'finish-without-reply',
        id: 78,
        expectedText: 'finished without reply',
      },
      {
        kind: 'attach-response-media',
        id: 79,
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/assistant/no-reply-late.png',
            alt: 'Late no-reply media that should not be attached',
            source: 'no-reply-media-test',
          },
        ],
        expectedSuccess: false,
        expectedText: 'response media unavailable after finish_without_reply',
      },
      completedItemEvent({
        id: 'assistant-no-reply-late-media',
        type: 'assistant_message',
        message: 'This final text should not be delivered.',
      }),
    ])

    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalActionExplicit).toBe(true)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('')
    expect(result.responseMedia).toEqual([])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('allows response media for a later steered message after earlier finish_without_reply', async () => {
    const media = {
      kind: 'image',
      url: 'https://cdn.example.test/assistant/later-after-no-reply.png',
      alt: 'Later steered message media',
      source: 'later-no-reply-media-test',
    }
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      {
        kind: 'finish-without-reply',
        id: 80,
        expectedText: 'finished without reply',
      },
      completedItemEvent({
        id: 'assistant-earlier-no-reply',
        type: 'assistant_message',
        message: 'This first answer should not be delivered.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Second question',
      }),
      {
        kind: 'attach-response-media',
        id: 81,
        media: [media],
        expectedText: '1 response image attached',
      },
      completedItemEvent({
        id: 'assistant-later-media',
        type: 'assistant_message',
        message: 'Visible answer with media.',
      }),
    ])

    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([0])
    expect(result.finalMessage).toBe('Visible answer with media.')
    expect(result.responseMedia).toEqual([media])
    expect(result.precedingAgentMessageSegments).toEqual([])
  })

  it('accepts a later no-reply while preserving an earlier pending answer', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks, no need to answer this',
      }),
      {
        kind: 'finish-without-reply',
        id: 74,
        expectedText: 'finished without reply',
      },
    ])

    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([1])
    expect(result.finalMessage).toBe('')
    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalActionExplicit).toBe(true)
    expect(result.precedingAgentMessageSegments).toEqual([{
      deliveryContextOrdinal: 0,
      media: [],
      response: 'Answer one.',
    }])
  })

  it('accepts a later no-reply after preserving an earlier promoted answer', async () => {
    const result = await runScriptedSteeredFinalSegmentsTurn([
      completedItemEvent({
        id: 'user-1',
        type: 'user_message',
        message: 'First question',
      }),
      completedItemEvent({
        id: 'assistant-1',
        type: 'assistant_message',
        message: 'Answer one.',
      }),
      completedItemEvent({
        id: 'user-2',
        type: 'user_message',
        message: 'Thanks, no need to answer this',
      }),
      completedItemEvent({
        id: 'assistant-2',
        type: 'assistant_message',
        message: 'Answer two.',
      }),
      {
        kind: 'finish-without-reply',
        id: 75,
        expectedText: 'finished without reply',
      },
    ])

    expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([1])
    expect(result.finalMessage).toBe('')
    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalActionExplicit).toBe(true)
    expect(result.precedingAgentMessageSegments).toEqual([
      {
        deliveryContextOrdinal: 0,
        response: 'Answer one.',
        media: [],
      },
    ])
  })
})

it('rejects finish_without_reply after context compaction progress was sent', async () => {
  const workingDirectory = await createTempDir('assistant-codex-context-compact-no-reply-')
  const codexHome = await createTempDir('assistant-codex-context-compact-no-reply-home-')
  const progressDelivery = createProgressDeliveryMock(sentProgressResult('system'))

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()

    queueMicrotask(() => {
      void (async () => {
        const initialize = await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: initialize.id, result: {} }))

        const threadStart = await waitForRpcMethod(child, 'thread/start')
        child.stdout.write(jsonLine({
          id: threadStart.id,
          result: {
            thread: {
              id: 'thread-context-compact-no-reply',
            },
          },
        }))

        const turnStart = await waitForRpcMethod(child, 'turn/start')
        child.stdout.write(jsonLine({
          id: turnStart.id,
          result: {
            turn: {
              id: 'turn-context-compact-no-reply',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/started',
          params: {
            turn: {
              id: 'turn-context-compact-no-reply',
            },
          },
        }))

        writeContextCompactionStarted({
          child,
          itemId: 'context-compact-no-reply',
          threadId: 'thread-context-compact-no-reply',
        })
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (progressDelivery.send.mock.calls.length > 0) {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        child.stdout.write(jsonLine({
          id: 81,
          method: 'item/tool/call',
          params: {
            namespace: 'murph',
            tool: 'finish_without_reply',
            arguments: {},
            turnId: 'turn-context-compact-no-reply',
          },
        }))
        await expect(waitForRpcResponse(child, 81)).resolves.toEqual({
          id: 81,
          result: {
            success: false,
            contentItems: [
              {
                type: 'inputText',
                text: 'finish_without_reply unavailable after assistant output',
              },
            ],
          },
        })

        child.stdout.write(jsonLine({
          method: 'item/completed',
          params: {
            item: {
              id: 'assistant-context-compact-no-reply-final',
              type: 'agentMessage',
              text: 'Final answer after system progress.',
            },
          },
        }))
        child.stdout.write(jsonLine({
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-context-compact-no-reply',
              status: 'completed',
            },
          },
        }))
      })()
    })

    return child
  })

  const result = await executeCodexAppServerTurn({
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome,
    progressDelivery,
    prompt: 'question',
    sandbox: 'workspace-write',
    workingDirectory,
  })

  expect(progressDelivery.send).toHaveBeenCalledWith(expect.any(String), {
    deliveryContextOrdinal: 0,
    required: true,
    source: 'system',
  })
  expect(result.finalMessage).toBe('Final answer after system progress.')
  expect(result.finalAction).toBeNull()
  expect(result.acceptedNoReplyDeliveryContextOrdinals).toEqual([])
})
