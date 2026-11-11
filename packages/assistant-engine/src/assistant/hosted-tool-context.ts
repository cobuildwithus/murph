import type { GeneratedMediaFileRuntime } from '../assistant-codex/generated-media-file.js'
import type { GenerateImageToolArgs } from '../assistant-codex/generate-image-tool.js'
import type { GenerateSongToolArgs } from '../assistant-codex/generate-voice-memo-tool.js'
import { appendRecapUsage, replaceRecapNarrative, type RecapUsage } from './game-recap-lore.js'
import { materializeRecapWorkspace } from './recap-workspace.js'
import type { ConversationPollTool } from "@murphai/hosted-execution/conversation-polls";
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'
import type {
  HostedRuntimeGroupEmailEffectResponse,
  HostedRuntimeGroupEmailScheduledAuthority,
  HostedRuntimeScheduledAutomationAuthority,
} from '@murphai/hosted-execution/runtime-control'
import type {
  HostedExecutionAssistantAskOrigin,
} from '@murphai/hosted-execution/contracts'
import type {
  HostedPhoneCallResultNotificationChannel,
} from '@murphai/hosted-execution/phone-calls'
import type {
  AssistantSession,
  AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import type { CodexThreadIdentity } from './codex-thread-route.js'
import type { AssistantProviderUsageDraft } from './providers/types.js'
import { recordAssistantUsageEvent } from './service-usage.js'
import type {
  AssistantDeviceActivityOccurrence,
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'
import type {
  AssistantHostedActionApprovalPort,
  AssistantHostedAutomationTool,
  AssistantHostedExecutionContext,
  AssistantHostedFamilyPlanTool,
  AssistantHostedAssistantConfigurationTool,
  AssistantHostedClinicalRecordsConnectLinkTool,
  AssistantHostedGroupPermissionOfferTool,
  AssistantHostedGroupSharedReader,
  AssistantHostedGroupTool,
  AssistantHostedIMessageContactTool,
  AssistantHostedImageGenerationLauncher,
  AssistantGeneratedImageCapturePersistence,
  AssistantHostedLabsTool,
  AssistantHostedGroupEmailEffect,
  AssistantHostedPersonalizationTool,
  AssistantHostedPlanUsageTool,
  AssistantHostedUsageDiagnostics,
  AssistantPhysicalNotePort,
  AssistantHostedPrivateImageUrlPublisher,
  AssistantHostedSubscriptionTool,
  AssistantHostedDeviceTool,
  AssistantPhoneCallPort,
} from './execution-context.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'
import { createAssistantGroupEmailOutboxTool } from './group-email-outbox.js'
import type { AssistantConversationScope } from './conversation-policy.js'
import type { AnalyzeVideoAttachmentAuthority, ConversationAttachmentAuthority } from '../assistant-codex/analyze-video-tool.js'

export interface AssistantHostedDeliveryContext {
  conversationId: string | null
  recipientKey: string | null
  returnContactKind: HostedReturnContactKind | null
}

export interface AssistantHostedToolRequestKeyScope {
  acceptedInputIds: readonly string[]
  conversationId: string | null
  inboundMailboxItemIds: readonly string[]
  recipientKey: string | null
}

export interface AssistantHostedUserActionScope
  extends AssistantHostedToolRequestKeyScope {
  conversationScope: AssistantConversationScope
  resultNotificationChannel?: HostedPhoneCallResultNotificationChannel | null
  originSessionId: string
}

export interface AssistantHostedScheduledPhoneCallScope
  extends HostedRuntimeScheduledAutomationAuthority {
  /** Present for a private device-activity run: the wearable event key. */
  occurrenceKey?: string
  resultNotificationChannel?: HostedPhoneCallResultNotificationChannel
  originSessionId: string
}

interface AssistantHostedInvocationScopeBase {
  conversationScope: AssistantConversationScope | null
  originSessionId?: string
}

export interface AssistantHostedAcceptedInputInvocationScope
  extends AssistantHostedInvocationScopeBase {
  origin: Extract<
    HostedExecutionAssistantAskOrigin,
    { kind: 'accepted_input' }
  >
}

export interface AssistantHostedScheduledInvocationScope
  extends AssistantHostedInvocationScopeBase {
  origin: Extract<
    HostedExecutionAssistantAskOrigin,
    { kind: 'automation_occurrence' }
  >
}

export type AssistantHostedInvocationScope =
  | AssistantHostedAcceptedInputInvocationScope
  | AssistantHostedScheduledInvocationScope

export interface AssistantHostedImageCompletionEffectScope {
  authorizedOriginAssistantInputId: string | null
  completionAssistantInputId: string
  exactMedia: readonly [AssistantVaultImageResponseMedia] | null
}

export type AssistantHostedVaultFileSendResult =
  | {
      approvalUrl: string
      filename: string
      status: 'pending'
    }
  | {
      filename: string
      status: 'approved'
    }
  | {
      filename: string
      status: 'denied' | 'expired'
    }

export interface AssistantHostedToolContext {
  readonly actionApprovalPort?: AssistantHostedActionApprovalPort | null
  readonly automationTool?: AssistantHostedAutomationTool | null
  readonly assistantConfigurationTool?: AssistantHostedAssistantConfigurationTool | null
  readonly connectedApps?: AssistantConnectedAppsPort | null
  readonly clinicalRecordsConnectLinkTool?: AssistantHostedClinicalRecordsConnectLinkTool | null
  readonly familyPlanTool?: AssistantHostedFamilyPlanTool | null
  readonly deviceTool?: AssistantHostedDeviceTool | null
  readonly groupPermissionOfferTool?: AssistantHostedGroupPermissionOfferTool | null
  readonly groupSharedReader?: AssistantHostedGroupSharedReader | null
  readonly groupTool?: AssistantHostedGroupTool | null
  readonly myGameRemindersTool?: AssistantHostedGroupTool | null
  readonly pollTool?: ConversationPollTool | null
  readonly imessageContactTool?: AssistantHostedIMessageContactTool | null
  readonly labsTool?: AssistantHostedLabsTool | null
  readonly imageGenerationLauncher?: AssistantHostedImageGenerationLauncher | null
  readonly persistGeneratedImageCapture?: AssistantGeneratedImageCapturePersistence | null
  readonly groupEmailEffect?: AssistantHostedGroupEmailEffect | null
  readonly personalizationTool?: AssistantHostedPersonalizationTool | null
  readonly planUsageTool?: AssistantHostedPlanUsageTool | null
  readonly usageDiagnostics?: AssistantHostedUsageDiagnostics | null
  readonly physicalNotes?: AssistantPhysicalNotePort | null
  readonly privateImageUrlPublisher?: AssistantHostedPrivateImageUrlPublisher | null
  readonly subscriptionTool?: AssistantHostedSubscriptionTool | null
  readonly phoneCalls?: AssistantPhoneCallPort | null
  beforeToolExecution?(deliveryContextOrdinal: number): Promise<void>
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentAssistantTarget?(): {
    model: string | null
    reasoningEffort: string | null
  }
  currentHostedMailboxItemIds(): readonly string[]
  currentConversationAttachmentAuthorities?(): readonly ConversationAttachmentAuthority[]
  currentAnalyzeVideoAttachmentAuthorities?(): readonly AnalyzeVideoAttachmentAuthority[]
  currentHostedImageCompletionEffectScope?():
    AssistantHostedImageCompletionEffectScope | null
  verifyGeneratedImageDelivery?(input: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    imageRef: string
    sha256: string
    sizeBytes: number
  }): Promise<boolean>
  claimSubscriptionAssistantInputId?(): string | null
  claimIMessageContactAssistantInputId?(): string | null
  currentScheduledAutomationAuthority?(): HostedRuntimeGroupEmailScheduledAuthority | null
  currentInvocationScope?(): AssistantHostedInvocationScope | null
  /** The turn's authenticated audience, whatever woke the turn. */
  currentConversationScope?(): AssistantConversationScope
  currentConversationPollRoute?(): {
    channel: 'linq' | 'telegram'
    target: string
  } | null
  closeGroupEmailCapability?(): void
  recordGroupEmailSendResult?(
    result: Extract<
      HostedRuntimeGroupEmailEffectResponse,
      { action: 'send_email' }
    >,
  ): void
  recordDetachedUsage?(input: {
    effectiveEnv: Readonly<Record<string, string | undefined>>
    operationId: string
    originAssistantInputId: string
    usageDraft: AssistantProviderUsageDraft
  }): void
  currentScheduledPhoneCallScope?(): AssistantHostedScheduledPhoneCallScope | null
  /** The wearable event behind a private device-activity run, if any. */
  currentDeviceActivityOccurrence?(): AssistantDeviceActivityOccurrence | null
  currentUserActionScope?(): AssistantHostedUserActionScope | null
  currentGameRecapScope?(): NonNullable<AssistantHostedExecutionContext['gameRecapScope']> | null
  prepareRecapMedia?(request: { kind: 'image'; args: GenerateImageToolArgs } | { kind: 'song'; args: GenerateSongToolArgs }): Promise<GeneratedMediaFileRuntime>
  prepareGameRecapInputs?(material: unknown): Promise<unknown>
  readGameRecapWorkspace?(): Awaited<ReturnType<typeof materializeRecapWorkspace>> | null
  currentGameMissedCheckInScope?(): NonNullable<AssistantHostedExecutionContext['gameMissedCheckInScope']> | null
  prepareGameLore?(): Promise<string | null>
  readGameLore?(): Promise<string>
  replaceGameLore?(content: string): Promise<void>
  appendGameRecapChatLine?(chatLine: string): Promise<void>
  appendGameRecapUsage?(usage: RecapUsage): Promise<void>
  recordSavedGameRecapChatLine?(chatLine: string): void
  currentProductFeedbackAcceptedInputIds?(): readonly string[]
  readonly computerToolsAvailable: boolean
  readonly pendingVaultFilesAvailable?: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(
    ref: string,
    toolCallId?: string | null,
    retireExportPackIds?: readonly string[],
  ): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  computerToolsAvailable?: boolean
  executionContext?: AssistantHostedExecutionContext | null
  beforeToolExecution?: (deliveryContextOrdinal: number) => Promise<void>
  getConversationScope?: () => AssistantConversationScope
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getConversationAttachmentAuthorities?: () => readonly ConversationAttachmentAuthority[]
  getAnalyzeVideoAttachmentAuthorities?: () => readonly AnalyzeVideoAttachmentAuthority[]
  getUserActionAcceptedInputIds?: () => readonly string[]
  getProductFeedbackAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  groupEmailOutbox?: {
    turnId: string
    vault: string
  } | null
  pendingVaultFilesAvailable?: boolean
  route?: CodexThreadIdentity | null
  recordGroupEmailSendResult?: (
    result: Extract<
      HostedRuntimeGroupEmailEffectResponse,
      { action: 'send_email' }
    >,
  ) => void
  recordGroupEmailPendingDeliveryIntentId?: (intentId: string) => void
  recordSavedGameRecapChatLine?: (chatLine: string) => void
  verifyGeneratedImageDelivery?: (input: {
    contentType: AssistantVaultImageResponseMedia['contentType']
    imageRef: string
    sha256: string
    sizeBytes: number
  }) => Promise<boolean>
  sendVaultFile?: (
    ref: string,
    toolCallId?: string | null,
    retireExportPackIds?: readonly string[],
  ) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const executionContext = input.executionContext ?? null
  let recapWorkspace: Awaited<ReturnType<typeof materializeRecapWorkspace>> | null = null
  let ordinaryGameLore: Promise<{ fingerprint: string; guidance: string } | null> | null = null
  const route = input.route ?? null
  const clinicalRecordsConnectLinkTool =
    executionContext?.clinicalRecordsConnectLinkTool ?? null
  const imageGenerationLauncher =
    executionContext?.imageGenerationLauncher ?? null
  const groupEmailHost = input.messageInput.scheduledAutomationAuthority
    ? executionContext?.groupTool ?? null
    : null
  const readDeliveryContext = () => input.getDeliveryContext?.() ?? {
    messageInput: input.messageInput,
    session: input.session,
  }
  const buildRequestKeyScope = (
    acceptedInputIds: readonly string[],
  ): AssistantHostedToolRequestKeyScope => {
    const deliveryContext = readDeliveryContext()
    const context = deliveryContext.messageInput.hostedDeliveryIdempotency
    return {
      acceptedInputIds: [...acceptedInputIds],
      conversationId: context?.conversationId ?? null,
      inboundMailboxItemIds: context?.inboundMailboxItemIds ?? [],
      recipientKey: context?.recipientKey ?? null,
    }
  }
  const groupEmailOutboxTool = groupEmailHost && input.groupEmailOutbox
    ? createAssistantGroupEmailOutboxTool({
        automationAuthority: input.messageInput.outboxAutomationAuthority ?? null,
        automationContextReferences:
          input.messageInput.outboxAutomationContextReferences ?? null,
        authority: input.messageInput.scheduledAutomationAuthority ?? null,
        groupTool: groupEmailHost,
        recordPendingDeliveryIntentId:
          input.recordGroupEmailPendingDeliveryIntentId,
        sessionId: input.session.sessionId,
        turnId: input.groupEmailOutbox.turnId,
        vault: input.groupEmailOutbox.vault,
      })
    : null
  const groupEmailEffect = groupEmailOutboxTool
  const readCurrentHostedImageCompletionEffectScope = ():
    AssistantHostedImageCompletionEffectScope | null => {
    const deliveryContext = readDeliveryContext()
    const restriction =
      deliveryContext.messageInput.hostedImageCompletionEffectRestriction ?? null
    // A newer accepted input lifts the restriction. This reads the list itself
    // because readCurrentUserActionScope depends on this reader.
    const latestAcceptedInputId = input.getUserActionAcceptedInputIds?.().at(-1)
    if (
      restriction === null ||
      (
        latestAcceptedInputId !== undefined &&
        latestAcceptedInputId !== restriction.completionAssistantInputId
      )
    ) {
      return null
    }
    return {
      authorizedOriginAssistantInputId:
        restriction.authorizedOriginAssistantInputId,
      completionAssistantInputId: restriction.completionAssistantInputId,
      exactMedia: restriction.exactMedia,
    }
  }
  const readCurrentUserActionScope = (): AssistantHostedUserActionScope | null => {
    if (readCurrentHostedImageCompletionEffectScope() !== null) {
      return null
    }
    const acceptedInputIds = input.getUserActionAcceptedInputIds?.() ?? []
    if (acceptedInputIds.length === 0) {
      return null
    }
    const deliveryContext = readDeliveryContext()
    const conversationScope =
      input.getConversationScope?.() ?? 'unverified-external'
    return {
      ...buildRequestKeyScope(acceptedInputIds),
      conversationScope,
      resultNotificationChannel:
        resolveAssistantHostedPhoneCallResultNotificationChannel({
          channel: deliveryContext.messageInput.channel,
          conversationScope,
        }),
      originSessionId: deliveryContext.session.sessionId,
    }
  }
  const readCurrentUserActionAssistantInputId = () =>
    readCurrentUserActionScope()?.acceptedInputIds.at(-1) ?? null
  const prepareGameLore = async (): Promise<{ fingerprint: string; guidance: string } | null> => {
    const explicit = executionContext?.gameRecapScope ?? executionContext?.gameMissedCheckInScope ?? null
    if (explicit) return { fingerprint: explicit.pairFingerprint, guidance: '' }
    if (ordinaryGameLore) return ordinaryGameLore
    ordinaryGameLore = (async () => {
      const scope = readCurrentUserActionScope()
      const assistantInputId = scope?.conversationScope === 'group'
        ? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]
        : null
      // Lore is optional: only Linq rooms host games, and a failed probe never blocks the turn.
      if (!assistantInputId || !executionContext?.groupTool || normalizeHostedDeliveryChannel(input.messageInput.channel) !== 'linq') return null
      try {
        const response = await executionContext.groupTool.request({ action: 'read_game', origin: { kind: 'accepted_input', assistantInputId } })
        const result = response.result
        return result.status === 'ok' && 'loreFingerprint' in result && typeof result.loreFingerprint === 'string'
          && 'loreGuidance' in result && typeof result.loreGuidance === 'string'
          ? { fingerprint: result.loreFingerprint, guidance: result.loreGuidance }
          : null
      } catch {
        return null
      }
    })()
    return ordinaryGameLore
  }
  const gameLorePath = async (): Promise<string> => {
    const scope = await prepareGameLore()
    if (!scope || !/^[a-f0-9]{32}$/u.test(scope.fingerprint)) throw new TypeError('Game lore authority is unavailable.')
    return path.join(input.messageInput.vault, 'games', `lore-${scope.fingerprint}.md`)
  }
  const readGameLore = async (): Promise<string> => {
    try {
      return (await readFile(await gameLorePath(), 'utf8')).slice(-64 * 1024)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
  const writeGameLore = async (content: string): Promise<void> => {
    if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new TypeError('Game lore is too large.')
    const target = await gameLorePath()
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
  }
  const readCurrentInvocationScope = (): AssistantHostedInvocationScope | null => {
    if (readCurrentHostedImageCompletionEffectScope() !== null) {
      return null
    }
    const userActionScope = readCurrentUserActionScope()
    const assistantInputId = userActionScope?.acceptedInputIds.at(-1) ?? null
    if (
      userActionScope &&
      assistantInputId &&
      userActionScope.conversationScope !== 'unverified-external'
    ) {
      const acceptedInputScope: AssistantHostedAcceptedInputInvocationScope = {
        conversationScope: userActionScope.conversationScope,
        origin: {
          assistantInputId,
          kind: 'accepted_input',
          sessionId: userActionScope.originSessionId,
        },
        originSessionId: userActionScope.originSessionId,
      }
      return acceptedInputScope
    }
    const deliveryContext = readDeliveryContext()
    return resolveAssistantHostedScheduledInvocationScope({
      conversationScope:
        input.getConversationScope?.() ?? 'unverified-external',
      messageInput: deliveryContext.messageInput,
      originSessionId: deliveryContext.session.sessionId,
    })
  }
  const readCurrentScheduledPhoneCallScope = () => {
    const deliveryContext = readDeliveryContext()
    return resolveAssistantHostedScheduledPhoneCallScope({
      channel: deliveryContext.messageInput.channel,
      conversationScope:
        input.getConversationScope?.() ?? 'unverified-external',
      messageInput: deliveryContext.messageInput,
      originSessionId: deliveryContext.session.sessionId,
    })
  }
  const readCurrentDeviceActivityOccurrence = () =>
    resolveAssistantHostedDeviceActivityOccurrence({
      conversationScope:
        input.getConversationScope?.() ?? 'unverified-external',
      messageInput: readDeliveryContext().messageInput,
    })
  const phoneCalls: AssistantPhoneCallPort | null =
    executionContext?.phoneCalls ?? null
  let subscriptionActionClaimed = false
  let imessageContactActionClaimed = false
  let clinicalRecordsConnectLinkRequest: ReturnType<
    AssistantHostedClinicalRecordsConnectLinkTool['createConnectLink']
  > | null = null

  return {
    actionApprovalPort: executionContext?.actionApprovalPort ?? null,
    automationTool: executionContext?.automationTool ?? null,
    assistantConfigurationTool:
      executionContext?.assistantConfigurationTool ?? null,
    connectedApps: executionContext?.connectedApps ?? null,
    clinicalRecordsConnectLinkTool: clinicalRecordsConnectLinkTool
      ? {
          createConnectLink: (options) => {
            if (clinicalRecordsConnectLinkRequest) {
              return clinicalRecordsConnectLinkRequest
            }
            const request = clinicalRecordsConnectLinkTool.createConnectLink(options)
            clinicalRecordsConnectLinkRequest = request
            void request.catch(() => {
              if (clinicalRecordsConnectLinkRequest === request) {
                clinicalRecordsConnectLinkRequest = null
              }
            })
            return request
          },
        }
      : null,
    familyPlanTool: executionContext?.familyPlanTool ?? null,
    deviceTool: executionContext?.deviceTool ?? null,
    groupPermissionOfferTool:
      executionContext?.groupPermissionOfferTool ?? null,
    groupSharedReader: executionContext?.groupSharedReader ?? null,
    groupTool: executionContext?.groupTool ?? null,
    myGameRemindersTool: readMyGameRemindersTool(executionContext),
    pollTool: readPollTool(executionContext),
    imessageContactTool: executionContext?.imessageContactTool ?? null,
    labsTool: executionContext?.labsTool ?? null,
    imageGenerationLauncher: imageGenerationLauncher
      ? bindAssistantHostedImageGenerationContinuation({
          launcher: imageGenerationLauncher,
          readContinuationSessionId: () =>
            readDeliveryContext().session.sessionId,
        })
      : null,
    persistGeneratedImageCapture:
      executionContext?.persistGeneratedImageCapture ?? null,
    groupEmailEffect,
    personalizationTool: executionContext?.personalizationTool ?? null,
    ...readUsageTools(executionContext),
    physicalNotes: executionContext?.physicalNotes ?? null,
    privateImageUrlPublisher:
      executionContext?.privateImageUrlPublisher ?? null,
    subscriptionTool: executionContext?.subscriptionTool ?? null,
    phoneCalls,
    ...(executionContext?.usageRecorder && route
      ? {
          recordDetachedUsage(usageInput) {
            const deliveryContext = readDeliveryContext()
            void recordAssistantUsageEvent({
              effectiveEnv: usageInput.effectiveEnv,
              executionContext: { hosted: executionContext },
              ...(usageInput.usageDraft.occurredAt === undefined
                ? {}
                : { occurredAt: usageInput.usageDraft.occurredAt }),
              providerRequestAcceptedInputIds: [
                usageInput.originAssistantInputId,
              ],
              providerRequestOrdinal:
                usageInput.usageDraft.providerRequestOrdinal,
              providerRequestOutcome:
                usageInput.usageDraft.providerRequestOutcome,
              providerResult: {
                provider: usageInput.usageDraft.provider,
                providerOptions: route.providerOptions,
                route,
                session: deliveryContext.session,
                usage: usageInput.usageDraft.usage,
              },
              turnId: usageInput.operationId,
            })
          },
        }
      : {}),
    ...(input.beforeToolExecution
      ? { beforeToolExecution: input.beforeToolExecution }
      : {}),
    computerToolsAvailable: input.computerToolsAvailable === true,
    claimSubscriptionAssistantInputId: () => {
      if (subscriptionActionClaimed) {
        return null
      }
      const assistantInputId = readCurrentUserActionAssistantInputId()
      if (assistantInputId === null) {
        return null
      }
      subscriptionActionClaimed = true
      return assistantInputId
    },
    claimIMessageContactAssistantInputId: () => {
      if (imessageContactActionClaimed) {
        return null
      }
      const assistantInputId = readCurrentUserActionAssistantInputId()
      if (assistantInputId === null) {
        return null
      }
      imessageContactActionClaimed = true
      return assistantInputId
    },
    currentAssistantTarget: () => {
      const session = readDeliveryContext().session
      return {
        model: session.providerOptions.model ?? null,
        reasoningEffort: session.providerOptions.reasoningEffort ?? null,
      }
    },
    currentHostedDeliveryContext: () => {
      const deliveryContext = readDeliveryContext()
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      const channel = normalizeHostedDeliveryChannel(
        deliveryContext.messageInput.channel,
      )
      const conversationId = scopeHostedDeliveryContextPart({
        channel,
        value: context?.conversationId ?? null,
      })
      const recipientKey = scopeHostedDeliveryContextPart({
        channel,
        value: context?.recipientKey ?? null,
      })
      if (!conversationId && !recipientKey) {
        return null
      }
      const returnContactKind = resolveAssistantHostedReturnContactKind(
        deliveryContext.messageInput.channel,
      )
      return { conversationId, recipientKey, returnContactKind }
    },
    currentHostedMailboxItemIds: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.hostedDeliveryIdempotency
        ?.inboundMailboxItemIds ?? []
    },
    currentConversationAttachmentAuthorities: () => {
      if (readCurrentUserActionScope() === null) return []
      return input.getConversationAttachmentAuthorities?.() ?? []
    },
    currentAnalyzeVideoAttachmentAuthorities: () => {
      const userActionScope = readCurrentUserActionScope()
      if (userActionScope === null) return []
      // The turn owner freezes current and retained same-conversation evidence
      // before provider execution. Historical clips need no new accepted input.
      return input.getConversationAttachmentAuthorities?.().filter((item) => item.kind === 'video')
        ?? input.getAnalyzeVideoAttachmentAuthorities?.() ?? []
    },
    currentHostedImageCompletionEffectScope:
      readCurrentHostedImageCompletionEffectScope,
    verifyGeneratedImageDelivery: input.verifyGeneratedImageDelivery,
    currentScheduledAutomationAuthority: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.scheduledAutomationAuthority ?? null
    },
    currentInvocationScope: readCurrentInvocationScope,
    currentConversationScope: () =>
      input.getConversationScope?.() ?? 'unverified-external',
    currentConversationPollRoute: () => {
      const { messageInput } = readDeliveryContext()
      const channel = messageInput.channel
      const target = messageInput.bindingDeliveryTarget ?? messageInput.deliveryTarget
      return (channel === 'linq' || channel === 'telegram') && target
        ? { channel, target }
        : null
    },
    closeGroupEmailCapability: groupEmailOutboxTool?.closeCapability,
    recordGroupEmailSendResult: input.recordGroupEmailSendResult,
    currentScheduledPhoneCallScope: readCurrentScheduledPhoneCallScope,
    currentDeviceActivityOccurrence: readCurrentDeviceActivityOccurrence,
    currentUserActionScope: readCurrentUserActionScope,
    currentGameRecapScope: () => executionContext?.gameRecapScope ?? null,
    readGameRecapWorkspace: () => recapWorkspace,
    prepareGameRecapInputs: async material => {
      const scope = executionContext?.gameRecapScope
      if (!scope?.show || !executionContext?.groupTool) throw new Error('Pair show scope is unavailable.')
      recapWorkspace = await materializeRecapWorkspace({ vault: input.messageInput.vault, gameId: scope.gameId,
        eventId: scope.eventId, sessionId: input.session.sessionId, material, lore: await readGameLore(), tool: executionContext.groupTool })
      return recapWorkspace.manifest
    },
    currentGameMissedCheckInScope: () => executionContext?.gameMissedCheckInScope ?? null,
    prepareGameLore: async () => (await prepareGameLore())?.guidance || null,
    readGameLore,
    replaceGameLore: async (content) => {
      if (executionContext?.gameRecapScope?.loreAccess === 'read') throw new TypeError('Game lore is read-only for this recap.')
      if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new TypeError('Game lore is too large.')
      await writeGameLore(replaceRecapNarrative(await readGameLore(), content))
    },
    appendGameRecapUsage: async usage => {
      if (!executionContext?.gameRecapScope?.show) return
      await writeGameLore(appendRecapUsage(await readGameLore(), usage))
    },
    appendGameRecapChatLine: async (chatLine) => {
      if (executionContext?.gameRecapScope?.loreAccess !== 'read') return
      const marker = `Chat line used: ${chatLine.replace(/\s+/gu, ' ').trim()}`
      const lines = (await readGameLore()).split(/\r?\n/u)
      if (lines.includes(marker)) return
      if (lines.at(-1) === '') lines.pop()
      lines.push(marker)
      let bytes = Buffer.byteLength(lines.join('\n') + '\n', 'utf8')
      let start = 0
      while (bytes > 64 * 1024 && start < lines.length - 1) {
        bytes -= Buffer.byteLength(lines[start++]!, 'utf8') + 1
      }
      await writeGameLore(lines.slice(start).join('\n') + '\n')
    },
    recordSavedGameRecapChatLine: input.recordSavedGameRecapChatLine,
    currentProductFeedbackAcceptedInputIds: () =>
      readCurrentHostedImageCompletionEffectScope() === null
        ? input.getProductFeedbackAcceptedInputIds?.() ?? []
        : [],
    pendingVaultFilesAvailable: input.pendingVaultFilesAvailable === true,
    sendVaultFile: input.sendVaultFile ?? (async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: typeof input.sendVaultFile === 'function',
  }
}

export function resolveAssistantHostedScheduledInvocationScope(input: {
  conversationScope: AssistantConversationScope
  messageInput: Pick<
    AssistantMessageInput,
    'scheduledInvocationAuthority' | 'scheduledOccurrenceAt' | 'turnTrigger'
  >
  originSessionId: string
}): AssistantHostedScheduledInvocationScope | null {
  const authority = input.messageInput.scheduledInvocationAuthority ?? null
  if (
    input.conversationScope === 'unverified-external'
    || input.messageInput.turnTrigger !== 'automation-cron'
    || authority === null
    || authority.occurrenceAt !== input.messageInput.scheduledOccurrenceAt
  ) {
    return null
  }

  return {
    conversationScope: input.conversationScope,
    origin: {
      automationId: authority.automationId,
      kind: 'automation_occurrence',
      occurrenceAt: authority.occurrenceAt,
    },
    originSessionId: input.originSessionId,
  }
}

export function createAssistantHostedScheduledRequestKey(input: {
  operation: 'clinical-records-connect-link'
  origin: AssistantHostedScheduledInvocationScope['origin']
}): `scheduled_${string}` {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      automationId: input.origin.automationId,
      occurrenceAt: input.origin.occurrenceAt,
      operation: input.operation,
      schema: 'murph.assistant-scheduled-request-key.v1',
    }))
    .digest('hex')
  return `scheduled_${digest}`
}

