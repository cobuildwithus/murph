import type { AssistantAskResult } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantMessageInput } from './service-contracts.js'
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import type {
  AssistantActiveTurnInputAdmissionHook,
  AssistantActiveTurnInputAdmissionInput,
  AssistantActiveTurnInputAdmissionResult,
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
type AssistantActiveTurnLiveProviderTurnKey = string

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
  manualCompletion?: AssistantActiveTurnManualInputCompletion | null
  providerInputAck?: Promise<boolean> | null
  providerInputAckTurnKey?: AssistantActiveTurnLiveProviderTurnKey | null
  providerInputAcknowledgedTurnKey?: AssistantActiveTurnLiveProviderTurnKey | null
}

interface AssistantActiveTurnManualInputCompletion {
  accepted: boolean
  promise: Promise<AssistantAskResult>
  reject(error: unknown): void
  resolve(result: AssistantAskResult): void
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
  private admissionHookQueue: Promise<void> = Promise.resolve()
  private fatalAdmissionError: unknown = null
  private inputAvailableAdmission: Promise<AssistantActiveTurnInputAdmissionResult | undefined> | null = null
  private inputAvailableAdmissionRerunRequested = false
  private liveProviderTurn: AssistantActiveTurnLiveProviderTurn | null = null
  private liveProviderTurnKey: AssistantActiveTurnLiveProviderTurnKey | null = null
  private liveProviderTurnEnded = false
  private completedProviderTurnKey: AssistantActiveTurnLiveProviderTurnKey | null = null
  private pending: QueuedAssistantActiveTurnInputAdmission[] = []
  private manualCompletions: AssistantActiveTurnManualInputCompletion[] = []

