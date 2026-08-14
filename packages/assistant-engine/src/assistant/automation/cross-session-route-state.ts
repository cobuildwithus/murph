import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type {
  AssistantOutboxIntent,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  ensureAssistantStateDir,
  readVersionedJsonStateFile,
  writeAssistantStateVersionedJson,
} from '@murphai/runtime-state/node'
import type { AssistantInputConversationRef } from '../conversation-ref.js'
import { readAssistantTargetProviderScalar } from '../message-target-selection.js'
import { hasAssistantOutboxDeliveryEvidence } from '../response-media.js'
import type {
  AssistantBeforeProviderAcceptedInputsHook,
  AssistantProviderAcceptedInputsRelease,
} from '../service-contracts.js'
import { isMissingFileError, normalizeNullableString } from '../shared.js'
import { ensureAssistantState } from '../store/persistence.js'
import type { AssistantStatePaths } from '../store/paths.js'
import { readAssistantTurnReceiptAtPaths } from '../turns.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import {
  AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY,
} from './auto-reply-retry.js'

const ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA =
  'murph.assistant-auto-reply-route-state'
const ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA_VERSION = 1
const ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA =
  'murph.assistant-auto-reply-route-migration'
const ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA_VERSION = 1
const ASSISTANT_AUTO_REPLY_ROUTE_DIGEST_PATTERN = /^[0-9a-f]{64}$/u

export interface AssistantAutoReplyDeliveryOrder {
  intentId: string
  sentAt: string
}

export interface AssistantAutoReplyExactRoute {
  digest: string
}

export interface AssistantAutoReplyRouteClaimContext {
  anchored: boolean
  order: AssistantAutoReplyDeliveryOrder
  routeDigest: string
}

export interface AssistantAutoReplyRouteStateValue {
  pending: {
    acceptedThrough: AssistantAutoReplyDeliveryOrder | null
    order: AssistantAutoReplyDeliveryOrder
    turnId: string
  } | null
  settledThrough: AssistantAutoReplyDeliveryOrder | null
}

export type AssistantAutoReplyRouteReadResult =
  | {
      kind: 'blocked'
      reason:
        | 'corrupt-route-state'
        | 'missing-or-corrupt-receipt'
        | 'migration-incomplete'
        | 'running-receipt'
    }
  | {
      kind: 'ready'
      settledThrough: AssistantAutoReplyDeliveryOrder | null
    }

export interface AssistantAutoReplyRouteMaintenanceResult {
  trusted: boolean
}

interface AssistantAutoReplyRouteMigrationValue {
  completedAt: string
}

export interface AssistantAutoReplyRouteStateReadDependencies {
  readReceiptAtPaths(
    paths: AssistantStatePaths,
    turnId: string,
  ): Promise<AssistantTurnReceipt | null>
  writeRouteStateAtPaths(
    paths: AssistantStatePaths,
    routeDigest: string,
    state: AssistantAutoReplyRouteStateValue,
  ): Promise<void>
}

type AssistantAutoReplyOutboxMessageDelivery = Extract<
  NonNullable<AssistantOutboxIntent['delivery']>,
  { kind?: 'message' }
>

const DEFAULT_ROUTE_STATE_DEPENDENCIES: AssistantAutoReplyRouteStateReadDependencies = {
  readReceiptAtPaths: readAssistantTurnReceiptAtPaths,
  writeRouteStateAtPaths: writeAssistantAutoReplyRouteStateAtPaths,
}

export function compareAssistantAutoReplyDeliveryOrders(
  left: AssistantAutoReplyDeliveryOrder,
  right: AssistantAutoReplyDeliveryOrder,
): number {
  const leftMs = Date.parse(left.sentAt)
  const rightMs = Date.parse(right.sentAt)
  if (leftMs !== rightMs) {
    return leftMs - rightMs
  }
  return left.intentId.localeCompare(right.intentId)
}

