import type { AssistantAskResult } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantMessageInput } from './service-contracts.js'
import type { AssistantActiveTurnInputAdmissionResult } from './turn-input.js'
import type { AssistantUserMessageContentPart } from '../model-harness.js'
import type { AssistantSessionLocator } from './store/types.js'
import { normalizeNullableString } from './shared.js'
import { resolveAssistantConversationLookupKey } from './store/paths.js'

type AssistantActiveTurnInputQueueKey = string

interface AssistantActiveTurnInputQueueKeyInput extends AssistantSessionLocator {
  conversationKeys?: readonly string[] | null
  vault: string
}

interface QueuedAssistantActiveTurnInput {
  id: string
  input: AssistantMessageInput
}

type AssistantActiveTurnInputSteerResult =
  | {
      completion: Promise<AssistantAskResult>
      kind: 'queued'
    }
  | {
      kind: 'no-active-turn'
    }
  | {
      kind: 'turn-id-mismatch'
    }

class AssistantActiveTurnInputQueue {
  private nextInputOrdinal = 1
  private completionObserved = false
  private closed = false
  private pending: QueuedAssistantActiveTurnInput[] = []
  private readonly completion: Promise<AssistantAskResult>
  private rejectCompletion!: (error: unknown) => void
  private resolveCompletion!: (result: AssistantAskResult) => void

  constructor(private readonly turnId: string) {
    this.completion = new Promise<AssistantAskResult>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
  }

  enqueue(input: AssistantMessageInput): AssistantActiveTurnInputSteerResult {
    if (this.closed || typeof input.expectedActiveTurnId !== 'string') {
      return {
        kind: 'no-active-turn',
      }
    }
    if (input.expectedActiveTurnId !== this.turnId) {
      return {
        kind: 'turn-id-mismatch',
      }
    }
    this.completionObserved = true
    this.pending.push({
      id: `manual-${this.nextInputOrdinal}`,
      input,
    })
    this.nextInputOrdinal += 1
    return {
      completion: this.completion,
      kind: 'queued',
    }
  }

  close(): void {
    this.closed = true
  }

  admit(): AssistantActiveTurnInputAdmissionResult {
    const accepted = this.pending.splice(0)
    if (accepted.length === 0) {
      return {
        kind: 'no-new-input',
      }
    }

    const prompt = accepted
      .map((item) => normalizeNullableString(item.input.prompt))
      .filter((text): text is string => text !== null)
      .join('\n\n')
    const lastInput = accepted.at(-1)?.input ?? null

    return {
      acceptedInputs: accepted.map((item) => ({
        id: item.id,
        promptFallbackReason: 'manual-input',
        promptFallbackText: normalizeNullableString(item.input.prompt) ?? undefined,
        source: 'manual',
      })),
      deliveryReplyToMessageId: lastInput?.deliveryReplyToMessageId,
      kind: 'accepted',
      prompt,
      transcriptText: null,
      userMessageContent: buildQueuedActiveTurnUserMessageContent(accepted),
    }
  }

  complete(result: AssistantAskResult): void {
    if (this.completionObserved) {
      this.resolveCompletion(result)
    }
  }

  fail(error: unknown): void {
    if (this.completionObserved) {
      this.rejectCompletion(error)
    }
  }
}

const activeTurnInputQueues = new Map<
  AssistantActiveTurnInputQueueKey,
  AssistantActiveTurnInputQueue
>()

export function createAssistantActiveTurnInputQueue(input: {
  conversationKeys?: readonly string[] | null
  sessionId: string
  turnId: string
  vault: string
}): {
  admit(): AssistantActiveTurnInputAdmissionResult
  close(): void
  complete(result: AssistantAskResult): void
  fail(error: unknown): void
} {
  const keys = resolveAssistantActiveTurnInputQueueKeys(input)
  const queue = new AssistantActiveTurnInputQueue(input.turnId)
  for (const key of keys) {
    activeTurnInputQueues.set(key, queue)
  }

  return {
    admit: () => queue.admit(),
    close() {
      queue.close()
      for (const key of keys) {
        if (activeTurnInputQueues.get(key) === queue) {
          activeTurnInputQueues.delete(key)
        }
      }
    },
    complete: (result) => queue.complete(result),
    fail: (error) => queue.fail(error),
  }
}

export function steerAssistantActiveTurnInput(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> | null {
  const result = steerAssistantActiveTurnInputWithStatus(input)
  return result.kind === 'queued' ? result.completion : null
}

export function steerAssistantActiveTurnInputWithStatus(
  input: AssistantMessageInput,
): AssistantActiveTurnInputSteerResult {
  const conversationKey = resolveAssistantConversationLookupKey(input)
  if (conversationKey) {
    const queue = activeTurnInputQueues.get(formatAssistantActiveTurnInputQueueKey({
      kind: 'conversation',
      value: conversationKey,
      vault: input.vault,
    }))
    return queue?.enqueue(input) ?? {
      kind: 'no-active-turn',
    }
  }

  const sessionId = resolveAssistantActiveTurnInputSessionId(input)
  if (sessionId) {
    const queue = activeTurnInputQueues.get(formatAssistantActiveTurnInputQueueKey({
      kind: 'session',
      value: sessionId,
      vault: input.vault,
    }))
    return queue?.enqueue(input) ?? {
      kind: 'no-active-turn',
    }
  }
  return {
    kind: 'no-active-turn',
  }
}

function resolveAssistantActiveTurnInputQueueKeys(
  input: AssistantActiveTurnInputQueueKeyInput,
): AssistantActiveTurnInputQueueKey[] {
  const keys: AssistantActiveTurnInputQueueKey[] = []
  const sessionId = resolveAssistantActiveTurnInputSessionId(input)
  if (sessionId) {
    keys.push(formatAssistantActiveTurnInputQueueKey({
      kind: 'session',
      value: sessionId,
      vault: input.vault,
    }))
  }
  const conversationKeys =
    input.conversationKeys ?? [resolveAssistantConversationLookupKey(input)]
  for (const conversationKey of conversationKeys) {
    if (conversationKey === null) {
      continue
    }
    keys.push(formatAssistantActiveTurnInputQueueKey({
      kind: 'conversation',
      value: conversationKey,
      vault: input.vault,
    }))
  }
  return [...new Set(keys)]
}

function resolveAssistantActiveTurnInputSessionId(
  input: Pick<AssistantActiveTurnInputQueueKeyInput, 'conversation' | 'sessionId'>,
): string | null {
  return (
    normalizeNullableString(input.conversation?.sessionId) ??
    normalizeNullableString(input.sessionId)
  )
}

function formatAssistantActiveTurnInputQueueKey(input: {
  kind: 'conversation' | 'session'
  value: string
  vault: string
}): AssistantActiveTurnInputQueueKey {
  return `${input.vault}\u0000${input.kind}\u0000${input.value}`
}

function buildQueuedActiveTurnUserMessageContent(
  accepted: readonly QueuedAssistantActiveTurnInput[],
): AssistantUserMessageContentPart[] | null {
  const content: AssistantUserMessageContentPart[] = []
  for (const item of accepted) {
    const explicitContent = item.input.userMessageContent ?? null
    if (explicitContent && explicitContent.length > 0) {
      content.push(...explicitContent)
      continue
    }

    const prompt = normalizeNullableString(item.input.prompt)
    if (prompt) {
      content.push({
        text: prompt,
        type: 'text',
      })
    }
  }

  return content.length > 0 ? content : null
}