  constructor(
    private readonly input: {
      admissionHook?: AssistantActiveTurnInputAdmissionHook | null
      acceptedInputValidator?: (input: {
        acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
      }) => Promise<void>
      eventAdmissionEnabled?: boolean
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
    if (this.liveProviderTurnEnded) {
      return {
        kind: 'no-active-turn',
      }
    }
    const id = `manual-${this.nextInputOrdinal}`
    const manualCompletion = createAssistantActiveTurnManualInputCompletion()
    const queued: QueuedAssistantActiveTurnInputAdmission = {
      admission: buildManualAcceptedActiveTurnInputAdmission({
        id,
        input,
      }),
      manualCompletion,
      providerInputAcknowledgedTurnKey: null,
    }
    this.pending.push(queued)
    this.manualCompletions.push(manualCompletion)
    this.nextInputOrdinal += 1
    this.tryStartLiveSteers()
    return {
      completion: manualCompletion.promise,
      kind: 'queued',
    }
  }

  notifyInputAvailable(input?: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    if (
      this.input.eventAdmissionEnabled === false ||
      this.liveProviderTurnEnded
    ) {
      return Promise.resolve(undefined)
    }

    return this.runInputAvailableAdmission(input)
  }

  private runInputAvailableAdmission(input?: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    return this.admitAvailableInput({
      signal: input?.signal,
    }).catch(async (error: unknown) => {
      await this.handleInputAvailableAdmissionError(error)
      throw error
    })
  }

  close(): void {
    this.closed = true
    this.liveProviderTurn = null
    this.liveProviderTurnKey = null
    this.liveProviderTurnEnded = true
  }

  registerLiveProviderTurn(input: AssistantActiveTurnLiveProviderTurn): () => void {
    if (
      this.closed ||
      input.sessionId !== this.input.sessionId ||
      input.turnId !== this.input.turnId ||
      !normalizeNullableString(input.codexThreadId) ||
      !normalizeNullableString(input.providerTurnId)
    ) {
      return () => {}
    }

    const liveProviderTurnKey = formatAssistantActiveTurnLiveProviderTurnKey(input)
    this.liveProviderTurn = input
    this.liveProviderTurnKey = liveProviderTurnKey
    this.liveProviderTurnEnded = false
    this.completedProviderTurnKey = null
    this.tryStartLiveSteers()

    return () => {
      if (this.liveProviderTurn === input) {
        this.liveProviderTurn = null
        this.liveProviderTurnKey = null
        this.liveProviderTurnEnded = true
        this.completedProviderTurnKey = liveProviderTurnKey
      }
    }
  }

  async admitAvailable(input?: {
    probeIfIdle?: boolean
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    this.throwFatalAdmissionError()
    const queuedAdmission = await this.admitPending()
    if (queuedAdmission?.kind === 'accepted') {
      return queuedAdmission
    }

    await this.waitForInputAvailableAdmission()
    const notifiedAdmission = await this.admitPending()
    if (notifiedAdmission?.kind === 'accepted' || input?.probeIfIdle !== true) {
      return notifiedAdmission
    }

    await this.runInputAvailableAdmission({ signal: input.signal })
    return await this.admitPending()
  }

  async admitLiveSteered(): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    this.throwFatalAdmissionError()
    await this.waitForInputAvailableAdmission()
    return await this.admitPending({ requireProviderAcknowledged: true })
  }

  private async admitPending(input?: {
    requireProviderAcknowledged?: boolean
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    const providerTurnKey = this.resolveProviderAcknowledgementKey()
    const accepted = await this.dequeueAdmissiblePendingPrefix({
      providerTurnKey,
      requireProviderAcknowledged: input?.requireProviderAcknowledged,
    })
    if (accepted.length === 0) {
      return undefined
    }

    return withProviderAcknowledgement(
      accepted
        .map((item) => item.admission)
        .reduce(mergeAcceptedActiveTurnInputAdmissions),
      providerTurnKey !== null &&
        accepted.every((item) =>
          item.providerInputAcknowledgedTurnKey === providerTurnKey
        ),
    )
  }

  complete(result: AssistantAskResult): void {
    for (const completion of this.manualCompletions) {
      if (completion.accepted) {
        completion.resolve(result)
      } else {
        completion.reject(createAssistantActiveTurnNotActiveError())
      }
    }
  }

  fail(error: unknown): void {
    this.closed = true
    this.liveProviderTurn = null
    this.liveProviderTurnKey = null
    this.liveProviderTurnEnded = true
    for (const completion of this.manualCompletions) {
      completion.reject(error)
    }
  }

  private async admitAvailableInput(input: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    if (!this.input.admissionHook || this.closed) {
      return undefined
    }

    if (this.inputAvailableAdmission) {
      this.inputAvailableAdmissionRerunRequested = true
      return this.inputAvailableAdmission
    }

    const admission = this.runInputAvailableAdmissionLoop(input)
      .finally(() => {
        if (this.inputAvailableAdmission === admission) {
          this.inputAvailableAdmission = null
        }
      })
    this.inputAvailableAdmission = admission
    return admission
  }

  private async runInputAvailableAdmissionLoop(input: {
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    let acceptedResult: AssistantActiveTurnInputAdmissionResult | undefined
    let result: AssistantActiveTurnInputAdmissionResult | undefined

    do {
      this.inputAvailableAdmissionRerunRequested = false
      result = await this.runAdmissionHook(() => this.buildAdmissionInput(input))
      if (result?.kind === 'accepted') {
        acceptedResult = result
      }
    } while (
      this.inputAvailableAdmissionRerunRequested &&
      !this.closed &&
      this.input.admissionHook
    )

    return acceptedResult ?? result
  }

  private async runAdmissionHook(
    buildInput: () => AssistantActiveTurnInputAdmissionInput,
  ): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
    const previous = this.admissionHookQueue
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.admissionHookQueue = previous.then(() => current, () => current)

    await previous.catch(() => undefined)

    try {
      if (!this.input.admissionHook || this.closed) {
        return undefined
      }

      const result = await this.input.admissionHook(buildInput())
      const queued = await this.queueHookAdmission(result)
      if (result?.kind === 'accepted' && !queued) {
        return {
          kind: 'no-new-input',
        }
      }
      return result
    } finally {
      release()
    }
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
    signal?: AbortSignal
  }): AssistantActiveTurnInputAdmissionInput {
    return {
      ...this.resolveKnownAdmissionInput(),
      sessionId: this.input.sessionId,
      signal: input.signal,
      turnId: this.input.turnId,
      vault: this.input.vault,
    }
  }

  private async queueHookAdmission(
    result: AssistantActiveTurnInputAdmissionResult | undefined,
  ): Promise<boolean> {
    if (result?.kind !== 'accepted') {
      return true
    }

    if (this.liveProviderTurnEnded && !this.liveProviderTurn) {
      return false
    }

    await this.input.acceptedInputValidator?.({
      acceptedInputs: result.acceptedInputs ?? [],
    })
    const queued = {
      admission: normalizeAcceptedActiveTurnInputAdmission(result),
      providerInputAcknowledgedTurnKey: null,
    }
    this.pending.push(queued)
    this.tryStartLiveSteers()
    return true
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

  private resolveProviderAcknowledgementKey(): AssistantActiveTurnLiveProviderTurnKey | null {
    return this.liveProviderTurnKey ?? this.completedProviderTurnKey
  }

  private async dequeueAdmissiblePendingPrefix(input: {
    providerTurnKey: AssistantActiveTurnLiveProviderTurnKey | null
    requireProviderAcknowledged?: boolean
  }): Promise<QueuedAssistantActiveTurnInputAdmission[]> {
    const first = this.pending[0]
    if (!first) {
      return []
    }

    await first.providerInputAck?.catch(() => undefined)
    this.throwFatalAdmissionError()
    const providerInputAcknowledged =
      input.providerTurnKey !== null &&
      first.providerInputAcknowledgedTurnKey === input.providerTurnKey
    if (input.requireProviderAcknowledged === true && !providerInputAcknowledged) {
      return []
    }
    const accepted: QueuedAssistantActiveTurnInputAdmission[] = []
    const pendingLength = this.pending.length

    while (accepted.length < pendingLength) {
      const item = this.pending[accepted.length]
      if (!item) {
        break
      }

      await item.providerInputAck?.catch(() => undefined)
      this.throwFatalAdmissionError()
      const itemProviderInputAcknowledged =
        input.providerTurnKey !== null &&
        item.providerInputAcknowledgedTurnKey === input.providerTurnKey
      if (itemProviderInputAcknowledged !== providerInputAcknowledged) {
        break
      }

      accepted.push(item)
    }

    this.pending.splice(0, accepted.length)
    for (const item of accepted) {
      if (item.manualCompletion) {
        item.manualCompletion.accepted = true
      }
    }
    this.tryStartLiveSteers()
    return accepted
  }

  private tryStartLiveSteers(): void {
    const liveProviderTurn = this.liveProviderTurn
    const liveProviderTurnKey = this.liveProviderTurnKey
    if (this.closed || !liveProviderTurn || !liveProviderTurnKey) {
      return
    }

    for (const item of this.pending) {
      if (item.providerInputAcknowledgedTurnKey === liveProviderTurnKey) {
        continue
      }
      if (item.providerInputAck && item.providerInputAckTurnKey === liveProviderTurnKey) {
        return
      }

      item.providerInputAckTurnKey = liveProviderTurnKey
      item.providerInputAck = liveProviderTurn
        .steer({
          prompt: normalizeNullableString(item.admission.prompt) ?? '',
          userMessageContent: item.admission.userMessageContent ?? null,
        })
        .then(() => {
          if (
            !this.closed &&
            item.providerInputAckTurnKey === liveProviderTurnKey
          ) {
            item.providerInputAcknowledgedTurnKey = liveProviderTurnKey
          }
          this.tryStartLiveSteers()
          return item.providerInputAcknowledgedTurnKey === liveProviderTurnKey
        })
        .catch(async (error: unknown) => {
          await this.handleLiveProviderSteerError({
            error,
            item,
            liveProviderTurn,
            liveProviderTurnKey,
          })
          return false
        })
      return
    }
  }

  private async handleLiveProviderSteerError(input: {
    error: unknown
    item: QueuedAssistantActiveTurnInputAdmission
    liveProviderTurn: AssistantActiveTurnLiveProviderTurn
    liveProviderTurnKey: AssistantActiveTurnLiveProviderTurnKey
  }): Promise<void> {
    if (this.closed) {
      return
    }

    if (
      this.liveProviderTurn !== null &&
      this.liveProviderTurn !== input.liveProviderTurn
    ) {
      if (input.item.providerInputAckTurnKey === input.liveProviderTurnKey) {
        input.item.providerInputAck = null
        input.item.providerInputAckTurnKey = null
      }
      this.tryStartLiveSteers()
      return
    }

    if (
      this.liveProviderTurn === null &&
      this.completedProviderTurnKey === input.liveProviderTurnKey &&
      isCodexLiveTurnInactiveError(input.error)
    ) {
      if (input.item.providerInputAckTurnKey === input.liveProviderTurnKey) {
        input.item.providerInputAck = null
        input.item.providerInputAckTurnKey = null
        input.item.providerInputAcknowledgedTurnKey = null
      }
      return
    }

    const shouldInterrupt = this.liveProviderTurn === input.liveProviderTurn
    this.fatalAdmissionError = input.error
    this.fail(input.error)
    if (shouldInterrupt) {
      await input.liveProviderTurn.interrupt().catch(() => undefined)
    }
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
  conversationKeys?: readonly string[] | null
  eventAdmissionEnabled?: boolean
  sessionId: string
  turnId: string
  vault: string
}): {
  admitAvailable(input?: {
    probeIfIdle?: boolean
    signal?: AbortSignal
  }): Promise<AssistantActiveTurnInputAdmissionResult | undefined>
  admitLiveSteered(): Promise<AssistantActiveTurnInputAdmissionResult | undefined>
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
    eventAdmissionEnabled: input.eventAdmissionEnabled,
    sessionId: input.sessionId,
    turnId: input.turnId,
    vault: input.vault,
  })
  for (const key of keys) {
    activeTurnInputControllers.set(key, controller)
  }
  let disposed = false
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    for (const key of keys) {
      if (activeTurnInputControllers.get(key) === controller) {
        activeTurnInputControllers.delete(key)
      }
    }
  }

  return {
    admitAvailable: (input) => controller.admitAvailable(input),
    admitLiveSteered: () => controller.admitLiveSteered(),
    close() {
      controller.close()
      dispose()
    },
    complete: (result) => controller.complete(result),
    fail(error) {
      controller.fail(error)
      dispose()
    },
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

function formatAssistantActiveTurnLiveProviderTurnKey(
  input: Pick<AssistantActiveTurnLiveProviderTurn, 'codexThreadId' | 'providerTurnId'>,
): AssistantActiveTurnLiveProviderTurnKey {
  return `${input.codexThreadId}\u0000${input.providerTurnId}`
}

function createAssistantActiveTurnManualInputCompletion(): AssistantActiveTurnManualInputCompletion {
  let settled = false
  let rejectCompletion!: (error: unknown) => void
  let resolveCompletion!: (result: AssistantAskResult) => void
  const promise = new Promise<AssistantAskResult>((resolve, reject) => {
    rejectCompletion = reject
    resolveCompletion = resolve
  })
  return {
    accepted: false,
    promise,
    reject(error) {
      if (settled) {
        return
      }
      settled = true
      rejectCompletion(error)
    },
    resolve(result) {
      if (settled) {
        return
      }
      settled = true
      resolveCompletion(result)
    },
  }
}

export function createAssistantActiveTurnNotActiveError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
    'Manual active-turn input targeted a turn that is no longer active.',
  )
}