export function resolveAssistantAutoReplyInputExactRoute(input: {
  conversation: AssistantInputConversationRef
  deliveryTarget: string | null
}): AssistantAutoReplyExactRoute | null {
  const channel = normalizeRouteChannel(input.conversation.source)
  if (!channel) {
    return null
  }

  if (channel === 'linq') {
    const providerThreadTarget = readAssistantTargetProviderScalar(
      input.deliveryTarget,
    )
    return providerThreadTarget
      ? buildAssistantAutoReplyExactRoute([
          'linq',
          providerThreadTarget,
        ])
      : null
  }

  const actorId = normalizeNullableString(input.conversation.actorId)
  const threadId = normalizeNullableString(input.conversation.threadId)
  if (!actorId || !threadId) {
    return null
  }

  if (channel === 'email') {
    const identityId = normalizeNullableString(input.conversation.accountId)
    return identityId
      ? buildAssistantAutoReplyExactRoute([
          'email',
          identityId,
          actorId,
          threadId,
        ])
      : null
  }

  const deliveryTarget = readAssistantTargetProviderScalar(
    input.deliveryTarget,
  )
  return deliveryTarget
    ? buildAssistantAutoReplyExactRoute([
        'channel',
        channel,
        actorId,
        threadId,
        deliveryTarget,
      ])
    : null
}

export function resolveAssistantAutoReplyOutboxExactRoute(
  intent: AssistantOutboxIntent,
): AssistantAutoReplyExactRoute | null {
  if (intent.operation !== null) {
    return null
  }
  const delivery = intent.delivery
  if (!delivery || delivery.kind === 'message-reaction') {
    return null
  }

  const channel = normalizeRouteChannel(delivery.channel)
  if (!channel) {
    return null
  }

  if (channel === 'linq') {
    const providerThreadTarget = resolveExactLinqProviderThreadTarget(delivery)
    return providerThreadTarget
      ? buildAssistantAutoReplyExactRoute([
          'linq',
          providerThreadTarget,
        ])
      : null
  }

  const actorId = normalizeNullableString(intent.actorId)
  const threadId = normalizeNullableString(intent.threadId)
  if (!actorId || !threadId) {
    return null
  }

  if (channel === 'email') {
    const identityId = normalizeNullableString(intent.identityId)
    return identityId
      ? buildAssistantAutoReplyExactRoute([
          'email',
          identityId,
          actorId,
          threadId,
        ])
      : null
  }

  const deliveryTarget = readAssistantTargetProviderScalar(delivery.target)
  return deliveryTarget
    ? buildAssistantAutoReplyExactRoute([
        'channel',
        channel,
        actorId,
        threadId,
        deliveryTarget,
      ])
    : null
}

export function readAssistantAutoReplyOutboxDeliveryOrder(
  intent: AssistantOutboxIntent,
): AssistantAutoReplyDeliveryOrder | null {
  const delivery = intent.delivery
  if (!delivery || delivery.kind === 'message-reaction') {
    return null
  }
  const intentId = normalizeNullableString(intent.intentId)
  const sentAt = normalizeNullableString(delivery.sentAt)
  return intentId && sentAt && Number.isFinite(Date.parse(sentAt))
    ? { intentId, sentAt }
    : null
}

export async function readAssistantAutoReplyRouteState(
  input: {
    routeDigest: string
    vault: string
  },
  dependencies: AssistantAutoReplyRouteStateReadDependencies =
    DEFAULT_ROUTE_STATE_DEPENDENCIES,
): Promise<AssistantAutoReplyRouteReadResult> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const migrationStatus =
      await readAssistantAutoReplyRouteMigrationStatusAtPaths(paths)
    if (migrationStatus !== 'complete') {
      return {
        kind: 'blocked',
        reason: 'migration-incomplete',
      }
    }

    const routeStateRead = await readAssistantAutoReplyRouteStateAtPaths(
      paths,
      input.routeDigest,
    )
    if (routeStateRead.kind === 'corrupt') {
      return {
        kind: 'blocked',
        reason: 'corrupt-route-state',
      }
    }
    const state = routeStateRead.kind === 'missing'
      ? createEmptyAssistantAutoReplyRouteState()
      : routeStateRead.state
    const reconciled = await reconcileAssistantAutoReplyPendingClaimAtPaths({
      dependencies,
      paths,
      state,
    })
    if (reconciled.kind === 'blocked') {
      return reconciled.result
    }

    if (reconciled.changed) {
      // The terminal receipt remains the commit witness. Folding is compacting
      // residue only: a failed fold leaves the in-memory watermark authoritative
      // for this read and the pending receipt protected by residue maintenance.
      await dependencies.writeRouteStateAtPaths(
        paths,
        input.routeDigest,
        reconciled.state,
      ).catch(() => undefined)
    }
    return {
      kind: 'ready',
      settledThrough: reconciled.state.settledThrough,
    }
  })
}

