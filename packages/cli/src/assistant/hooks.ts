import type {
  AssistantApprovalPolicy,
  AssistantChannelDelivery,
  AssistantChatProvider,
  AssistantCronJob,
  AssistantCronRunRecord,
  AssistantCronTrigger,
  AssistantDeliveryError,
  AssistantSandbox,
  AssistantSession,
} from '../assistant-cli-contracts.js'
import type {
  AssistantProviderProgressEvent,
  AssistantProviderTurnResult,
} from '../chat-provider.js'
import { errorMessage } from './shared.js'

const ASSISTANT_LIFECYCLE_MIDDLEWARE_FAILURE = Symbol(
  'assistant-lifecycle-middleware-failure',
)

export type AssistantLifecycleMiddlewarePoint =
  | 'beforeContextBuild'
  | 'afterContextBuild'
  | 'beforeModelSend'
  | 'afterModelReceive'
  | 'beforeOutboundDelivery'

export interface AssistantHookConversationMessage {
  content: string
  role: 'assistant' | 'user'
}

export interface AssistantHookProviderOptions {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}

export interface AssistantBeforeContextBuildState {
  prompt: string
  session: Readonly<AssistantSession>
  sessionCreated: boolean
  vault: string
  workingDirectory: string
}

export interface AssistantAfterContextBuildState {
  allowSensitiveHealthContext: boolean
  configOverrides?: readonly string[]
  conversationMessages?: ReadonlyArray<AssistantHookConversationMessage>
  persistUserPromptOnFailure: boolean
  provider: AssistantChatProvider
  providerOptions: AssistantHookProviderOptions
  resumeProviderSessionId: string | null
  session: Readonly<AssistantSession>
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  vault: string
  workingDirectory: string
}

export interface AssistantBeforeModelSendState {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string
  configOverrides?: readonly string[]
  conversationMessages?: ReadonlyArray<AssistantHookConversationMessage>
  env?: NodeJS.ProcessEnv
  model?: string | null
  oss?: boolean
  profile?: string | null
  provider: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  resumeProviderSessionId: string | null
  sandbox?: AssistantSandbox | null
  session: Readonly<AssistantSession>
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  showThinkingTraces: boolean
  systemPrompt: string | null
  userPrompt: string
  vault: string
  workingDirectory: string
}

export interface AssistantAfterModelReceiveState {
  providerResult: AssistantProviderTurnResult
  session: Readonly<AssistantSession>
  turnCreatedAt: string
  vault: string
}

export interface AssistantBeforeOutboundDeliveryState {
  binding: AssistantSession['binding']
  explicitTarget: string | null
  message: string
  sessionId: string | null
  vault: string | null
}

export interface AssistantLifecycleMiddlewareStateMap {
  afterContextBuild: AssistantAfterContextBuildState
  afterModelReceive: AssistantAfterModelReceiveState
  beforeContextBuild: AssistantBeforeContextBuildState
  beforeModelSend: AssistantBeforeModelSendState
  beforeOutboundDelivery: AssistantBeforeOutboundDeliveryState
}

export interface AssistantObserverErrorDiagnostic {
  eventType: AssistantLifecycleObserverEvent['type']
  message: string
  observedAt: string
  observerName: string | null
}

export type AssistantAutomationScanKind =
  | 'auto-reply'
  | 'auto-reply-backlog'
  | 'cron'
  | 'inbox'