function isCodexLiveTurnInactiveError(error: unknown): boolean {
  return readErrorCode(error) === 'ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE'
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function mergeAssistantActiveTurnInputAdmissions(
  first: Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
  second: AssistantActiveTurnInputAdmissionResult | undefined,
): Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }> {
  if (second?.kind !== 'accepted') {
    return first
  }

  const deliveryTarget =
    second.deliveryTarget === undefined
      ? first.deliveryTarget
      : second.deliveryTarget
  const deliveryDispatchMode =
    second.deliveryDispatchMode === undefined
      ? first.deliveryDispatchMode
      : second.deliveryDispatchMode
  const deliverySource =
    second.deliverySource === undefined
      ? first.deliverySource
      : second.deliverySource
  const deliverySubject =
    second.deliverySubject === undefined
      ? first.deliverySubject
      : second.deliverySubject
  const hostedDeliveryIdempotency =
    second.hostedDeliveryIdempotency === undefined
      ? first.hostedDeliveryIdempotency
      : second.hostedDeliveryIdempotency

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
    ...(deliveryDispatchMode === undefined ? {} : { deliveryDispatchMode }),
    ...(deliverySource === undefined ? {} : { deliverySource }),
    ...(deliverySubject === undefined ? {} : { deliverySubject }),
    ...(deliveryTarget === undefined ? {} : { deliveryTarget }),
    ...(hostedDeliveryIdempotency === undefined
      ? {}
      : { hostedDeliveryIdempotency }),
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

function normalizeAcceptedActiveTurnInputAdmission(
  admission: Extract<AssistantActiveTurnInputAdmissionResult, { kind: 'accepted' }>,
): AssistantAcceptedActiveTurnInputAdmission {
  const {
    acceptedInputs,
    providerAlreadySteered: _providerAlreadySteered,
    ...rest
  } = admission
  return {
    ...rest,
    acceptedInputs: [...(acceptedInputs ?? [])],
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
    ...(input.input.deliveryDispatchMode === undefined
      ? {}
      : { deliveryDispatchMode: input.input.deliveryDispatchMode }),
    ...(input.input.deliveryIdempotencyKey === undefined
      ? {}
      : { deliveryIdempotencyKey: input.input.deliveryIdempotencyKey }),
    ...(input.input.deliverySource === undefined
      ? {}
      : { deliverySource: input.input.deliverySource }),
    ...(input.input.deliverySubject === undefined
      ? {}
      : { deliverySubject: input.input.deliverySubject }),
    ...(input.input.deliveryTarget === undefined
      ? {}
      : { deliveryTarget: input.input.deliveryTarget }),
    ...(input.input.hostedDeliveryIdempotency === undefined
      ? {}
      : { hostedDeliveryIdempotency: input.input.hostedDeliveryIdempotency }),
    kind: 'accepted',
    prompt: normalizeNullableString(input.input.prompt) ?? '',
    transcriptText: null,
    userMessageContent: buildQueuedActiveTurnUserMessageContent([input.input]),
  }
}