/** Keys a private device-activity run's effect on its wearable event, so a retry repeats nothing. */
export function createAssistantHostedDeviceActivityRequestKey(input: {
  occurrence: AssistantDeviceActivityOccurrence
  operation: 'clinical-records-connect-link'
}): `scheduled_${string}` {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      occurrenceKey: input.occurrence.occurrenceKey,
      operation: input.operation,
      parentAutomationId: input.occurrence.parentAutomationId,
      schema: 'murph.assistant-device-activity-request-key.v1',
    }))
    .digest('hex')
  return `scheduled_${digest}`
}

export function resolveAssistantHostedDeviceActivityOccurrence(input: {
  conversationScope: AssistantConversationScope
  messageInput: Pick<AssistantMessageInput, 'deviceActivityOccurrence' | 'turnTrigger'>
}): AssistantDeviceActivityOccurrence | null {
  const occurrence = input.messageInput.deviceActivityOccurrence ?? null
  return occurrence !== null
    && input.conversationScope === 'direct'
    && input.messageInput.turnTrigger === 'automation-cron'
    ? occurrence
    : null
}

// The host, not the model or tool arguments, owns which durable session an
// asynchronous image completion resumes. Binding it here keeps the caller's
// `scopeId` (pending/queued coordination) and `readStatus` untouched.
function bindAssistantHostedImageGenerationContinuation(input: {
  launcher: AssistantHostedImageGenerationLauncher
  readContinuationSessionId: () => string
}): AssistantHostedImageGenerationLauncher {
  return {
    ...input.launcher,
    launch(request) {
      return input.launcher.launch({
        ...request,
        continuationSessionId: input.readContinuationSessionId(),
      })
    },
  }
}

