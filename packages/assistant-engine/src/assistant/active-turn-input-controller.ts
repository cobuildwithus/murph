import type { AssistantAskResult } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantMessageInput } from './service-contracts.js'
import type {
  AssistantActiveTurnInputAdmissionHook,
  AssistantActiveTurnInputAdmissionInput,
  AssistantActiveTurnInputAdmissionResult,
} from './turn-input.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
import type { AssistantSessionLocator } from './store/types.js'
import { normalizeNullableString } from './shared.js'
import { resolveAssistantConversationLookupKey } from './store/paths.js'

type AssistantActiveTurnInputControllerKey = string

interface AssistantActiveTurnInputControllerKeyInput extends AssistantSessionLocator {
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

class AssistantActiveTurnInputController {
  private nextInputOrdinal = 1
  private closed = false
  private pending: QueuedAssistantActiveTurnInput[] = []
  private completion:
    | {
        promise: Promise<AssistantAskResult>
        reject(error: unknown): void
        resolve(result: AssistantAskResult): void
      }
    | null = null

  constructor(
    private readonly input: {
      admissionHook?: AssistantActiveTurnInputAdmissionHook | null
      turnId: string
    },
  ) {}

  enqueue(input: AssistantMessageInput): AssistantActiveTurnInputSteerResult {
    if (this.closed || typeof input.expectedActiveTurnId !== 'string') {
      return {
        kind: 'no-active-turn',
      }
    }
    if (input.expectedActiveTurnId !== this.input.turnId) {
      return {
        kind: 'turn-id-mismatch',
      }
    }
    this.pending.push({
      id: `manual-${this.nextInputOrdinal}`,
      input,
    })
    this.nextInputOrdinal += 1
    return {
      completion: this.resolveCompletion().promise,
      kind: 'queued',
    }
  }

  close(): void {
    this.closed = true
  }

  async admit(
    input: AssistantActiveTurnInputAdmissionInput,
  ): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    const hookAdmission = await this.input.admissionHook?.(input)
    if (hookAdmission?.kind === 'accepted') {
      return mergeAssistantActiveTurnInputAdmissions(
        hookAdmission,
        this.admitPending(),
      )
    }

    const queuedAdmission = this.admitPending()
    if (queuedAdmission?.kind === 'accepted') {
      return queuedAdmission
    }

    return hookAdmission
  }

