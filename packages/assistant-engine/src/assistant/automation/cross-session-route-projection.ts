import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeAssistantOpaqueId } from '@murphai/runtime-state/assistant-ids'
import {
  conversationRefFromAssistantInputConversation,
  type AssistantInputConversationRef,
} from '../conversation-ref.js'
import { readAssistantTargetProviderScalar } from '../message-target-selection.js'
import { hasAssistantOutboxDeliveryEvidence } from '../response-media.js'
import { normalizeNullableString } from '../shared.js'
import {
  buildAssistantAutoReplyExactRoute,
  compareAssistantAutoReplyDeliveryOrders,
  normalizeAssistantAutoReplyRouteChannel,
  readAssistantAutoReplyOutboxDeliveryOrder,
  resolveAssistantAutoReplyActorScope,
  resolveAssistantAutoReplyInputExactRoute,
  resolveAssistantAutoReplyOutboxExactRoute,
  type AssistantAutoReplyDeliveryOrder,
} from './cross-session-route-state.js'

export const ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND =
  'murph.assistant-auto-reply.latest-eligible-route.v1'
export const ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT = 32

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SUPPORTED_ROUTE_CHANNELS = new Set(['email', 'linq', 'telegram'])

type AssistantAutoReplyOutboxMessageDelivery = Extract<
  NonNullable<AssistantOutboxIntent['delivery']>,
  { kind?: 'message' }
>

export interface AssistantAutoReplyRouteProjectionQuery {
  expectedExactRouteDigest: string
  lookupKey: string
}

export interface AssistantAutoReplyRouteProjectionMembership {
  expectedExactRouteDigest: string
  lookupKey: string
}

export interface AssistantAutoReplyRouteCandidateV1 {
  exactRouteDigest: string | null
  intentId: string
  order: AssistantAutoReplyDeliveryOrder
}

export interface AssistantAutoReplyRouteOmittedSummaryV1 {
  hasExactRouteMismatch: boolean
  newestOrder: AssistantAutoReplyDeliveryOrder
  oldestOrder: AssistantAutoReplyDeliveryOrder
}

export interface AssistantAutoReplyRouteProjectionV1 {
  candidates: AssistantAutoReplyRouteCandidateV1[]
  expectedExactRouteDigest: string
  omitted: AssistantAutoReplyRouteOmittedSummaryV1 | null
  state: 'complete' | 'degraded'
}

export interface AssistantAutoReplyRouteProjectionIntentMembership {
  candidate: AssistantAutoReplyRouteCandidateV1
  membership: AssistantAutoReplyRouteProjectionMembership
}

export type AssistantAutoReplyRouteProjectionReadProof =
  | {
      causalUpperBoundMs: number
      inputTimeMs: number
      kind: 'echo'
      maxDeltaMs: number
    }
  | {
      causalUpperBoundMs: number
      excludedSessionId: string | null
      kind: 'history' | 'latest'
      settledThrough: AssistantAutoReplyDeliveryOrder | null
    }

export function resolveAssistantAutoReplyRouteProjectionQuery(input: {
  conversation: AssistantInputConversationRef
  deliveryTarget: string | null
}): AssistantAutoReplyRouteProjectionQuery | null {
  const channel = normalizeAssistantAutoReplyRouteChannel(input.conversation.source)
  if (!channel || !SUPPORTED_ROUTE_CHANNELS.has(channel)) {
    return null
  }
  const strictRoute = resolveAssistantAutoReplyInputExactRoute(input)
  if (!strictRoute) {
    return null
  }

  if (channel === 'linq') {
    const target = readAssistantTargetProviderScalar(input.deliveryTarget)
    return target
      ? {
          expectedExactRouteDigest: strictRoute.digest,
          lookupKey: buildRouteLookupKey(['linq', target]),
        }
      : null
  }

  const actorScope = resolveAssistantAutoReplyActorScope({
    actorId: input.conversation.actorId,
    channel,
    threadIsDirect: input.conversation.threadIsDirect,
  })
  const threadId = normalizeNullableString(input.conversation.threadId)
  if (!actorScope || !threadId) {
    return null
  }

  if (channel === 'email') {
    const identityId = normalizeNullableString(input.conversation.accountId)
    return identityId
      ? {
          expectedExactRouteDigest: strictRoute.digest,
          lookupKey: buildRouteLookupKey([
            'email',
            identityId,
            actorScope,
            threadId,
          ]),
        }
      : null
  }

  const target = readAssistantTargetProviderScalar(input.deliveryTarget)
  return target
    ? {
        expectedExactRouteDigest: strictRoute.digest,
        lookupKey: buildRouteLookupKey([
          'channel',
          channel,
          actorScope,
          threadId,
          target,
        ]),
      }
    : null
}