export type AssistantLifecycleObserverEvent =
  | {
      alias: string | null
      channel: string | null
      occurredAt: string
      prompt: string
      sessionCreated: boolean
      sessionId: string
      turnCount: number
      type: 'turn.started'
      vault: string
    }
  | {
      hasConversationMessages: boolean
      hasSystemPrompt: boolean
      occurredAt: string
      provider: AssistantChatProvider
      sessionId: string
      type: 'context.built'
      vault: string
      workingDirectory: string
    }
  | {
      model: string | null
      occurredAt: string
      provider: AssistantChatProvider
      sessionId: string
      type: 'provider.started'
      userPrompt: string
      vault: string
      workingDirectory: string
    }
  | {
      event: AssistantProviderProgressEvent
      occurredAt: string
      provider: AssistantChatProvider
      sessionId: string
      type: 'provider.event'
      vault: string
    }
  | {
      occurredAt: string
      provider: AssistantChatProvider
      providerSessionId: string | null
      response: string
      sessionId: string
      type: 'provider.completed'
      vault: string
    }
  | {
      code: string | null
      message: string
      occurredAt: string
      provider: AssistantChatProvider
      sessionId: string
      type: 'provider.failed'
      vault: string
    }
  | {
      channel: string
      explicitTarget: string | null
      message: string
      occurredAt: string
      sessionId: string | null
      type: 'delivery.started'
      vault: string | null
    }
  | {
      delivery: AssistantChannelDelivery
      occurredAt: string
      sessionId: string | null
      type: 'delivery.completed'
      vault: string | null
    }
  | {
      channel: string
      error: AssistantDeliveryError
      explicitTarget: string | null
      message: string
      occurredAt: string
      sessionId: string | null
      type: 'delivery.failed'
      vault: string | null
    }
  | {
      deliveryStatus: 'failed' | 'not-requested' | 'sent'
      occurredAt: string
      provider: AssistantChatProvider
      response: string
      sessionId: string
      type: 'turn.completed'
      vault: string
    }
  | {
      job: Pick<AssistantCronJob, 'jobId' | 'name'>
      occurredAt: string
      trigger: AssistantCronTrigger
      type: 'cron.run.started'
      vault: string
    }
  | {
      job: Pick<AssistantCronJob, 'jobId' | 'name'>
      occurredAt: string
      run: AssistantCronRunRecord
      trigger: AssistantCronTrigger
      type: 'cron.run.completed'
      vault: string
    }
  | {
      occurredAt: string
      scanIndex: number
      scanKind: AssistantAutomationScanKind
      type: 'automation.scan.started'
      vault: string
    }
  | ({
      occurredAt: string
      scanIndex: number
      scanKind: AssistantAutomationScanKind
      type: 'automation.scan.completed'
      vault: string
    } & (
      | {
          failed: number
          processed: number
          succeeded: number
        }
      | {
          considered: number
          failed: number
          noAction: number
          routed: number
          skipped: number
        }
      | {
          considered: number
          failed: number
          replied: number
          skipped: number
        }
    ))
  | {
      decision: string
      occurredAt: string
      reason: string
      scope: string
      type: 'fallback.decision'
      vault: string
    }

export type AssistantLifecycleMiddleware<
  K extends AssistantLifecycleMiddlewarePoint,
> = (
  state: AssistantLifecycleMiddlewareStateMap[K],
) =>
  | AssistantLifecycleMiddlewareStateMap[K]
  | Promise<AssistantLifecycleMiddlewareStateMap[K]>

export type AssistantLifecycleObserver = (
  event: AssistantLifecycleObserverEvent,
) => void | Promise<void>

interface AssistantLifecycleMiddlewareRegistration<
  K extends AssistantLifecycleMiddlewarePoint,
> {
  name?: string
  run: AssistantLifecycleMiddleware<K>
}

interface AssistantLifecycleObserverRegistration {
  name?: string
  observe: AssistantLifecycleObserver
}

interface AssistantLifecycleMiddlewareRegistry {
  afterContextBuild: AssistantLifecycleMiddlewareRegistration<'afterContextBuild'>[]
  afterModelReceive: AssistantLifecycleMiddlewareRegistration<'afterModelReceive'>[]
  beforeContextBuild: AssistantLifecycleMiddlewareRegistration<'beforeContextBuild'>[]
  beforeModelSend: AssistantLifecycleMiddlewareRegistration<'beforeModelSend'>[]
  beforeOutboundDelivery: AssistantLifecycleMiddlewareRegistration<'beforeOutboundDelivery'>[]
}

export interface AssistantLifecycleHooks {
  diagnostics: AssistantObserverErrorDiagnostic[]
  middleware: AssistantLifecycleMiddlewareRegistry
  observers: AssistantLifecycleObserverRegistration[]
  onObserverDiagnostic?: ((diagnostic: AssistantObserverErrorDiagnostic) => void) | null
  observerDispatch: Promise<void>
}

export function createAssistantLifecycleHooks(input?: {
  onObserverDiagnostic?: ((diagnostic: AssistantObserverErrorDiagnostic) => void) | null
}): AssistantLifecycleHooks {
  return {
    diagnostics: [],
    middleware: {
      beforeContextBuild: [],
      afterContextBuild: [],
      beforeModelSend: [],
      afterModelReceive: [],
      beforeOutboundDelivery: [],
    },
    observers: [],
    onObserverDiagnostic: input?.onObserverDiagnostic ?? null,
    observerDispatch: Promise.resolve(),
  }
}