export async function claimAssistantAutoReplyRouteContext(
  input: {
    anchored: boolean
    order: AssistantAutoReplyDeliveryOrder
    routeDigest: string
    turnId: string
    vault: string
  },
  dependencies: AssistantAutoReplyRouteStateReadDependencies =
    DEFAULT_ROUTE_STATE_DEPENDENCIES,
): Promise<void> {
  assertAssistantAutoReplyDeliveryOrder(input.order)
  assertAssistantAutoReplyRouteDigest(input.routeDigest)
  const turnId = normalizeNullableString(input.turnId)
  if (!turnId) {
    throw new TypeError('Assistant auto-reply route claim requires a turn id.')
  }

  await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const consumingReceipt = await dependencies.readReceiptAtPaths(
      paths,
      turnId,
    )
    if (consumingReceipt?.status !== 'running') {
      throw new Error(
        'Assistant auto-reply route claim requires its consuming turn receipt to be running.',
      )
    }

    const migrationStatus =
      await readAssistantAutoReplyRouteMigrationStatusAtPaths(paths)
    if (migrationStatus === 'corrupt') {
      throw new Error(
        'Assistant auto-reply route migration state is malformed; provider start is blocked.',
      )
    }
    if (migrationStatus === 'missing' && !input.anchored) {
      throw new Error(
        'Assistant auto-reply route migration is incomplete; provider start is blocked.',
      )
    }

    const routeStateRead = await readAssistantAutoReplyRouteStateAtPaths(
      paths,
      input.routeDigest,
    )
    if (routeStateRead.kind === 'corrupt') {
      throw new Error(
        'Assistant auto-reply route state is malformed; provider start is blocked.',
      )
    }
    const currentState = routeStateRead.kind === 'missing'
      ? createEmptyAssistantAutoReplyRouteState()
      : routeStateRead.state
    if (currentState.pending?.turnId === turnId) {
      if (
        compareAssistantAutoReplyDeliveryOrders(
          currentState.pending.order,
          input.order,
        ) >= 0
      ) {
        return
      }
      await dependencies.writeRouteStateAtPaths(
        paths,
        input.routeDigest,
        {
          pending: {
            acceptedThrough: receiptRecordsCrossSessionContextIntent(
              consumingReceipt,
              currentState.pending.order.intentId,
            )
              ? maxAssistantAutoReplyDeliveryOrder(
                  currentState.pending.acceptedThrough,
                  currentState.pending.order,
                )
              : currentState.pending.acceptedThrough,
            order: input.order,
            turnId,
          },
          settledThrough: currentState.settledThrough,
        },
      )
      return
    }

    const reconciled = await reconcileAssistantAutoReplyPendingClaimAtPaths({
      dependencies,
      paths,
      state: currentState,
    })
    if (reconciled.kind === 'blocked') {
      throw new Error(
        'Assistant auto-reply route already has an unresolved consuming turn; provider start is blocked.',
      )
    }
    if (
      !input.anchored &&
      reconciled.state.settledThrough !== null &&
      compareAssistantAutoReplyDeliveryOrders(
        input.order,
        reconciled.state.settledThrough,
      ) <= 0
    ) {
      throw new Error(
        'Assistant auto-reply unanchored context is already settled; provider start is blocked.',
      )
    }

    await dependencies.writeRouteStateAtPaths(
      paths,
      input.routeDigest,
      {
        pending: {
          acceptedThrough: null,
          order: input.order,
          turnId,
        },
        settledThrough: reconciled.state.settledThrough,
      },
    )
  })
}