export function resolveAssistantAutoReplyRouteProjectionMemberships(
  intent: AssistantOutboxIntent,
): readonly AssistantAutoReplyRouteProjectionMembership[] {
  if (intent.operation !== null) {
    return []
  }
  const delivery = intent.delivery
  if (!delivery || delivery.kind === 'message-reaction') {
    return []
  }
  const channel = normalizeAssistantAutoReplyRouteChannel(delivery.channel)
  if (!channel || !SUPPORTED_ROUTE_CHANNELS.has(channel)) {
    return []
  }

  const targets = uniqueProviderScalars([
    delivery.target,
    delivery.providerThreadId,
  ])
  if (channel === 'linq') {
    return targets.map((target) => ({
      expectedExactRouteDigest: buildAssistantAutoReplyExactRoute([
        'linq',
        target,
      ]).digest,
      lookupKey: buildRouteLookupKey(['linq', target]),
    }))
  }

  const threadId = normalizeNullableString(intent.threadId)
  if (!threadId) {
    return []
  }
  if (channel === 'email') {
    const identityId = normalizeNullableString(intent.identityId)
    const actorScope = resolveAssistantAutoReplyActorScope({
      actorId: intent.actorId,
      channel,
      threadIsDirect: intent.threadIsDirect,
    })
    if (!identityId || !actorScope) {
      return []
    }
    return [{
      expectedExactRouteDigest: buildAssistantAutoReplyExactRoute([
        'email',
        identityId,
        actorScope,
        threadId,
      ]).digest,
      lookupKey: buildRouteLookupKey([
        'email',
        identityId,
        actorScope,
        threadId,
      ]),
    }]
  }

  const actorId = normalizeNullableString(intent.actorId)
  const scopes = new Set<string>()
  if (actorId) {
    scopes.add(actorId)
  }
  if (intent.threadIsDirect === true) {
    // The existing exact-route policy intentionally represents an actorless,
    // positively-direct Telegram input as @direct. Publishing that wildcard
    // partition preserves broad matching without moving policy into storage.
    scopes.add('@direct')
  }
  return targets.flatMap((target) =>
    [...scopes].map((actorScope) => ({
      expectedExactRouteDigest: buildAssistantAutoReplyExactRoute([
        'channel',
        channel,
        actorScope,
        threadId,
        target,
      ]).digest,
      lookupKey: buildRouteLookupKey([
        'channel',
        channel,
        actorScope,
        threadId,
        target,
      ]),
    })),
  )
}

export function resolveAssistantAutoReplyRouteProjectionIntentMemberships(
  intent: AssistantOutboxIntent,
): readonly AssistantAutoReplyRouteProjectionIntentMembership[] {
  if (!isAssistantAutoReplyRouteTailEligible(intent)) {
    return []
  }
  const order = readAssistantAutoReplyOutboxDeliveryOrder(intent)
  if (!order) {
    return []
  }
  const candidate: AssistantAutoReplyRouteCandidateV1 = {
    exactRouteDigest:
      resolveAssistantAutoReplyOutboxExactRoute(intent)?.digest ?? null,
    intentId: intent.intentId,
    order,
  }
  return resolveAssistantAutoReplyRouteProjectionMemberships(intent).map(
    (membership) => ({ candidate, membership }),
  )
}

export function isAssistantAutoReplyRouteTailEligible(
  intent: AssistantOutboxIntent,
): boolean {
  if (
    intent.operation !== null ||
    !hasAssistantOutboxDeliveryEvidence(intent, false) ||
    normalizeNullableString(intent.message) === null
  ) {
    return false
  }
  const delivery = intent.delivery
  return Boolean(
    delivery &&
    delivery.kind !== 'message-reaction' &&
    readAssistantAutoReplyOutboxDeliveryOrder(intent) &&
    resolveAssistantAutoReplyRouteProjectionMemberships(intent).length > 0,
  )
}

export function assistantAutoReplyOutboxMatchesInput(input: {
  conversation: AssistantInputConversationRef
  delivery: AssistantAutoReplyOutboxMessageDelivery
  deliveryTarget: string
  intent: AssistantOutboxIntent
}): boolean {
  const exactTargetMatch = assistantAutoReplyOutboxDeliveryMatchesExactTarget({
    delivery: input.delivery,
    deliveryTarget: input.deliveryTarget,
  })
  if (
    normalizeNullableString(input.delivery.channel) === 'linq' &&
    exactTargetMatch
  ) {
    return true
  }

  return assistantAutoReplyOutboxIntentMatchesConversation({
    conversation: input.conversation,
    intent: input.intent,
  }) && (
    exactTargetMatch ||
    assistantAutoReplyOutboxDeliveryMatchesStableConversationFallback({
      conversation: input.conversation,
      delivery: input.delivery,
      intent: input.intent,
    })
  )
}