export function addAssistantLifecycleMiddleware<
  K extends AssistantLifecycleMiddlewarePoint,
>(
  hooks: AssistantLifecycleHooks,
  point: K,
  middleware: AssistantLifecycleMiddleware<K>,
  name?: string,
): AssistantLifecycleHooks {
  resolveAssistantLifecycleMiddlewareRegistrations(hooks, point).push({
    name,
    run: middleware,
  })
  return hooks
}

export function addAssistantLifecycleObserver(
  hooks: AssistantLifecycleHooks,
  observer: AssistantLifecycleObserver,
  name?: string,
): AssistantLifecycleHooks {
  hooks.observers.push({
    name,
    observe: observer,
  })
  return hooks
}

export async function runAssistantLifecycleMiddleware<
  K extends AssistantLifecycleMiddlewarePoint,
>(
  hooks: AssistantLifecycleHooks | undefined,
  point: K,
  initialState: AssistantLifecycleMiddlewareStateMap[K],
): Promise<AssistantLifecycleMiddlewareStateMap[K]> {
  let state = initialState

  for (const middleware of hooks
    ? resolveAssistantLifecycleMiddlewareRegistrations(hooks, point)
    : []) {
    try {
      state = await middleware.run(state)
    } catch (error) {
      throw annotateAssistantLifecycleMiddlewareFailure(
        error,
        point,
        middleware.name ?? middleware.run.name ?? null,
      )
    }
  }

  return state
}

function resolveAssistantLifecycleMiddlewareRegistrations<
  K extends AssistantLifecycleMiddlewarePoint,
>(
  hooks: AssistantLifecycleHooks,
  point: K,
): AssistantLifecycleMiddlewareRegistration<K>[] {
  switch (point) {
    case 'afterContextBuild':
      return hooks.middleware.afterContextBuild as unknown as AssistantLifecycleMiddlewareRegistration<K>[]
    case 'afterModelReceive':
      return hooks.middleware.afterModelReceive as unknown as AssistantLifecycleMiddlewareRegistration<K>[]
    case 'beforeContextBuild':
      return hooks.middleware.beforeContextBuild as unknown as AssistantLifecycleMiddlewareRegistration<K>[]
    case 'beforeModelSend':
      return hooks.middleware.beforeModelSend as unknown as AssistantLifecycleMiddlewareRegistration<K>[]
    case 'beforeOutboundDelivery':
      return hooks.middleware.beforeOutboundDelivery as unknown as AssistantLifecycleMiddlewareRegistration<K>[]
  }
}

export function emitAssistantLifecycleEvent(
  hooks: AssistantLifecycleHooks | undefined,
  event: AssistantLifecycleObserverEvent,
): Promise<void> {
  if (!hooks || hooks.observers.length === 0) {
    return Promise.resolve()
  }

  const dispatch = async () => {
    for (const observer of hooks.observers) {
      try {
        await observer.observe(event)
      } catch (error) {
        const diagnostic = {
          eventType: event.type,
          message: errorMessage(error),
          observedAt: new Date().toISOString(),
          observerName: observer.name ?? observer.observe.name ?? null,
        }
        hooks.diagnostics.push(diagnostic)
        try {
          hooks.onObserverDiagnostic?.(diagnostic)
        } catch {
          // Diagnostic sinks are best-effort and must not affect runtime control flow.
        }
      }
    }
  }

  const nextDispatch = hooks.observerDispatch.then(dispatch, dispatch)
  hooks.observerDispatch = nextDispatch
  return nextDispatch
}

export function isAssistantLifecycleMiddlewareFailure(
  error: unknown,
): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ASSISTANT_LIFECYCLE_MIDDLEWARE_FAILURE in error,
  )
}

function annotateAssistantLifecycleMiddlewareFailure(
  error: unknown,
  point: AssistantLifecycleMiddlewarePoint,
  middlewareName: string | null,
) {
  if (error && typeof error === 'object') {
    ;(error as any)[ASSISTANT_LIFECYCLE_MIDDLEWARE_FAILURE] = {
      point,
      middlewareName,
    }
    return error
  }

  const wrapped = new Error(String(error))
  ;(wrapped as any)[ASSISTANT_LIFECYCLE_MIDDLEWARE_FAILURE] = {
    point,
    middlewareName,
  }
  return wrapped
}