  private admitPending(): AssistantActiveTurnInputAdmissionResult | undefined {
    const accepted = this.pending.splice(0)
    if (accepted.length === 0) {
      return undefined
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
    this.completion?.resolve(result)
  }

  fail(error: unknown): void {
    this.completion?.reject(error)
  }

  private resolveCompletion(): {
    promise: Promise<AssistantAskResult>
    reject(error: unknown): void
    resolve(result: AssistantAskResult): void
  } {
    if (this.completion) {
      return this.completion
    }

    let rejectCompletion!: (error: unknown) => void
    let resolveCompletion!: (result: AssistantAskResult) => void
    const promise = new Promise<AssistantAskResult>((resolve, reject) => {
      rejectCompletion = reject
      resolveCompletion = resolve
    })
    this.completion = {
      promise,
      reject: rejectCompletion,
      resolve: resolveCompletion,
    }
    return this.completion
  }
}

const activeTurnInputControllers = new Map<
  AssistantActiveTurnInputControllerKey,
  AssistantActiveTurnInputController
>()

export function createAssistantActiveTurnInputController(input: {
  admissionHook?: AssistantActiveTurnInputAdmissionHook | null
  conversationKeys?: readonly string[] | null
  sessionId: string
  turnId: string
  vault: string
}): {
  admit(input: AssistantActiveTurnInputAdmissionInput): Promise<
    AssistantActiveTurnInputAdmissionResult | undefined
  >
  close(): void
  complete(result: AssistantAskResult): void
  fail(error: unknown): void
} {
  const keys = resolveAssistantActiveTurnInputControllerKeys(input)
  const controller = new AssistantActiveTurnInputController({
    admissionHook: input.admissionHook,
    turnId: input.turnId,
  })
  for (const key of keys) {
    activeTurnInputControllers.set(key, controller)
  }

  return {
    admit: (admissionInput) => controller.admit(admissionInput),
    close() {
      controller.close()
      for (const key of keys) {
        if (activeTurnInputControllers.get(key) === controller) {
          activeTurnInputControllers.delete(key)
        }
      }
    },
    complete: (result) => controller.complete(result),
    fail: (error) => controller.fail(error),
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
    const controller = activeTurnInputControllers.get(formatAssistantActiveTurnInputControllerKey({
      kind: 'conversation',
      value: conversationKey,
      vault: input.vault,
    }))
    return controller?.enqueue(input) ?? {
      kind: 'no-active-turn',
    }
  }

  const sessionId = resolveAssistantActiveTurnInputSessionId(input)
  if (sessionId) {
    const controller = activeTurnInputControllers.get(formatAssistantActiveTurnInputControllerKey({
      kind: 'session',
      value: sessionId,
      vault: input.vault,
    }))
    return controller?.enqueue(input) ?? {
      kind: 'no-active-turn',
    }
  }
  return {
    kind: 'no-active-turn',
  }
}

function resolveAssistantActiveTurnInputControllerKeys(
  input: AssistantActiveTurnInputControllerKeyInput,
): AssistantActiveTurnInputControllerKey[] {
  const keys: AssistantActiveTurnInputControllerKey[] = []
  const sessionId = resolveAssistantActiveTurnInputSessionId(input)
  if (sessionId) {
    keys.push(formatAssistantActiveTurnInputControllerKey({
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
    keys.push(formatAssistantActiveTurnInputControllerKey({
      kind: 'conversation',
      value: conversationKey,
      vault: input.vault,
    }))
  }
  return [...new Set(keys)]
}

function resolveAssistantActiveTurnInputSessionId(
  input: Pick<AssistantActiveTurnInputControllerKeyInput, 'conversation' | 'sessionId'>,
): string | null {
  return (
    normalizeNullableString(input.conversation?.sessionId) ??
    normalizeNullableString(input.sessionId)
  )
}

function formatAssistantActiveTurnInputControllerKey(input: {
  kind: 'conversation' | 'session'
  value: string
  vault: string
}): AssistantActiveTurnInputControllerKey {
  return `${input.vault}\u0000${input.kind}\u0000${input.value}`
}

function mergeAssistantActiveTurnInputAdmissions(
  first: Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
  second: AssistantActiveTurnInputAdmissionResult | undefined,
): Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }> {
  if (second?.kind !== 'accepted') {
    return first
  }

  return {
    acceptedInputs: [
      ...(first.acceptedInputs ?? []),
      ...(second.acceptedInputs ?? []),
    ],
    deliveryReplyToMessageId:
      second.deliveryReplyToMessageId === undefined
        ? first.deliveryReplyToMessageId
        : second.deliveryReplyToMessageId,
    kind: 'accepted',
    prompt: joinAssistantActiveTurnInputText([first.prompt, second.prompt]) ?? '',
    receiptMetadata: mergeAssistantActiveTurnReceiptMetadata([
      first.receiptMetadata,
      second.receiptMetadata,
    ]),
    transcriptText: joinAssistantActiveTurnInputText([
      first.transcriptText,
      second.transcriptText,
    ]) ?? null,
    userMessageContent: mergeAssistantActiveTurnUserMessageContent([
      first.userMessageContent,
      second.userMessageContent,
    ]),
  }
}

function joinAssistantActiveTurnInputText(
  values: readonly (string | null | undefined)[],
): string | undefined {
  const joined = values
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => value !== null)
    .join('\n\n')
  return joined.length > 0 ? joined : undefined
}

function mergeAssistantActiveTurnReceiptMetadata(
  values: readonly (Record<string, string> | null | undefined)[],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}
  for (const value of values) {
    if (value) {
      Object.assign(merged, value)
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeAssistantActiveTurnUserMessageContent(
  values: readonly (
    readonly AssistantUserMessageContentPart[] | null | undefined
  )[],
): AssistantUserMessageContentPart[] | undefined {
  const merged = values.flatMap((value) => value ?? [])
  return merged.length > 0 ? merged : undefined
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