export function upsertAssistantAutoReplyRouteProjectionCandidate(input: {
  candidate: AssistantAutoReplyRouteCandidateV1
  current: AssistantAutoReplyRouteProjectionV1 | null
  membership: AssistantAutoReplyRouteProjectionMembership
}): AssistantAutoReplyRouteProjectionV1 {
  const current = input.current ?? {
    candidates: [],
    expectedExactRouteDigest: input.membership.expectedExactRouteDigest,
    omitted: null,
    state: 'complete' as const,
  }
  if (
    current.expectedExactRouteDigest !==
    input.membership.expectedExactRouteDigest
  ) {
    throw new TypeError(
      'Assistant auto-reply route projection partition has conflicting exact-route policy.',
    )
  }
  const candidates = [
    ...current.candidates.filter(
      (candidate) => candidate.intentId !== input.candidate.intentId,
    ),
    input.candidate,
  ].sort((left, right) =>
    compareAssistantAutoReplyDeliveryOrders(left.order, right.order),
  )
  let omitted = current.omitted
  while (candidates.length > ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT) {
    const dropped = candidates.shift()!
    omitted = mergeAssistantAutoReplyRouteOmittedCandidate({
      candidate: dropped,
      expectedExactRouteDigest: current.expectedExactRouteDigest,
      omitted,
    })
  }
  return {
    candidates,
    expectedExactRouteDigest: current.expectedExactRouteDigest,
    omitted,
    // Once a candidate is compacted away, the route record is no longer a
    // complete inventory. Readers may still use the bounded tail when the
    // omitted order/mismatch summary proves the specific history/latest/echo
    // query is unaffected; otherwise they fall back to canonical history.
    state: omitted === null ? current.state : 'degraded',
  }
}

export function removeAssistantAutoReplyRouteProjectionCandidate(input: {
  current: AssistantAutoReplyRouteProjectionV1
  intentId: string
}): AssistantAutoReplyRouteProjectionV1 | null {
  const candidates = input.current.candidates.filter(
    (candidate) => candidate.intentId !== input.intentId,
  )
  return candidates.length === 0 && input.current.omitted === null
    ? null
    : {
        ...input.current,
        candidates,
      }
}

export function isAssistantAutoReplyRouteProjectionSufficientForRead(input: {
  intentsById: ReadonlyMap<string, AssistantOutboxIntent>
  projection: AssistantAutoReplyRouteProjectionV1
  proof: AssistantAutoReplyRouteProjectionReadProof
}): boolean {
  if (input.projection.state === 'complete') {
    return true
  }
  const omitted = input.projection.omitted
  if (!omitted) {
    return false
  }
  const proof = input.proof
  if (proof.kind === 'echo') {
    const lowerBoundMs = proof.inputTimeMs - proof.maxDeltaMs
    const upperBoundMs = Math.min(
      proof.causalUpperBoundMs,
      proof.inputTimeMs + proof.maxDeltaMs,
    )
    const omittedOldestMs = Date.parse(omitted.oldestOrder.sentAt)
    const omittedNewestMs = Date.parse(omitted.newestOrder.sentAt)
    return omittedNewestMs < lowerBoundMs || omittedOldestMs > upperBoundMs
  }

  const retainedFresh = input.projection.candidates.filter((candidate) => {
    const intent = input.intentsById.get(candidate.intentId)
    return intent !== undefined &&
      (
        proof.excludedSessionId === null ||
        intent.sessionId !== proof.excludedSessionId
      ) &&
      Date.parse(candidate.order.sentAt) <= proof.causalUpperBoundMs
  })
  if (retainedFresh.some((candidate) =>
    candidate.exactRouteDigest !== input.projection.expectedExactRouteDigest,
  )) {
    // The canonical scan would fail closed on this retained mismatch before
    // considering either the watermark or any omitted older candidate.
    return true
  }

  const omittedOldestMs = Date.parse(omitted.oldestOrder.sentAt)
  if (omittedOldestMs > proof.causalUpperBoundMs) {
    return true
  }
  if (omitted.hasExactRouteMismatch) {
    return false
  }
  if (proof.kind === 'history') {
    // A history reader needs every fresh post-watermark candidate, not only the
    // newest one. The compacted tail is complete for that query only when all
    // omitted candidates are already settled; otherwise canonical authority
    // must supply the omitted context.
    return proof.settledThrough !== null &&
      compareAssistantAutoReplyDeliveryOrders(
        omitted.newestOrder,
        proof.settledThrough,
      ) <= 0
  }

  const retainedSelected = retainedFresh.some((candidate) =>
    proof.settledThrough === null ||
    compareAssistantAutoReplyDeliveryOrders(
      candidate.order,
      proof.settledThrough,
    ) > 0,
  )
  if (retainedSelected) {
    // Every omitted candidate is strictly older than every retained candidate,
    // so an eligible retained candidate determines the same latest result.
    return true
  }
  return proof.settledThrough !== null &&
    compareAssistantAutoReplyDeliveryOrders(
      omitted.newestOrder,
      proof.settledThrough,
    ) <= 0
}