export function createAssistantAutoReplyRouteClaimHook(input: {
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null
  claim?: typeof claimAssistantAutoReplyRouteContext
  claims?: readonly AssistantAutoReplyRouteClaimContext[]
  resolveClaims?: (
    event: Parameters<AssistantBeforeProviderAcceptedInputsHook>[0],
  ) => readonly AssistantAutoReplyRouteClaimContext[]
  vault: string
}): AssistantBeforeProviderAcceptedInputsHook {
  const claim = input.claim ?? claimAssistantAutoReplyRouteContext
  return async (event) => {
    const release = await input.beforeProviderAcceptedInputs?.(event)
    try {
      const claims = mergeAssistantAutoReplyRouteClaims([
        ...(input.claims ?? []),
        ...(input.resolveClaims?.(event) ?? []),
      ])
      if (claims.length > 0) {
        const turnId = normalizeNullableString(event.turnId)
        if (!turnId) {
          throw new Error(
            'Assistant auto-reply route claim requires the consuming turn id at the provider boundary.',
          )
        }
        for (const routeClaim of claims) {
          await claim({
            anchored: routeClaim.anchored,
            order: routeClaim.order,
            routeDigest: routeClaim.routeDigest,
            turnId,
            vault: input.vault,
          })
        }
      }
    } catch (error) {
      await releaseAssistantProviderAcceptedInputsAfterClaimFailure({
        error,
        release,
      })
    }
    return release
  }
}

function mergeAssistantAutoReplyRouteClaims(
  claims: readonly AssistantAutoReplyRouteClaimContext[],
): AssistantAutoReplyRouteClaimContext[] {
  const claimsByRoute = new Map<string, AssistantAutoReplyRouteClaimContext>()
  for (const claim of claims) {
    assertAssistantAutoReplyDeliveryOrder(claim.order)
    assertAssistantAutoReplyRouteDigest(claim.routeDigest)
    const current = claimsByRoute.get(claim.routeDigest)
    const orderComparison = current === undefined
      ? 1
      : compareAssistantAutoReplyDeliveryOrders(claim.order, current.order)
    if (orderComparison > 0) {
      claimsByRoute.set(claim.routeDigest, claim)
      continue
    }
    if (orderComparison === 0 && claim.anchored && !current?.anchored) {
      claimsByRoute.set(claim.routeDigest, claim)
    }
  }
  if (claimsByRoute.size > 1) {
    throw new Error(
      'Assistant provider request cannot consume cross-session context from multiple exact routes.',
    )
  }
  return [...claimsByRoute.values()]
}

