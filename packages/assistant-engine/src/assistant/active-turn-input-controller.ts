import type { AssistantAskResult } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantMessageInput } from './service-contracts.js'
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import type {
  AssistantActiveTurnInputAdmissionHook,
  AssistantActiveTurnInputAdmissionInput,
  AssistantActiveTurnInputAdmissionResult,
  AssistantActiveTurnInputPhase,
  AssistantActiveTurnLiveProviderTurn,
} from './turn-input.js'
import {
  isAssistantActiveTurnInputCheckpointRejectedError,
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

type AssistantAcceptedActiveTurnInputAdmission =
  Omit<
    Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
    'providerAlreadySteered'
  > & {
    acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
  }

interface QueuedAssistantActiveTurnInputAdmission {
  admission: AssistantAcceptedActiveTurnInputAdmission
  providerInputAck?: Promise<boolean> | null
  providerInputAcknowledged: boolean
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
  private fatalAdmissionError: unknown = null
  private inputAvailableAdmission: Promise<AssistantActiveTurnInputAdmissionResult | undefined> | null = null
  private liveProviderTurn: AssistantActiveTurnLiveProviderTurn | null = null
  private livePump: Promise<void> | null = null
  private pending: QueuedAssistantActiveTurnInputAdmission[] = []
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
      acceptedInputValidator?: (input: {
        acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
      }) => Promise<void>
      boundaryAdmissionEnabled?: boolean
      eventAdmissionEnabled?: boolean
      livePollEnabled?: boolean
      sessionId: string
      turnId: string
      vault: string
    },
  ) {}

  enqueueManualActiveTurnInput(input: AssistantMessageInput): AssistantActiveTurnInputSteerResult {
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
    const id = `manual-${this.nextInputOrdinal}`
    const queued: QueuedAssistantActiveTurnInputAdmission = {
      admission: buildManualAcceptedActiveTurnInputAdmission({
        id,
        input,
      }),
      providerInputAcknowledged: false,
    }
    this.pending.push(queued)
    this.nextInputOrdinal += 1
    this.tryStartLiveSteers()
    return {
      completion: this.resolveCompletion().promise,
      kind: 'queued',
    }
  }

  notifyInputAvailable(input?: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    if (this.input.eventAdmissionEnabled === false) {
      return Promise.resolve(undefined)
    }

    return this.pollInputAvailable(input)
  }

  private pollInputAvailable(input?: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    return this.admitAvailableInput({
      phase: 'input_available',
      signal: input?.signal,
    }).catch(async (error: unknown) => {
      await this.handleInputAvailableAdmissionError(error)
      throw error
    })
  }

  close(): void {
    this.closed = true
    this.liveProviderTurn = null
  }

  registerLiveProviderTurn(input: AssistantActiveTurnLiveProviderTurn): () => void {
    if (
      this.closed ||
      input.sessionId !== this.input.sessionId ||
      input.turnId !== this.input.turnId ||
      !normalizeNullableString(input.providerSessionId) ||
      !normalizeNullableString(input.providerTurnId)
    ) {
      return () => {}
    }

    this.liveProviderTurn = input
    this.startLiveInputPump()
    this.tryStartLiveSteers()

    return () => {
      if (this.liveProviderTurn === input) {
        this.liveProviderTurn = null
      }
    }
  }

  async admit(
    input: AssistantActiveTurnInputAdmissionInput,
  ): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    const availableAdmission = await this.admitAvailable()
    if (availableAdmission?.kind === 'accepted') {
      return availableAdmission
    }

    if (this.input.boundaryAdmissionEnabled === false) {
      return undefined
    }

    const hookAdmission = await this.admitHookInput(input)
    return (await this.admitPending()) ?? hookAdmission
  }

  async admitAvailable(input?: {
    pollIfIdle?: boolean
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    this.throwFatalAdmissionError()
    const queuedAdmission = await this.admitPending()
    if (queuedAdmission?.kind === 'accepted') {
      return queuedAdmission
    }

    await this.waitForInputAvailableAdmission()
    const notifiedAdmission = await this.admitPending()
    if (notifiedAdmission?.kind === 'accepted' || input?.pollIfIdle !== true) {
      return notifiedAdmission
    }

    await this.pollInputAvailable({ signal: input.signal })
    return await this.admitPending()
  }

  private async admitPending(): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    const accepted = await this.dequeueAdmissiblePendingPrefix()
    if (accepted.length === 0) {
      return undefined
    }

    return withProviderAcknowledgement(
      accepted
        .map((item) => item.admission)
        .reduce(mergeAcceptedActiveTurnInputAdmissions),
      accepted.every((item) => item.providerInputAcknowledged),
    )
  }

  complete(result: AssistantAskResult): void {
    this.completion?.resolve(result)
  }

  fail(error: unknown): void {
    this.closed = true
    this.liveProviderTurn = null
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

  private async admitAvailableInput(input: {
    phase: AssistantActiveTurnInputPhase
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    if (!this.input.admissionHook || this.closed) {
      return undefined
    }

    if (this.inputAvailableAdmission) {
      return this.inputAvailableAdmission
    }

    const admissionInput = this.buildAdmissionInput(input)
    const admission = this.input.admissionHook(admissionInput)
      .then(async (result) => {
        await this.queueHookAdmission(result)
        return result
      })
      .finally(() => {
        if (this.inputAvailableAdmission === admission) {
          this.inputAvailableAdmission = null
        }
      })
    this.inputAvailableAdmission = admission
    return admission
  }

  private async admitHookInput(
    input: AssistantActiveTurnInputAdmissionInput,
  ): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    if (!this.input.admissionHook) {
      return undefined
    }

    const result = await this.input.admissionHook({
      ...input,
      ...this.resolveKnownAdmissionInput(),
    })
    await this.queueHookAdmission(result)
    return result
  }

  private async waitForInputAvailableAdmission(): Promise<void> {
    if (!this.inputAvailableAdmission) {
      return
    }

    try {
      await this.inputAvailableAdmission
    } catch (error) {
      await this.handleInputAvailableAdmissionError(error)
      this.throwFatalAdmissionError()
    }
  }

  private throwFatalAdmissionError(): void {
    if (this.fatalAdmissionError) {
      throw this.fatalAdmissionError
    }
  }

  private buildAdmissionInput(input: {
    phase: AssistantActiveTurnInputPhase
    signal?: AbortSignal
  }): AssistantActiveTurnInputAdmissionInput {
    return {
      ...this.resolveKnownAdmissionInput(),
      phase: input.phase,
      sessionId: this.input.sessionId,
      signal: input.signal,
      turnId: this.input.turnId,
      vault: this.input.vault,
    }
  }

  private async queueHookAdmission(
    result: AssistantActiveTurnInputAdmissionResult | undefined,
  ): Promise<void> {
    if (result?.kind !== 'accepted') {
      return
    }

    await this.input.acceptedInputValidator?.({
      acceptedInputs: result.acceptedInputs ?? [],
    })
    const queued = {
      admission: normalizeAcceptedActiveTurnInputAdmission(result),
      providerInputAcknowledged: false,
    }
    this.pending.push(queued)
    this.tryStartLiveSteers()
  }

  private resolveKnownAdmissionInput(): Pick<
    AssistantActiveTurnInputAdmissionInput,
    'knownProjectionCaptureIds' | 'knownInputIds'
  > {
    const knownProjectionCaptureIds = new Set<string>()
    const knownInputIds = new Set<string>()

    for (const item of this.pending) {
      for (const acceptedInput of item.admission.acceptedInputs) {
        knownInputIds.add(acceptedInput.id)
        for (const captureId of acceptedInput.captureIds ?? []) {
          knownProjectionCaptureIds.add(captureId)
        }
      }
    }

    return {
      knownProjectionCaptureIds: [...knownProjectionCaptureIds],
      knownInputIds: [...knownInputIds],
    }
  }

  private async dequeueAdmissiblePendingPrefix(): Promise<QueuedAssistantActiveTurnInputAdmission[]> {
    const first = this.pending[0]
    if (!first) {
      return []
    }

    await first.providerInputAck?.catch(() => undefined)
    const providerInputAcknowledged = first.providerInputAcknowledged
    const accepted: QueuedAssistantActiveTurnInputAdmission[] = []
    const pendingLength = this.pending.length

    while (accepted.length < pendingLength) {
      const item = this.pending[accepted.length]
      if (!item) {
        break
      }

      await item.providerInputAck?.catch(() => undefined)
      if (item.providerInputAcknowledged !== providerInputAcknowledged) {
        break
      }

      accepted.push(item)
    }

    this.pending.splice(0, accepted.length)
    this.tryStartLiveSteers()
    return accepted
  }

  private tryStartLiveSteers(): void {
    const liveProviderTurn = this.liveProviderTurn
    if (this.closed || !liveProviderTurn) {
      return
    }

    for (const item of this.pending) {
      if (item.providerInputAcknowledged) {
        continue
      }
      if (item.providerInputAck) {
        return
      }

      item.providerInputAck = liveProviderTurn
        .steer({
          prompt: normalizeNullableString(item.admission.prompt) ?? '',
          userMessageContent: item.admission.userMessageContent ?? null,
        })
        .then(() => {
          const acknowledged =
            !this.closed && this.liveProviderTurn === liveProviderTurn
          if (acknowledged) {
            item.providerInputAcknowledged = true
          }
          this.tryStartLiveSteers()
          return acknowledged
        })
        .catch(() => false)
      return
    }
  }

  private startLiveInputPump(): void {
    if (
      this.livePump ||
      !this.input.admissionHook ||
      this.input.livePollEnabled === false
    ) {
      return
    }

    this.livePump = (async () => {
      while (!this.closed && this.liveProviderTurn) {
        await delayActiveTurnInputPumpTick()
        if (this.closed || !this.liveProviderTurn) {
          break
        }
        await this.notifyInputAvailable().catch(() => undefined)
      }
    })().finally(() => {
      this.livePump = null
      if (!this.closed && this.liveProviderTurn) {
        this.startLiveInputPump()
      }
    })
  }

  private async handleInputAvailableAdmissionError(error: unknown): Promise<void> {
    if (!isAssistantActiveTurnInputCheckpointRejectedError(error)) {
      return
    }
    const liveProviderTurn = this.liveProviderTurn
    this.fatalAdmissionError = error
    this.fail(error)
    await liveProviderTurn?.interrupt().catch(() => undefined)
  }
}