export function parseAssistantAutoReplyRouteProjection(
  value: unknown,
): AssistantAutoReplyRouteProjectionV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'candidates',
    'expectedExactRouteDigest',
    'omitted',
    'state',
  ])) {
    throw new TypeError('Assistant auto-reply route projection must be a strict object.')
  }
  if (value.state !== 'complete' && value.state !== 'degraded') {
    throw new TypeError('Assistant auto-reply route projection state is invalid.')
  }
  const expectedExactRouteDigest = parseRouteDigest(
    value.expectedExactRouteDigest,
  )
  if (!Array.isArray(value.candidates)) {
    throw new TypeError('Assistant auto-reply route candidates must be an array.')
  }
  if (value.candidates.length > ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT) {
    throw new TypeError('Assistant auto-reply route tail exceeds its fixed limit.')
  }
  const candidates = value.candidates.map(parseAssistantAutoReplyRouteCandidate)
  if (
    new Set(candidates.map((candidate) => candidate.intentId)).size !==
      candidates.length ||
    candidates.some((candidate, index) =>
      index > 0 &&
      compareAssistantAutoReplyDeliveryOrders(
        candidates[index - 1]!.order,
        candidate.order,
      ) >= 0,
    )
  ) {
    throw new TypeError(
      'Assistant auto-reply route candidates must be strictly ordered and unique.',
    )
  }
  const omitted = value.omitted === null
    ? null
    : parseAssistantAutoReplyRouteOmittedSummary(value.omitted)
  if (
    omitted &&
    candidates[0] &&
    compareAssistantAutoReplyDeliveryOrders(
      omitted.newestOrder,
      candidates[0].order,
    ) >= 0
  ) {
    throw new TypeError(
      'Assistant auto-reply omitted route range must precede retained candidates.',
    )
  }
  if (
    (value.state === 'complete' && omitted !== null) ||
    (value.state === 'degraded' && omitted === null)
  ) {
    throw new TypeError(
      'Assistant auto-reply route projection completeness is inconsistent.',
    )
  }
  return {
    candidates,
    expectedExactRouteDigest,
    omitted,
    state: value.state,
  }
}

function parseAssistantAutoReplyRouteCandidate(
  value: unknown,
): AssistantAutoReplyRouteCandidateV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'exactRouteDigest',
    'intentId',
    'order',
  ])) {
    throw new TypeError('Assistant auto-reply route candidate must be a strict object.')
  }
  const intentId = parseStrictAssistantOpaqueId(
    value.intentId,
    'route candidate intent id',
  )
  const order = parseAssistantAutoReplyDeliveryOrder(value.order)
  if (intentId !== order.intentId) {
    throw new TypeError('Assistant auto-reply route candidate identity is invalid.')
  }
  return {
    exactRouteDigest:
      value.exactRouteDigest === null
        ? null
        : parseRouteDigest(value.exactRouteDigest),
    intentId,
    order,
  }
}

function parseAssistantAutoReplyRouteOmittedSummary(
  value: unknown,
): AssistantAutoReplyRouteOmittedSummaryV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'hasExactRouteMismatch',
    'newestOrder',
    'oldestOrder',
  ])) {
    throw new TypeError(
      'Assistant auto-reply omitted route summary must be a strict object.',
    )
  }
  if (typeof value.hasExactRouteMismatch !== 'boolean') {
    throw new TypeError(
      'Assistant auto-reply omitted route mismatch flag must be boolean.',
    )
  }
  const oldestOrder = parseAssistantAutoReplyDeliveryOrder(value.oldestOrder)
  const newestOrder = parseAssistantAutoReplyDeliveryOrder(value.newestOrder)
  if (compareAssistantAutoReplyDeliveryOrders(oldestOrder, newestOrder) > 0) {
    throw new TypeError('Assistant auto-reply omitted route order range is invalid.')
  }
  return {
    hasExactRouteMismatch: value.hasExactRouteMismatch,
    newestOrder,
    oldestOrder,
  }
}