/** Reconcile only while the caller holds the runtime lock at a quiescent automation boundary. */
export async function maintainAssistantAutoReplyRouteStateAtPaths(input: {
  outboxIntents: readonly AssistantOutboxIntent[]
  outboxTrusted: boolean
  paths: AssistantStatePaths
  receipts: readonly AssistantTurnReceipt[]
  receiptsTrusted: boolean
}): Promise<AssistantAutoReplyRouteMaintenanceResult> {
  if (!input.outboxTrusted || !input.receiptsTrusted) {
    return {
      trusted: false,
    }
  }

  const migrationStatus =
    await readAssistantAutoReplyRouteMigrationStatusAtPaths(input.paths)
  if (migrationStatus === 'corrupt') {
    return {
      trusted: false,
    }
  }
  if (migrationStatus === 'missing') {
    await migrateAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: input.outboxIntents,
      paths: input.paths,
      receipts: input.receipts,
    })
  }

  const routesDirectory = resolveAssistantAutoReplyRoutesDirectory(input.paths)
  let entries: Dirent[]
  try {
    entries = await readdir(routesDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        trusted: true,
      }
    }
    throw error
  }

  const receiptsByTurnId = new Map<string, AssistantTurnReceipt>()
  for (const receipt of input.receipts) {
    receiptsByTurnId.set(receipt.turnId, receipt)
  }
  const liveRouteDigests = new Set(
    input.outboxIntents.flatMap((intent) => {
      if (!hasAssistantOutboxDeliveryEvidence(intent)) {
        return []
      }
      const route = resolveAssistantAutoReplyOutboxExactRoute(intent)
      return route ? [route.digest] : []
    }),
  )
  let trusted = true
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.json') ||
      !ASSISTANT_AUTO_REPLY_ROUTE_DIGEST_PATTERN.test(
        entry.name.slice(0, -'.json'.length),
      )
    ) {
      trusted = false
      continue
    }
    const routeDigest = entry.name.slice(0, -'.json'.length)
    const routeStateRead = await readAssistantAutoReplyRouteStateAtPaths(
      input.paths,
      routeDigest,
    )
    if (routeStateRead.kind !== 'valid') {
      if (!liveRouteDigests.has(routeDigest)) {
        await removeAssistantAutoReplyRouteStateFile(
          resolveAssistantAutoReplyRouteStatePath(input.paths, routeDigest),
        )
        continue
      }
      trusted = false
      continue
    }
    const pending = routeStateRead.state.pending
    if (!liveRouteDigests.has(routeDigest)) {
      await removeAssistantAutoReplyRouteStateFile(
        resolveAssistantAutoReplyRouteStatePath(input.paths, routeDigest),
      )
      continue
    }
    if (!pending) {
      continue
    }
    const receipt = receiptsByTurnId.get(pending.turnId) ??
      await readAssistantTurnReceiptAtPaths(input.paths, pending.turnId)
    const reconciled = reconcileAssistantAutoReplyPendingClaim({
      receipt,
      state: routeStateRead.state,
    })
    if (reconciled.kind === 'blocked') {
      await writeAssistantAutoReplyRouteStateAtPaths(
        input.paths,
        routeDigest,
        {
          pending: null,
          settledThrough: maxAssistantAutoReplyDeliveryOrder(
            routeStateRead.state.settledThrough,
            pending.order,
          ),
        },
      )
      continue
    }
    if (reconciled.changed) {
      if (
        reconciled.state.pending === null &&
        !liveRouteDigests.has(routeDigest)
      ) {
        await removeAssistantAutoReplyRouteStateFile(
          resolveAssistantAutoReplyRouteStatePath(input.paths, routeDigest),
        )
      } else {
        await writeAssistantAutoReplyRouteStateAtPaths(
          input.paths,
          routeDigest,
          reconciled.state,
        )
      }
    }
  }

  return {
    trusted,
  }
}

async function removeAssistantAutoReplyRouteStateFile(
  filePath: string,
): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

export function resolveAssistantAutoReplyRouteStatePath(
  paths: AssistantStatePaths,
  routeDigest: string,
): string {
  assertAssistantAutoReplyRouteDigest(routeDigest)
  return path.join(
    resolveAssistantAutoReplyRoutesDirectory(paths),
    `${routeDigest}.json`,
  )
}

export function resolveAssistantAutoReplyRouteMigrationPath(
  paths: AssistantStatePaths,
): string {
  return path.join(
    resolveAssistantAutoReplyRootDirectory(paths),
    'route-state-migration.json',
  )
}

async function releaseAssistantProviderAcceptedInputsAfterClaimFailure(input: {
  error: unknown
  release: AssistantProviderAcceptedInputsRelease | void
}): Promise<never> {
  try {
    await input.release?.()
  } catch (releaseError) {
    throw new AggregateError(
      [input.error, releaseError],
      'Assistant auto-reply route claim and provider-input release both failed.',
    )
  }
  throw input.error
}

async function reconcileAssistantAutoReplyPendingClaimAtPaths(input: {
  dependencies: AssistantAutoReplyRouteStateReadDependencies
  paths: AssistantStatePaths
  state: AssistantAutoReplyRouteStateValue
}): Promise<
  | {
      kind: 'blocked'
      result: Extract<AssistantAutoReplyRouteReadResult, { kind: 'blocked' }>
    }
  | {
      changed: boolean
      kind: 'ready'
      state: AssistantAutoReplyRouteStateValue
    }
> {
  const pending = input.state.pending
  if (!pending) {
    return {
      changed: false,
      kind: 'ready',
      state: input.state,
    }
  }
  const receipt = await input.dependencies.readReceiptAtPaths(
    input.paths,
    pending.turnId,
  )
  return reconcileAssistantAutoReplyPendingClaim({
    receipt,
    state: input.state,
  })
}