const activeTurnInputControllers = new Map<
  AssistantActiveTurnInputControllerKey,
  AssistantActiveTurnInputController
>()

export function createAssistantActiveTurnInputController(input: {
  acceptedInputValidator?: (validatorInput: {
    acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
  }) => Promise<void>
  admissionHook?: AssistantActiveTurnInputAdmissionHook | null
  boundaryAdmissionEnabled?: boolean
  conversationKeys?: readonly string[] | null
  eventAdmissionEnabled?: boolean
  livePollEnabled?: boolean
  sessionId: string
  turnId: string
  vault: string
}): {
  admit(input: AssistantActiveTurnInputAdmissionInput): Promise<
    AssistantActiveTurnInputAdmissionResult | undefined
  >
  admitAvailable(input?: {
    pollIfIdle?: boolean
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined>
  close(): void
  complete(result: AssistantAskResult): void
  fail(error: unknown): void
  notifyInputAvailable(input?: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined>
  registerLiveProviderTurn(input: AssistantActiveTurnLiveProviderTurn): () => void
} {
  const keys = resolveAssistantActiveTurnInputControllerKeys(input)
  const controller = new AssistantActiveTurnInputController({
    acceptedInputValidator: input.acceptedInputValidator,
    admissionHook: input.admissionHook,
    boundaryAdmissionEnabled: input.boundaryAdmissionEnabled,
    eventAdmissionEnabled: input.eventAdmissionEnabled,
    livePollEnabled: input.livePollEnabled,
    sessionId: input.sessionId,
    turnId: input.turnId,
    vault: input.vault,
  })
  for (const key of keys) {
    activeTurnInputControllers.set(key, controller)
  }

  return {
    admit: (admissionInput) => controller.admit(admissionInput),
    admitAvailable: (input) => controller.admitAvailable(input),
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
    notifyInputAvailable: (notificationInput) =>
      controller.notifyInputAvailable(notificationInput),
    registerLiveProviderTurn: (turn) => controller.registerLiveProviderTurn(turn),
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
  return enqueueManualActiveTurnInput(input)
}

export function enqueueManualActiveTurnInput(
  input: AssistantMessageInput,
): AssistantActiveTurnInputSteerResult {
  const conversationKey = resolveAssistantConversationLookupKey(input)
  if (conversationKey) {
    const controller = activeTurnInputControllers.get(formatAssistantActiveTurnInputControllerKey({
      kind: 'conversation',
      value: conversationKey,
      vault: input.vault,
    }))
    return controller?.enqueueManualActiveTurnInput(input) ?? {
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
    return controller?.enqueueManualActiveTurnInput(input) ?? {
      kind: 'no-active-turn',
    }
  }
  return {
    kind: 'no-active-turn',
  }
}

export async function notifyAssistantActiveTurnInputAvailable(
  input: AssistantActiveTurnInputControllerKeyInput & {
    signal?: AbortSignal
  },
): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
  for (const key of resolveAssistantActiveTurnInputControllerKeys(input)) {
    const controller = activeTurnInputControllers.get(key)
    if (controller) {
      return controller.notifyInputAvailable({
        signal: input.signal,
      })
    }
  }
  return undefined
}

export async function notifyAssistantActiveTurnInputsAvailableForVault(input: {
  signal?: AbortSignal
  vault: string
}): Promise<readonly AssistantActiveTurnInputAdmissionResult[]> {
  const keyPrefix = `${input.vault}\u0000`
  const controllers = new Set<AssistantActiveTurnInputController>()
  for (const [key, controller] of activeTurnInputControllers.entries()) {
    if (key.startsWith(keyPrefix)) {
      controllers.add(controller)
    }
  }

  const results: AssistantActiveTurnInputAdmissionResult[] = []
  for (const controller of controllers) {
    const result = await controller.notifyInputAvailable({
      signal: input.signal,
    })
    if (result) {
      results.push(result)
    }
  }

  return results
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
    deliveryIdempotencyKey:
      second.deliveryIdempotencyKey === undefined
        ? first.deliveryIdempotencyKey
        : second.deliveryIdempotencyKey,
    kind: 'accepted',
    prompt: joinAssistantActiveTurnInputText([first.prompt, second.prompt]) ?? '',
    ...(first.providerAlreadySteered === true && second.providerAlreadySteered === true
      ? { providerAlreadySteered: true }
      : {}),
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

function normalizeAcceptedActiveTurnInputAdmission(
  admission: Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
): AssistantAcceptedActiveTurnInputAdmission {
  return {
    ...admission,
    acceptedInputs: [...(admission.acceptedInputs ?? [])],
  }
}

function withProviderAcknowledgement(
  admission: AssistantAcceptedActiveTurnInputAdmission,
  providerInputAcknowledged: boolean,
): Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }> {
  return {
    ...admission,
    ...(providerInputAcknowledged ? { providerAlreadySteered: true } : {}),
  }
}

function mergeAcceptedActiveTurnInputAdmissions(
  first: AssistantAcceptedActiveTurnInputAdmission,
  second: AssistantAcceptedActiveTurnInputAdmission,
): AssistantAcceptedActiveTurnInputAdmission {
  return normalizeAcceptedActiveTurnInputAdmission(
    mergeAssistantActiveTurnInputAdmissions(first, second),
  )
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
  accepted: readonly AssistantMessageInput[],
): AssistantUserMessageContentPart[] | null {
  const content: AssistantUserMessageContentPart[] = []
  for (const item of accepted) {
    const explicitContent = item.userMessageContent ?? null
    if (explicitContent && explicitContent.length > 0) {
      content.push(...explicitContent)
      continue
    }

    const prompt = normalizeNullableString(item.prompt)
    if (prompt) {
      content.push({
        text: prompt,
        type: 'text',
      })
    }
  }

  return content.length > 0 ? content : null
}

function buildManualAcceptedActiveTurnInputAdmission(input: {
  id: string
  input: AssistantMessageInput
}): AssistantAcceptedActiveTurnInputAdmission {
  return {
    acceptedInputs: [
      {
        id: input.id,
        promptFallbackReason: 'manual-input',
        promptFallbackText: normalizeNullableString(input.input.prompt) ?? undefined,
        source: 'manual',
      },
    ],
    deliveryReplyToMessageId: input.input.deliveryReplyToMessageId,
    kind: 'accepted',
    prompt: normalizeNullableString(input.input.prompt) ?? '',
    transcriptText: null,
    userMessageContent: buildQueuedActiveTurnUserMessageContent([input.input]),
  }
}

async function delayActiveTurnInputPumpTick(): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000)
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref()
    }
  })
}