export function resolveAssistantHostedScheduledPhoneCallScope(input: {
  channel: AssistantMessageInput['channel']
  conversationScope: AssistantConversationScope
  messageInput: Pick<
    AssistantMessageInput,
    | 'deviceActivityOccurrence'
    | 'scheduledInvocationAuthority'
    | 'scheduledOccurrenceAt'
    | 'turnTrigger'
  >
  originSessionId: string
}): AssistantHostedScheduledPhoneCallScope | null {
  const channel = input.channel?.trim().toLowerCase()
  if (channel !== 'linq' && channel !== 'telegram') {
    return null
  }
  const scope = resolveAssistantHostedScheduledInvocationScope(input)
  if (scope === null) {
    const deviceOccurrence = resolveAssistantHostedDeviceActivityOccurrence(input)
    const occurrenceAt = input.messageInput.scheduledOccurrenceAt ?? null
    return deviceOccurrence === null || occurrenceAt === null
      ? null
      : {
          automationId: deviceOccurrence.parentAutomationId,
          occurrenceAt,
          occurrenceKey: deviceOccurrence.occurrenceKey,
          resultNotificationChannel: channel,
          originSessionId: input.originSessionId,
        }
  }
  if (scope.conversationScope !== 'direct') {
    return null
  }

  return {
    automationId: scope.origin.automationId,
    occurrenceAt: scope.origin.occurrenceAt,
    resultNotificationChannel: channel,
    originSessionId: scope.originSessionId ?? input.originSessionId,
  }
}