function reconcileAssistantAutoReplyPendingClaim(input: {
  receipt: AssistantTurnReceipt | null
  state: AssistantAutoReplyRouteStateValue
}):
  | {
      kind: 'blocked'
      result: Extract<AssistantAutoReplyRouteReadResult, { kind: 'blocked' }>
    }
  | {
      changed: boolean
      kind: 'ready'
      state: AssistantAutoReplyRouteStateValue
    } {
  const pending = input.state.pending
  if (!pending) {
    return {
      changed: false,
      kind: 'ready',
      state: input.state,
    }
  }
  if (!input.receipt) {
    return {
      kind: 'blocked',
      result: {
        kind: 'blocked',
        reason: 'missing-or-corrupt-receipt',
      },
    }
  }
  if (input.receipt.status === 'running') {
    return {
      kind: 'blocked',
      result: {
        kind: 'blocked',
        reason: 'running-receipt',
      },
    }
  }
  if (
    input.receipt.status === 'completed' ||
    input.receipt.status === 'deferred'
  ) {
    const acceptedThrough = receiptRecordsCrossSessionContextIntent(
      input.receipt,
      pending.order.intentId,
    )
      ? maxAssistantAutoReplyDeliveryOrder(
          pending.acceptedThrough,
          pending.order,
        )
      : pending.acceptedThrough
    return {
      changed: true,
      kind: 'ready',
      state: {
        pending: null,
        settledThrough: acceptedThrough === null
          ? input.state.settledThrough
          : maxAssistantAutoReplyDeliveryOrder(
              input.state.settledThrough,
              acceptedThrough,
            ),
      },
    }
  }
  return {
    changed: true,
    kind: 'ready',
    state: {
      pending: null,
      settledThrough: input.state.settledThrough,
    },
  }
}

async function migrateAssistantAutoReplyRouteStateAtPaths(input: {
  outboxIntents: readonly AssistantOutboxIntent[]
  paths: AssistantStatePaths
  receipts: readonly AssistantTurnReceipt[]
}): Promise<void> {
  const deliveriesByIntentId = new Map<string, {
    order: AssistantAutoReplyDeliveryOrder
    routeDigest: string
  }>()
  for (const intent of input.outboxIntents) {
    if (!hasAssistantOutboxDeliveryEvidence(intent)) {
      continue
    }
    const route = resolveAssistantAutoReplyOutboxExactRoute(intent)
    const order = readAssistantAutoReplyOutboxDeliveryOrder(intent)
    if (route && order) {
      deliveriesByIntentId.set(intent.intentId, {
        order,
        routeDigest: route.digest,
      })
    }
  }

  const settledThroughByRoute = new Map<
    string,
    AssistantAutoReplyDeliveryOrder
  >()
  for (const receipt of input.receipts) {
    if (
      receipt.status !== 'completed' &&
      receipt.status !== 'deferred' &&
      receipt.status !== 'running'
    ) {
      continue
    }
    const seenIntentIds = new Set<string>()
    for (const event of receipt.timeline) {
      const intentId = normalizeNullableString(
        event.metadata[AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY],
      )
      if (!intentId || seenIntentIds.has(intentId)) {
        continue
      }
      seenIntentIds.add(intentId)
      const delivery = deliveriesByIntentId.get(intentId)
      if (!delivery) {
        continue
      }
      settledThroughByRoute.set(
        delivery.routeDigest,
        maxAssistantAutoReplyDeliveryOrder(
          settledThroughByRoute.get(delivery.routeDigest) ?? null,
          delivery.order,
        ),
      )
    }
  }

  const routeDigests = new Set(settledThroughByRoute.keys())
  for (const routeDigest of routeDigests) {
    const currentRead = await readAssistantAutoReplyRouteStateAtPaths(
      input.paths,
      routeDigest,
    )
    if (currentRead.kind === 'corrupt') {
      throw new Error(
        'Assistant auto-reply route state is malformed; legacy migration cannot complete.',
      )
    }
    const current = currentRead.kind === 'missing'
      ? createEmptyAssistantAutoReplyRouteState()
      : currentRead.state
    const migratedSettledThrough = settledThroughByRoute.get(routeDigest)
    if (migratedSettledThrough === undefined) {
      continue
    }
    const settledThrough = maxAssistantAutoReplyDeliveryOrder(
      current.settledThrough,
      migratedSettledThrough,
    )
    const pending = current.pending === null ||
      compareAssistantAutoReplyDeliveryOrders(
        current.pending.order,
        settledThrough,
      ) <= 0
      ? null
      : current.pending
    await writeAssistantAutoReplyRouteStateAtPaths(
      input.paths,
      routeDigest,
      {
        pending,
        settledThrough,
      },
    )
  }

  await writeAssistantStateVersionedJson({
    filePath: resolveAssistantAutoReplyRouteMigrationPath(input.paths),
    schema: ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA,
    schemaVersion: ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA_VERSION,
    value: {
      completedAt: new Date().toISOString(),
    } satisfies AssistantAutoReplyRouteMigrationValue,
  })
}