function parseAssistantAutoReplyDeliveryOrder(
  value: unknown,
): AssistantAutoReplyDeliveryOrder {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['intentId', 'sentAt'])) {
    throw new TypeError('Assistant auto-reply delivery order must be a strict object.')
  }
  const intentId = parseStrictAssistantOpaqueId(
    value.intentId,
    'delivery-order intent id',
  )
  const sentAt = parseStrictNonemptyString(value.sentAt)
  if (!sentAt || !Number.isFinite(Date.parse(sentAt))) {
    throw new TypeError('Assistant auto-reply delivery order is invalid.')
  }
  return { intentId, sentAt }
}

function mergeAssistantAutoReplyRouteOmittedCandidate(input: {
  candidate: AssistantAutoReplyRouteCandidateV1
  expectedExactRouteDigest: string
  omitted: AssistantAutoReplyRouteOmittedSummaryV1 | null
}): AssistantAutoReplyRouteOmittedSummaryV1 {
  const mismatch = input.candidate.exactRouteDigest !==
    input.expectedExactRouteDigest
  if (!input.omitted) {
    return {
      hasExactRouteMismatch: mismatch,
      newestOrder: input.candidate.order,
      oldestOrder: input.candidate.order,
    }
  }
  return {
    hasExactRouteMismatch:
      input.omitted.hasExactRouteMismatch || mismatch,
    newestOrder:
      compareAssistantAutoReplyDeliveryOrders(
        input.omitted.newestOrder,
        input.candidate.order,
      ) >= 0
        ? input.omitted.newestOrder
        : input.candidate.order,
    oldestOrder:
      compareAssistantAutoReplyDeliveryOrders(
        input.omitted.oldestOrder,
        input.candidate.order,
      ) <= 0
        ? input.omitted.oldestOrder
        : input.candidate.order,
  }
}

function assistantAutoReplyOutboxIntentMatchesConversation(input: {
  conversation: AssistantInputConversationRef
  intent: AssistantOutboxIntent
}): boolean {
  const conversation = conversationRefFromAssistantInputConversation(
    input.conversation,
  )
  return routeValueMatches({
    actual: input.intent.identityId,
    expected: conversation.identityId,
  }) && routeValueMatches({
    actual: input.intent.actorId,
    expected: conversation.participantId,
  }) && routeValueMatches({
    actual: input.intent.threadId,
    expected: conversation.threadId,
  })
}

function assistantAutoReplyOutboxDeliveryMatchesExactTarget(input: {
  delivery: AssistantAutoReplyOutboxMessageDelivery
  deliveryTarget: string
}): boolean {
  return [input.delivery.target, input.delivery.providerThreadId].some(
    (candidate) =>
      normalizeNullableString(candidate) === input.deliveryTarget,
  )
}

function assistantAutoReplyOutboxDeliveryMatchesStableConversationFallback(input: {
  conversation: AssistantInputConversationRef
  delivery: AssistantAutoReplyOutboxMessageDelivery
  intent: AssistantOutboxIntent
}): boolean {
  const channel = normalizeNullableString(input.delivery.channel)
  const threadId = normalizeNullableString(input.conversation.threadId)
  return channel === 'email' &&
    threadId !== null &&
    normalizeNullableString(input.intent.threadId) === threadId
}

function routeValueMatches(input: {
  actual: string | null | undefined
  expected: string | null | undefined
}): boolean {
  const expected = normalizeNullableString(input.expected)
  return expected === null || normalizeNullableString(input.actual) === expected
}

function uniqueProviderScalars(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(
    values
      .map((value) => readAssistantTargetProviderScalar(value))
      .filter((value): value is string => value !== null),
  )]
}

function buildRouteLookupKey(components: readonly string[]): string {
  return JSON.stringify([
    'murph.assistant-auto-reply-route-lookup.v1',
    ...components,
  ])
}

function parseRouteDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError('Assistant auto-reply exact route digest is invalid.')
  }
  return value
}

function parseStrictAssistantOpaqueId(
  value: unknown,
  label: string,
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Assistant auto-reply ${label} is invalid.`)
  }
  const normalized = normalizeAssistantOpaqueId(value)
  if (normalized === null || normalized !== value) {
    throw new TypeError(`Assistant auto-reply ${label} is invalid.`)
  }
  return value
}

function parseStrictNonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