export function resolveAssistantHostedPhoneCallResultNotificationChannel(input: {
  channel: AssistantMessageInput['channel']
  conversationScope: AssistantConversationScope
}): HostedPhoneCallResultNotificationChannel | null {
  if (input.conversationScope !== 'direct') {
    return null
  }
  const channel = input.channel?.trim().toLowerCase()
  return channel === 'linq' || channel === 'telegram'
    ? channel
    : null
}

function scopeHostedDeliveryContextPart(input: {
  channel: string | null
  value: string | null | undefined
}): string | null {
  const value = normalizeHostedDeliveryContextValue(input.value)
  if (!value || !input.channel) {
    return value
  }
  if (readScopedHostedDeliveryContextChannel(value) === input.channel) {
    return value
  }
  return JSON.stringify([input.channel, value])
}

function readScopedHostedDeliveryContextChannel(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? normalizeHostedDeliveryChannel(parsed[0])
      : null
  } catch {
    return null
  }
}

function normalizeHostedDeliveryChannel(value: unknown): string | null {
  const normalized = normalizeHostedDeliveryContextValue(value)
  return normalized ? normalized.toLowerCase() : null
}

function normalizeHostedDeliveryContextValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readUsageTools(context: AssistantHostedExecutionContext | null) {
  return {
    planUsageTool: context?.planUsageTool ?? null,
    usageDiagnostics: context?.usageDiagnostics ?? null,
  }
}

function readPollTool(context: AssistantHostedExecutionContext | null): ConversationPollTool | null {
  return context?.pollTool ?? null
}

function readMyGameRemindersTool(context: AssistantHostedExecutionContext | null): AssistantHostedGroupTool | null {
  return context?.myGameRemindersTool ?? null
}