export async function readAssistantAutoReplyRouteMigrationStatusAtPaths(
  paths: AssistantStatePaths,
): Promise<'complete' | 'corrupt' | 'missing'> {
  try {
    await readVersionedJsonStateFile({
      currentPath: resolveAssistantAutoReplyRouteMigrationPath(paths),
      label: 'assistant auto-reply route migration',
      parseValue: parseAssistantAutoReplyRouteMigrationValue,
      schema: ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA,
      schemaVersion: ASSISTANT_AUTO_REPLY_ROUTE_MIGRATION_SCHEMA_VERSION,
    })
    return 'complete'
  } catch (error) {
    return isMissingFileError(error) ? 'missing' : 'corrupt'
  }
}

async function readAssistantAutoReplyRouteStateAtPaths(
  paths: AssistantStatePaths,
  routeDigest: string,
): Promise<
  | { kind: 'corrupt' }
  | { kind: 'missing' }
  | { kind: 'valid'; state: AssistantAutoReplyRouteStateValue }
> {
  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath: resolveAssistantAutoReplyRouteStatePath(
        paths,
        routeDigest,
      ),
      label: 'assistant auto-reply route state',
      parseValue: parseAssistantAutoReplyRouteStateValue,
      schema: ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA,
      schemaVersion: ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA_VERSION,
    })
    return {
      kind: 'valid',
      state: value,
    }
  } catch (error) {
    return isMissingFileError(error)
      ? { kind: 'missing' }
      : { kind: 'corrupt' }
  }
}

async function writeAssistantAutoReplyRouteStateAtPaths(
  paths: AssistantStatePaths,
  routeDigest: string,
  state: AssistantAutoReplyRouteStateValue,
): Promise<void> {
  const parsed = parseAssistantAutoReplyRouteStateValue(state)
  await ensureAssistantStateDir(resolveAssistantAutoReplyRoutesDirectory(paths))
  await writeAssistantStateVersionedJson({
    filePath: resolveAssistantAutoReplyRouteStatePath(paths, routeDigest),
    schema: ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA,
    schemaVersion: ASSISTANT_AUTO_REPLY_ROUTE_STATE_SCHEMA_VERSION,
    value: parsed,
  })
}

function parseAssistantAutoReplyRouteStateValue(
  value: unknown,
): AssistantAutoReplyRouteStateValue {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['pending', 'settledThrough'])) {
    throw new TypeError('Assistant auto-reply route state must be an object.')
  }
  return {
    pending: value.pending === null
      ? null
      : parseAssistantAutoReplyPendingClaim(value.pending),
    settledThrough: value.settledThrough === null
      ? null
      : parseAssistantAutoReplyDeliveryOrder(value.settledThrough),
  }
}

function parseAssistantAutoReplyPendingClaim(value: unknown): {
  acceptedThrough: AssistantAutoReplyDeliveryOrder | null
  order: AssistantAutoReplyDeliveryOrder
  turnId: string
} {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['acceptedThrough', 'order', 'turnId'])
  ) {
    throw new TypeError('Assistant auto-reply pending route claim must be an object.')
  }
  const turnId = normalizeUnknownNullableString(value.turnId)
  if (!turnId) {
    throw new TypeError('Assistant auto-reply pending route claim requires a turn id.')
  }
  const order = parseAssistantAutoReplyDeliveryOrder(value.order)
  const acceptedThrough = value.acceptedThrough === null
    ? null
    : parseAssistantAutoReplyDeliveryOrder(value.acceptedThrough)
  if (
    acceptedThrough !== null &&
    compareAssistantAutoReplyDeliveryOrders(acceptedThrough, order) > 0
  ) {
    throw new TypeError(
      'Assistant auto-reply pending route claim cannot accept beyond its current order.',
    )
  }
  return {
    acceptedThrough,
    order,
    turnId,
  }
}

function receiptRecordsCrossSessionContextIntent(
  receipt: AssistantTurnReceipt,
  intentId: string,
): boolean {
  return receipt.timeline.some((event) =>
    normalizeNullableString(
      event.metadata[AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY],
    ) === intentId
  )
}

function parseAssistantAutoReplyDeliveryOrder(
  value: unknown,
): AssistantAutoReplyDeliveryOrder {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['intentId', 'sentAt'])) {
    throw new TypeError('Assistant auto-reply delivery order must be an object.')
  }
  const order = {
    intentId: normalizeUnknownNullableString(value.intentId),
    sentAt: normalizeUnknownNullableString(value.sentAt),
  }
  if (
    !order.intentId ||
    !order.sentAt ||
    !Number.isFinite(Date.parse(order.sentAt))
  ) {
    throw new TypeError(
      'Assistant auto-reply delivery order requires a valid intent id and sentAt timestamp.',
    )
  }
  return {
    intentId: order.intentId,
    sentAt: order.sentAt,
  }
}

function parseAssistantAutoReplyRouteMigrationValue(
  value: unknown,
): AssistantAutoReplyRouteMigrationValue {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['completedAt'])) {
    throw new TypeError(
      'Assistant auto-reply route migration value must be an object.',
    )
  }
  const completedAt = normalizeUnknownNullableString(value.completedAt)
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
    throw new TypeError(
      'Assistant auto-reply route migration requires a valid completion timestamp.',
    )
  }
  return { completedAt }
}

function createEmptyAssistantAutoReplyRouteState(): AssistantAutoReplyRouteStateValue {
  return {
    pending: null,
    settledThrough: null,
  }
}

function maxAssistantAutoReplyDeliveryOrder(
  left: AssistantAutoReplyDeliveryOrder | null,
  right: AssistantAutoReplyDeliveryOrder,
): AssistantAutoReplyDeliveryOrder {
  return left === null || compareAssistantAutoReplyDeliveryOrders(left, right) < 0
    ? right
    : left
}

function buildAssistantAutoReplyExactRoute(
  components: readonly string[],
): AssistantAutoReplyExactRoute {
  return {
    digest: createHash('sha256')
      .update(JSON.stringify([
        'murph.assistant-auto-reply-route.v1',
        ...components,
      ]))
      .digest('hex'),
  }
}

function resolveExactLinqProviderThreadTarget(
  delivery: AssistantAutoReplyOutboxMessageDelivery,
): string | null {
  const providerThreadId = readAssistantTargetProviderScalar(
    delivery.providerThreadId,
  )
  if (providerThreadId) {
    return providerThreadId
  }
  return delivery.targetKind === 'thread'
    ? readAssistantTargetProviderScalar(delivery.target)
    : null
}

function normalizeRouteChannel(value: string | null | undefined): string | null {
  return normalizeNullableString(value)?.toLowerCase() ?? null
}

function resolveAssistantAutoReplyRootDirectory(
  paths: AssistantStatePaths,
): string {
  return path.join(paths.assistantStateRoot, 'auto-reply')
}

function resolveAssistantAutoReplyRoutesDirectory(
  paths: AssistantStatePaths,
): string {
  return path.join(resolveAssistantAutoReplyRootDirectory(paths), 'routes')
}

function assertAssistantAutoReplyDeliveryOrder(
  order: AssistantAutoReplyDeliveryOrder,
): void {
  parseAssistantAutoReplyDeliveryOrder(order)
}

function assertAssistantAutoReplyRouteDigest(routeDigest: string): void {
  if (!ASSISTANT_AUTO_REPLY_ROUTE_DIGEST_PATTERN.test(routeDigest)) {
    throw new TypeError('Assistant auto-reply route digest must be a SHA-256 hex digest.')
  }
}

function normalizeUnknownNullableString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
}
