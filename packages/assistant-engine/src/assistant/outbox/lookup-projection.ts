import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeAssistantOpaqueId } from '@murphai/runtime-state/assistant-ids'
import {
  parseVersionedJsonStateEnvelope,
  writeVersionedJsonStateFile,
} from '@murphai/runtime-state/node'
import {
  applyAssistantRebuildableLookupChangesAtPaths,
  computeAssistantRebuildableLookupBucketDigests,
  createEmptyAssistantRebuildableLookupBucketDigests,
  listAssistantRebuildableLookupGenerationsAtPaths,
  parseAssistantRebuildableLookupBucketDigests,
  readAssistantRebuildableLookupAtPaths,
  recoverAssistantRebuildableLookupGenerationBucketDigestsAtPaths,
  removeAssistantRebuildableLookupGenerationAtPaths,
  resolveAssistantRebuildableLookupOwnerDirectory,
  validateAssistantRebuildableLookupGenerationAtPaths,
  type AssistantRebuildableLookupChange,
  type AssistantRebuildableLookupReadMetrics,
} from '../rebuildable-lookup-store.js'
import { hasAssistantOutboxDeliveryEvidence } from '../response-media.js'
import {
  isMissingFileError,
  normalizeNullableString,
} from '../shared.js'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
  isAssistantAutoReplyRouteProjectionSufficientForRead,
  parseAssistantAutoReplyRouteProjection,
  removeAssistantAutoReplyRouteProjectionCandidate,
  resolveAssistantAutoReplyRouteProjectionIntentMemberships,
  upsertAssistantAutoReplyRouteProjectionCandidate,
  type AssistantAutoReplyRouteProjectionQuery,
  type AssistantAutoReplyRouteProjectionReadProof,
  type AssistantAutoReplyRouteProjectionV1,
} from '../automation/cross-session-route-projection.js'
import { readAssistantTargetProviderScalar } from '../message-target-selection.js'
import {
  hashAssistantOutboxLegacyMediaDedupeIdentity,
} from './intents.js'

export const ASSISTANT_OUTBOX_LOOKUP_OWNER =
  'murph.assistant-outbox.lookup-projection.v1'
export const ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND =
  'murph.assistant-outbox.active-dedupe-key.v1'
export const ASSISTANT_OUTBOX_ACTIVE_DELIVERY_IDEMPOTENCY_LOOKUP_KIND =
  'murph.assistant-outbox.active-delivery-idempotency.v1'
export const ASSISTANT_OUTBOX_ACTIVE_LEGACY_DEDUPE_ALIAS_LOOKUP_KIND =
  'murph.assistant-outbox.active-legacy-dedupe-alias.v1'
export const ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KIND =
  'murph.assistant-outbox.unclassified-legacy-dedupe.v1'
export const ASSISTANT_OUTBOX_PROVIDER_MESSAGE_LOOKUP_KIND =
  'murph.assistant-outbox.provider-message.v1'
export const ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KIND =
  'murph.assistant-outbox.provider-message-incomplete.v1'
export const ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KIND =
  'murph.assistant-outbox.canonical-mutation-incomplete.v1'

export const ASSISTANT_OUTBOX_LOOKUP_MAX_REFS = 8
export const ASSISTANT_OUTBOX_LOOKUP_UNCLASSIFIED_MAX_REFS = 32
export const ASSISTANT_OUTBOX_LOOKUP_PROVIDER_IDS_PER_INTENT = 16
export const ASSISTANT_OUTBOX_LOOKUP_MAX_CHANGED_RECORDS_PER_MUTATION = 48
// Each changed record can write one record and one bucket in the active and
// in-progress generations, plus at most two publication writes when active
// trust must be invalidated before the canonical write.
export const ASSISTANT_OUTBOX_LOOKUP_MAX_LOGICAL_WRITES_PER_MUTATION =
  ASSISTANT_OUTBOX_LOOKUP_MAX_CHANGED_RECORDS_PER_MUTATION * 4 + 2
export const ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE = 128

const ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA =
  'murph.assistant-outbox-lookup-publication'
const ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA_VERSION = 1
const ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION = 1
const ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_FILE_MAX_BYTES = 128 * 1024
const ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KEY =
  'all-unclassified-active-intents'
const ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KEY =
  'all-provider-incomplete-intents'
const ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KEY =
  'all-canonical-mutation-incomplete-intents'
const ID_PATTERN = /^[0-9a-f]{32}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/u

interface AssistantOutboxLookupGenerationPublicationV1 {
  bucketDigests: Record<string, string>
  generation: string
  publicationId: string
  publishedAt: string
}

interface AssistantOutboxLookupBuildingPublicationV1 {
  afterIntentId: string | null
  bucketDigests: Record<string, string>
  buildId: string
  generation: string
  startedAt: string
}

interface AssistantOutboxLookupPublicationV1 {
  active: AssistantOutboxLookupGenerationPublicationV1 | null
  building: AssistantOutboxLookupBuildingPublicationV1 | null
  writerVersion: 1
}

interface AssistantOutboxIntentRefsV1 {
  intentIds: string[]
  state: 'complete' | 'degraded' | 'overflow'
}

export interface AssistantOutboxLookupRefMembership {
  key: string
  kind: string
  maxRefs: number
}

interface AssistantOutboxLookupMembershipSnapshot {
  refs: Map<string, AssistantOutboxLookupRefMembership>
  routes: Map<string, ReturnType<
    typeof resolveAssistantAutoReplyRouteProjectionIntentMemberships
  >[number]>
}

interface AssistantOutboxLookupTransitionPlan {
  refAdditions: AssistantOutboxLookupRefMembership[]
  refRemovals: AssistantOutboxLookupRefMembership[]
  routeRemovals: Array<ReturnType<
    typeof resolveAssistantAutoReplyRouteProjectionIntentMemberships
  >[number]>
  routeUpserts: Array<ReturnType<
    typeof resolveAssistantAutoReplyRouteProjectionIntentMemberships
  >[number]>
}

interface AssistantOutboxLookupGenerationView {
  bucketDigests: Record<string, string>
  generation: string
}

interface AssistantOutboxLookupCanonicalReadMetrics {
  bytesRead: number
  filesRead: number
}

export interface AssistantOutboxLookupReadMetrics {
  canonicalValidationBytesRead: number
  canonicalValidationFilesRead: number
  elapsedMs: number
  fallbackReason?: string
  lookupBytesRead: number
  lookupFilesRead: number
  publicationRetries: number
}

export interface AssistantOutboxLookupMaintenanceResult {
  canonicalIntentsProcessed: number
  changed: boolean
  generationsRemoved: number
  lookupWrites: number
  rebuildCompleted: boolean
  rebuildResumed: boolean
  rebuildStarted: boolean
  repairPerformed: boolean
  trusted: boolean
}

export type AssistantOutboxDedupeLookupResult =
  | {
      intent: AssistantOutboxIntent
      kind: 'found'
      legacyDedupeLookupKeyUpgrade?: string
      metrics: AssistantOutboxLookupReadMetrics
    }
  | {
      kind: 'not-found'
      metrics: AssistantOutboxLookupReadMetrics
    }
  | {
      kind: 'fallback'
      metrics: AssistantOutboxLookupReadMetrics
      reason: string
    }

export type AssistantOutboxProviderLookupResult =
  | {
      intentsByProviderMessageId: ReadonlyMap<
        string,
        readonly AssistantOutboxIntent[]
      >
      kind: 'complete'
      metrics: AssistantOutboxLookupReadMetrics
    }
  | {
      kind: 'fallback'
      metrics: AssistantOutboxLookupReadMetrics
      reason: string
    }

export type AssistantOutboxRouteLookupResult =
  | {
      intentsById: ReadonlyMap<string, AssistantOutboxIntent>
      kind: 'complete'
      metrics: AssistantOutboxLookupReadMetrics
      projection: AssistantAutoReplyRouteProjectionV1 | null
    }
  | {
      kind: 'fallback'
      metrics: AssistantOutboxLookupReadMetrics
      reason: string
    }

export interface AssistantOutboxLookupCanonicalReader {
  readIntent(
    intentId: string,
    onBytesRead?: (bytes: number) => void,
  ): Promise<AssistantOutboxIntent | null>
}

interface AssistantOutboxStableLookupOperationMetrics {
  canonical: AssistantOutboxLookupCanonicalReadMetrics
  lookup: AssistantRebuildableLookupReadMetrics
}

interface AssistantOutboxStableLookupOperationResult<T> {
  kind: 'fallback' | 'value'
  metrics: AssistantOutboxStableLookupOperationMetrics
  reason?: string
  value?: T
}

interface AssistantOutboxPublicationReadMetrics {
  bytesRead: number
  filesRead: number
}

interface AssistantOutboxPublicationReadResult {
  kind: 'invalid' | 'missing' | 'value'
  metrics: AssistantOutboxPublicationReadMetrics
  value?: AssistantOutboxLookupPublicationV1
}

interface AssistantOutboxGenerationUpdateResult {
  logicalWrites: number
  view: AssistantOutboxLookupGenerationView
}

interface AssistantOutboxProjectionMutationResult {
  lookupWrites: number
}

type AssistantOutboxMessageDelivery = Extract<
  NonNullable<AssistantOutboxIntent['delivery']>,
  { kind?: 'message' }
>

export async function persistAssistantOutboxLookupAwareCanonicalMutationAtPaths(
  input: {
    next: AssistantOutboxIntent | null
    paths: AssistantStatePaths
    previous: AssistantOutboxIntent | null
    writeCanonical(): Promise<void>
  },
): Promise<AssistantOutboxProjectionMutationResult> {
  const plan = buildAssistantOutboxLookupTransitionPlan(
    input.previous,
    input.next,
  )
  if (!assistantOutboxLookupTransitionPlanHasChanges(plan)) {
    await input.writeCanonical()
    return { lookupWrites: 0 }
  }

  const publicationRead = await readAssistantOutboxLookupPublicationAtPaths(
    input.paths,
  )
  if (publicationRead.kind === 'missing') {
    // With no published generation, every lookup reader already falls back to
    // canonical state. Keep this cold path canonical-only; maintenance owns
    // starting the first all-current-writer rebuild.
    await input.writeCanonical()
    return { lookupWrites: 0 }
  }
  let publication = publicationRead.kind === 'value'
    ? publicationRead.value!
    : createEmptyAssistantOutboxLookupPublication()
  let activeView = publication.active
    ? generationViewFromActive(publication.active)
    : null
  let buildingView = publication.building
    ? generationViewFromBuilding(publication.building)
    : null
  let lookupWrites = 0
  let activePrewriteFailed = false
  let buildingPrewriteFailed = false
  const activeMutationBarrierProtected =
    publication.active !== null &&
    input.previous !== null &&
    isAssistantOutboxLookupCanonicalMutationIncomplete(input.previous)
      ? await isAssistantOutboxLookupMutationBarrierPublishedAtPaths({
          active: publication.active,
          intentId: input.previous.intentId,
          paths: input.paths,
        })
      : false

  const applyAdditions = async (
    view: AssistantOutboxLookupGenerationView | null,
  ): Promise<AssistantOutboxLookupGenerationView | null> => {
    if (!view) {
      return null
    }
    const updated = await applyAssistantOutboxLookupPlanPhaseAtPaths({
      intentId: input.next?.intentId ?? input.previous?.intentId ?? '',
      paths: input.paths,
      phase: 'additions',
      plan,
      view,
    })
    lookupWrites += updated.logicalWrites
    return updated.view
  }

  try {
    activeView = await applyAdditions(activeView)
  } catch {
    activeView = null
    activePrewriteFailed = true
  }
  try {
    buildingView = await applyAdditions(buildingView)
  } catch {
    buildingView = null
    buildingPrewriteFailed = true
  }

  const activeNeedsPrecanonicalInvalidation =
    publicationRead.kind === 'value' &&
    publication.active !== null &&
    activePrewriteFailed &&
    !activeMutationBarrierProtected
  const buildingNeedsPrecanonicalInvalidation =
    publicationRead.kind === 'value' &&
    publication.building !== null &&
    buildingPrewriteFailed
  if (
    activeNeedsPrecanonicalInvalidation ||
    buildingNeedsPrecanonicalInvalidation
  ) {
    publication = {
      // Keep a successfully prewritten active generation on its old manifest
      // until the canonical write commits. The changed bucket digest then
      // deliberately makes concurrent reads fall back instead of exposing a
      // positive whose canonical intent does not exist yet.
      active: activePrewriteFailed
        ? activeMutationBarrierProtected
          ? publication.active
          : null
        : publication.active,
      building: buildingPrewriteFailed
        ? null
        : buildingView && publication.building
          ? buildingPublicationFromView(publication.building, buildingView)
          : null,
      writerVersion: ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION,
    }
    // A failed published-generation prewrite must be invalidated before the
    // canonical mutation. In particular, never leave a stale building cursor
    // resumable after it failed to witness this write: a crash after canonical
    // commit could otherwise publish an incomplete generation. Healthy
    // building progress survives an active-only failure.
    try {
      await writeAssistantOutboxLookupPublicationAtPaths(
        input.paths,
        publication,
      )
      lookupWrites += 1
    } catch (error) {
      const publicationRemoved = await rm(
        resolveAssistantOutboxLookupPublicationPath(input.paths),
        { force: true },
      ).then(
        () => true,
        () => false,
      )
      if (!publicationRemoved && activeNeedsPrecanonicalInvalidation) {
        // A current active generation that neither received the addition nor
        // lost publication could produce a trusted false miss after canonical
        // commit. Preserve canonical authority by aborting before that write.
        // A failed building-only invalidation is untrusted by definition and
        // must never make disposable maintenance block canonical foreground
        // work.
        throw error
      }
      // No trusted publication remains, or the already-published irreversible
      // provider barrier forces every reader to canonical fallback. Either way
      // the disposable projection cannot block this canonical transition.
      publication = createEmptyAssistantOutboxLookupPublication()
      activeView = null
      buildingView = null
    }
  }

  try {
    await input.writeCanonical()
  } catch (error) {
    await resetAssistantOutboxLookupAfterFailedCanonicalWriteAtPaths({
      paths: input.paths,
      publication,
    }).catch(() => undefined)
    throw error
  }

  const applyRemovals = async (
    view: AssistantOutboxLookupGenerationView | null,
  ): Promise<AssistantOutboxLookupGenerationView | null> => {
    if (!view) {
      return null
    }
    const updated = await applyAssistantOutboxLookupPlanPhaseAtPaths({
      intentId: input.previous?.intentId ?? input.next?.intentId ?? '',
      paths: input.paths,
      phase: 'removals',
      plan,
      view,
    })
    lookupWrites += updated.logicalWrites
    return updated.view
  }

  try {
    activeView = await applyRemovals(activeView)
  } catch {
    activeView = null
  }
  try {
    buildingView = await applyRemovals(buildingView)
  } catch {
    buildingView = null
  }

  const now = new Date().toISOString()
  const nextPublication: AssistantOutboxLookupPublicationV1 = {
    active: activeView
      ? {
          bucketDigests: activeView.bucketDigests,
          generation: activeView.generation,
          publicationId: createUniqueId(),
          publishedAt: now,
        }
      : null,
    building: buildingView && publication.building && !buildingPrewriteFailed
      ? buildingPublicationFromView(publication.building, buildingView)
      : activeView === null
        ? createAssistantOutboxLookupBuildingPublication(now)
        : null,
    writerVersion: ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION,
  }
  try {
    await writeAssistantOutboxLookupPublicationAtPaths(
      input.paths,
      nextPublication,
    )
    lookupWrites += 1
  } catch {
    // Canonical state already committed. Removing publication is best effort;
    // if removal also fails, prewrites make additions bucket-mismatched and
    // removals remain stale positives that canonical revalidation rejects.
    await rm(resolveAssistantOutboxLookupPublicationPath(input.paths), {
      force: true,
    }).catch(() => undefined)
  }
  return { lookupWrites }
}

export async function invalidateAssistantOutboxLookupProjectionAtPaths(input: {
  paths: AssistantStatePaths
}): Promise<AssistantOutboxProjectionMutationResult> {
  const publicationRead = await readAssistantOutboxLookupPublicationAtPaths(
    input.paths,
  )
  if (publicationRead.kind === 'missing') {
    return { lookupWrites: 0 }
  }

  const next = createEmptyAssistantOutboxLookupPublication()
  next.building = createAssistantOutboxLookupBuildingPublication(
    new Date().toISOString(),
  )
  await writeAssistantOutboxLookupPublicationAtPaths(input.paths, next)
  return { lookupWrites: 1 }
}

export async function readAssistantOutboxDedupeLookupAtPaths(input: {
  dedupeKey: string
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  paths: AssistantStatePaths
  reader: AssistantOutboxLookupCanonicalReader
}): Promise<AssistantOutboxDedupeLookupResult> {
  const stable = await runAssistantOutboxStableLookupAtPaths({
    paths: input.paths,
    run: async (active) => {
      const canonicalCache = new Map<string, AssistantOutboxIntent | null>()
      const metrics = createEmptyOperationMetrics()
      const exact = await readValidatedRefIntentsAtPaths({
        active,
        key: input.dedupeKey,
        kind: ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
        metrics,
        paths: input.paths,
        reader: input.reader,
        canonicalCache,
        validate: (intent) =>
          isActiveAssistantOutboxIntent(intent) &&
          intent.dedupeKey === input.dedupeKey,
      })
      if (exact.kind === 'fallback') {
        return operationFallback(exact.reason, metrics)
      }
      if (exact.intents.length > 1) {
        return operationFallback('dedupe-exact-ambiguous', metrics)
      }
      if (exact.intents[0]) {
        return operationValue({
          intent: exact.intents[0],
        }, metrics)
      }

      const dedupeToken = normalizeNullableString(input.dedupeToken)
      const deliveryIdempotencyKey = normalizeNullableString(
        input.deliveryIdempotencyKey,
      )
      if (dedupeToken && dedupeToken === deliveryIdempotencyKey) {
        const transport = await readValidatedRefIntentsAtPaths({
          active,
          key: deliveryIdempotencyKey,
          kind: ASSISTANT_OUTBOX_ACTIVE_DELIVERY_IDEMPOTENCY_LOOKUP_KIND,
          maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
          metrics,
          paths: input.paths,
          reader: input.reader,
          canonicalCache,
          validate: (intent) =>
            isActiveAssistantOutboxIntent(intent) &&
            normalizeNullableString(intent.deliveryIdempotencyKey) ===
              deliveryIdempotencyKey,
        })
        if (transport.kind === 'fallback') {
          return operationFallback(transport.reason, metrics)
        }
        if (transport.intents.length > 1) {
          return operationFallback('dedupe-idempotency-ambiguous', metrics)
        }
        if (transport.intents[0]) {
          return operationValue({ intent: transport.intents[0] }, metrics)
        }
      }

      if (!dedupeToken) {
        return operationValue({ intent: null }, metrics)
      }
      const known = await readValidatedRefIntentsAtPaths({
        active,
        key: input.dedupeKey,
        kind: ASSISTANT_OUTBOX_ACTIVE_LEGACY_DEDUPE_ALIAS_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
        metrics,
        paths: input.paths,
        reader: input.reader,
        canonicalCache,
        validate: (intent) =>
          isActiveAssistantOutboxIntent(intent) &&
          intent.legacyDedupeLookupKey === input.dedupeKey,
      })
      if (known.kind === 'fallback') {
        return operationFallback(known.reason, metrics)
      }
      const unclassified = await readValidatedRefIntentsAtPaths({
        active,
        key: ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KEY,
        kind: ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_UNCLASSIFIED_MAX_REFS,
        metrics,
        paths: input.paths,
        reader: input.reader,
        canonicalCache,
        validate: (intent) =>
          isActiveAssistantOutboxIntent(intent) &&
          intent.legacyDedupeLookupKey === undefined,
      })
      if (unclassified.kind === 'fallback') {
        return operationFallback(unclassified.reason, metrics)
      }
      const unknownMatches = unclassified.intents.filter((intent) =>
        hashAssistantOutboxLegacyMediaDedupeIdentity({
          dedupeToken,
          media: intent.media,
        }) === intent.dedupeKey,
      )
      const allMatches = [
        ...known.intents.map((intent) => ({ intent, upgrade: false })),
        ...unknownMatches.map((intent) => ({ intent, upgrade: true })),
      ]
      if (allMatches.length > 1) {
        return operationFallback('dedupe-legacy-ambiguous', metrics)
      }
      const selected = allMatches[0]
      return operationValue(
        selected
          ? {
              intent: selected.intent,
              ...(selected.upgrade
                ? { legacyDedupeLookupKeyUpgrade: input.dedupeKey }
                : {}),
            }
          : { intent: null },
        metrics,
      )
    },
  })

  if (stable.kind === 'fallback') {
    return {
      kind: 'fallback',
      metrics: stable.metrics,
      reason: stable.reason,
    }
  }
  const value = stable.value as {
    intent: AssistantOutboxIntent | null
    legacyDedupeLookupKeyUpgrade?: string
  }
  return value.intent
    ? {
        intent: value.intent,
        kind: 'found',
        ...(value.legacyDedupeLookupKeyUpgrade
          ? {
              legacyDedupeLookupKeyUpgrade:
                value.legacyDedupeLookupKeyUpgrade,
            }
          : {}),
        metrics: stable.metrics,
      }
    : {
        kind: 'not-found',
        metrics: stable.metrics,
      }
}

export async function readAssistantOutboxProviderLookupAtPaths(input: {
  channel: string
  paths: AssistantStatePaths
  providerMessageIds: readonly string[]
  reader: AssistantOutboxLookupCanonicalReader
}): Promise<AssistantOutboxProviderLookupResult> {
  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null
  const providerMessageIds = [...new Set(
    input.providerMessageIds
      .map((value) => readAssistantTargetProviderScalar(value))
      .filter((value): value is string => value !== null),
  )]
  if (!channel || providerMessageIds.length === 0) {
    return {
      intentsByProviderMessageId: new Map(),
      kind: 'complete',
      metrics: createEmptyReadMetrics(),
    }
  }

  const stable = await runAssistantOutboxStableLookupAtPaths({
    paths: input.paths,
    run: async (active) => {
      const metrics = createEmptyOperationMetrics()
      const canonicalCache = new Map<string, AssistantOutboxIntent | null>()
      const incomplete = await readIntentRefsAtPaths({
        active,
        key: ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KEY,
        kind: ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
        metrics,
        paths: input.paths,
      })
      if (incomplete.kind === 'fallback') {
        return operationFallback(incomplete.reason, metrics)
      }
      if (incomplete.refs !== null) {
        return operationFallback('provider-lookup-incomplete', metrics)
      }
      const intentsByProviderMessageId = new Map<
        string,
        readonly AssistantOutboxIntent[]
      >()
      for (const providerMessageId of providerMessageIds) {
        const key = buildAssistantOutboxProviderMessageLookupKey({
          channel,
          providerMessageId,
        })
        const refs = await readIntentRefsAtPaths({
          active,
          key,
          kind: ASSISTANT_OUTBOX_PROVIDER_MESSAGE_LOOKUP_KIND,
          maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
          metrics,
          paths: input.paths,
        })
        if (refs.kind === 'fallback') {
          return operationFallback(refs.reason, metrics)
        }
        const intents: AssistantOutboxIntent[] = []
        for (const intentId of refs.refs?.intentIds ?? []) {
          const intent = await readCanonicalIntentCached({
            cache: canonicalCache,
            intentId,
            metrics: metrics.canonical,
            reader: input.reader,
          })
          if (
            !intent ||
            !resolveAssistantOutboxProviderMessageMemberships(intent).some(
              (membership) =>
                membership.kind ===
                  ASSISTANT_OUTBOX_PROVIDER_MESSAGE_LOOKUP_KIND &&
                membership.key === key,
            )
          ) {
            return operationFallback(
              'provider-canonical-validation-failed',
              metrics,
            )
          }
          intents.push(intent)
        }
        intentsByProviderMessageId.set(providerMessageId, intents)
      }
      return operationValue(intentsByProviderMessageId, metrics)
    },
  })

  return stable.kind === 'fallback'
    ? {
        kind: 'fallback',
        metrics: stable.metrics,
        reason: stable.reason,
      }
    : {
        intentsByProviderMessageId: stable.value as ReadonlyMap<
          string,
          readonly AssistantOutboxIntent[]
        >,
        kind: 'complete',
        metrics: stable.metrics,
      }
}

export async function readAssistantOutboxRouteLookupAtPaths(input: {
  paths: AssistantStatePaths
  proof: AssistantAutoReplyRouteProjectionReadProof
  query: AssistantAutoReplyRouteProjectionQuery
  reader: AssistantOutboxLookupCanonicalReader
}): Promise<AssistantOutboxRouteLookupResult> {
  const stable = await runAssistantOutboxStableLookupAtPaths({
    paths: input.paths,
    run: async (active) => {
      const metrics = createEmptyOperationMetrics()
      const read = await readAssistantRebuildableLookupAtPaths({
        bucketDigests: active.bucketDigests,
        generation: active.generation,
        key: input.query.lookupKey,
        kind: ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        parseValue: parseAssistantAutoReplyRouteProjection,
        paths: input.paths,
      })
      addLookupMetrics(metrics.lookup, read.metrics)
      if (read.kind === 'invalid') {
        return operationFallback(
          `route-${read.reason}`,
          metrics,
        )
      }
      if (read.kind === 'absent') {
        return operationValue({
          intentsById: new Map<string, AssistantOutboxIntent>(),
          projection: null,
        }, metrics)
      }
      if (
        read.value.expectedExactRouteDigest !==
          input.query.expectedExactRouteDigest
      ) {
        return operationFallback('route-projection-degraded', metrics)
      }

      const canonicalCache = new Map<string, AssistantOutboxIntent | null>()
      const intentsById = new Map<string, AssistantOutboxIntent>()
      for (const candidate of read.value.candidates) {
        const intent = await readCanonicalIntentCached({
          cache: canonicalCache,
          intentId: candidate.intentId,
          metrics: metrics.canonical,
          reader: input.reader,
        })
        const membership = intent
          ? resolveAssistantAutoReplyRouteProjectionIntentMemberships(intent)
              .find((item) =>
                item.membership.lookupKey === input.query.lookupKey,
              )
          : null
        if (
          !intent ||
          !membership ||
          membership.membership.expectedExactRouteDigest !==
            read.value.expectedExactRouteDigest ||
          JSON.stringify(membership.candidate) !== JSON.stringify(candidate)
        ) {
          return operationFallback(
            'route-canonical-validation-failed',
            metrics,
          )
        }
        intentsById.set(intent.intentId, intent)
      }
      if (!isAssistantAutoReplyRouteProjectionSufficientForRead({
        intentsById,
        projection: read.value,
        proof: input.proof,
      })) {
        return operationFallback('route-projection-degraded', metrics)
      }
      return operationValue({
        intentsById,
        projection: read.value,
      }, metrics)
    },
  })

  return stable.kind === 'fallback'
    ? {
        kind: 'fallback',
        metrics: stable.metrics,
        reason: stable.reason,
      }
    : {
        intentsById: (stable.value as {
          intentsById: ReadonlyMap<string, AssistantOutboxIntent>
        }).intentsById,
        kind: 'complete',
        metrics: stable.metrics,
        projection: (stable.value as {
          projection: AssistantAutoReplyRouteProjectionV1 | null
        }).projection,
      }
}

export async function maintainAssistantOutboxLookupProjectionAtPaths(input: {
  outboxIntents: readonly AssistantOutboxIntent[]
  outboxTrusted: boolean
  paths: AssistantStatePaths
  shouldYield?: (() => boolean) | null
}): Promise<AssistantOutboxLookupMaintenanceResult> {
  const emptyResult: AssistantOutboxLookupMaintenanceResult = {
    canonicalIntentsProcessed: 0,
    changed: false,
    generationsRemoved: 0,
    lookupWrites: 0,
    rebuildCompleted: false,
    rebuildResumed: false,
    rebuildStarted: false,
    repairPerformed: false,
    trusted: false,
  }
  if (!input.outboxTrusted || input.shouldYield?.() === true) {
    return emptyResult
  }

  let publicationRead = await readAssistantOutboxLookupPublicationAtPaths(
    input.paths,
  )
  let publication = publicationRead.kind === 'value'
    ? publicationRead.value!
    : createEmptyAssistantOutboxLookupPublication()
  let changed = publicationRead.kind !== 'value'
  let lookupWrites = 0
  let rebuildStarted = false
  let rebuildCompleted = false
  let rebuildResumed = publicationRead.kind === 'value' &&
    publication.building !== null
  let repairPerformed = publicationRead.kind === 'invalid'
  let canonicalIntentsProcessed = 0

  if (publication.active) {
    const activeTrusted =
      await validateAssistantRebuildableLookupGenerationAtPaths({
        bucketDigests: publication.active.bucketDigests,
        generation: publication.active.generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      }) && assistantOutboxLookupGenerationMatchesCanonical({
        generation: publication.active.generation,
        intents: input.outboxIntents,
        paths: input.paths,
        publishedBucketDigests: publication.active.bucketDigests,
      })
    if (!activeTrusted) {
      publication = { ...publication, active: null }
      changed = true
      repairPerformed = true
    }
  }

  if (publication.building) {
    const buildingTrusted = await validateAssistantRebuildableLookupGenerationAtPaths({
      bucketDigests: publication.building.bucketDigests,
      generation: publication.building.generation,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths: input.paths,
    })
    if (!buildingTrusted) {
      const recovered = await recoverAssistantRebuildableLookupGenerationBucketDigestsAtPaths({
        generation: publication.building.generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      })
      if (recovered) {
        publication = {
          ...publication,
          building: {
            ...publication.building,
            bucketDigests: recovered,
          },
        }
        changed = true
        repairPerformed = true
      } else {
        publication = { ...publication, building: null }
        rebuildResumed = false
        changed = true
        repairPerformed = true
      }
    }
  }

  if (!publication.active && !publication.building) {
    publication = {
      ...publication,
      building: createAssistantOutboxLookupBuildingPublication(
        new Date().toISOString(),
      ),
    }
    rebuildStarted = true
    changed = true
  }

  if (changed) {
    await writeAssistantOutboxLookupPublicationAtPaths(
      input.paths,
      publication,
    )
    lookupWrites += 1
  }

  const building = publication.building
  if (!building || input.shouldYield?.() === true) {
    const generationsRemoved = await cleanupAssistantOutboxLookupGenerationsAtPaths({
      paths: input.paths,
      publication,
    })
    return {
      canonicalIntentsProcessed,
      changed: changed || generationsRemoved > 0,
      generationsRemoved,
      lookupWrites,
      rebuildCompleted,
      rebuildResumed,
      rebuildStarted,
      repairPerformed,
      trusted: publication.active !== null,
    }
  }

  const sortedIntents = [...input.outboxIntents].sort((left, right) =>
    left.intentId.localeCompare(right.intentId),
  )
  const remaining = sortedIntents.filter((intent) =>
    building.afterIntentId === null ||
    intent.intentId.localeCompare(building.afterIntentId) > 0,
  )
  let buildingView = generationViewFromBuilding(building)
  let afterIntentId = building.afterIntentId
  try {
    for (
      const intent of remaining.slice(
        0,
        ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE,
      )
    ) {
      if (input.shouldYield?.() === true) {
        break
      }
      const plan = buildAssistantOutboxLookupTransitionPlan(null, intent)
      const updated = await applyAssistantOutboxLookupPlanPhaseAtPaths({
        intentId: intent.intentId,
        paths: input.paths,
        phase: 'additions',
        plan,
        view: buildingView,
      })
      buildingView = updated.view
      lookupWrites += updated.logicalWrites
      canonicalIntentsProcessed += 1
      afterIntentId = intent.intentId
    }
  } catch {
    const replacementBuilding = publication.active === null
      ? createAssistantOutboxLookupBuildingPublication(new Date().toISOString())
      : null
    publication = {
      ...publication,
      building: replacementBuilding,
    }
    await writeAssistantOutboxLookupPublicationAtPaths(input.paths, publication)
    lookupWrites += 1
    changed = true
    repairPerformed = true
    rebuildResumed = false
    rebuildStarted = replacementBuilding !== null
    let failedGenerationRemoved = 0
    try {
      await removeAssistantRebuildableLookupGenerationAtPaths({
        generation: building.generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      })
      failedGenerationRemoved = 1
    } catch {
      // The generation is disposable. Cleanup below retries any residue.
    }
    const generationsRemoved =
      failedGenerationRemoved +
      (await cleanupAssistantOutboxLookupGenerationsAtPaths({
        paths: input.paths,
        publication,
      }))
    return {
      canonicalIntentsProcessed,
      changed: true,
      generationsRemoved,
      lookupWrites,
      rebuildCompleted: false,
      rebuildResumed,
      rebuildStarted,
      repairPerformed,
      trusted: publication.active !== null,
    }
  }

  const hasRemaining = sortedIntents.some((intent) =>
    afterIntentId === null || intent.intentId.localeCompare(afterIntentId) > 0,
  )
  if (hasRemaining || input.shouldYield?.() === true) {
    publication = {
      ...publication,
      building: {
        ...building,
        afterIntentId,
        bucketDigests: buildingView.bucketDigests,
      },
    }
    await writeAssistantOutboxLookupPublicationAtPaths(input.paths, publication)
    lookupWrites += 1
    changed = true
  } else {
    const generationTrusted =
      await validateAssistantRebuildableLookupGenerationAtPaths({
        bucketDigests: buildingView.bucketDigests,
        generation: buildingView.generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      }) && assistantOutboxLookupGenerationMatchesCanonical({
        generation: buildingView.generation,
        intents: input.outboxIntents,
        paths: input.paths,
        publishedBucketDigests: buildingView.bucketDigests,
      })
    if (!generationTrusted) {
      publication = {
        ...publication,
        building: null,
      }
      await writeAssistantOutboxLookupPublicationAtPaths(input.paths, publication)
      lookupWrites += 1
      changed = true
      repairPerformed = true
    } else {
      publication = {
        active: {
          bucketDigests: buildingView.bucketDigests,
          generation: buildingView.generation,
          publicationId: createUniqueId(),
          publishedAt: new Date().toISOString(),
        },
        building: null,
        writerVersion: ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION,
      }
      await writeAssistantOutboxLookupPublicationAtPaths(input.paths, publication)
      lookupWrites += 1
      rebuildCompleted = true
      changed = true
      await rm(path.join(input.paths.outboxDirectory, '.lookups-v1'), {
        force: true,
        recursive: true,
      }).catch(() => undefined)
    }
  }

  const generationsRemoved = await cleanupAssistantOutboxLookupGenerationsAtPaths({
    paths: input.paths,
    publication,
  })
  return {
    canonicalIntentsProcessed,
    changed: changed || generationsRemoved > 0,
    generationsRemoved,
    lookupWrites,
    rebuildCompleted,
    rebuildResumed,
    rebuildStarted,
    repairPerformed,
    trusted: publication.active !== null,
  }
}

export function readAssistantOutboxDeliveryProviderMessageIds(
  delivery: AssistantOutboxMessageDelivery,
): string[] {
  const orderedProviderMessageIds = Array.isArray(delivery.providerMessageIds)
    ? delivery.providerMessageIds
        .map((id: unknown) =>
          typeof id === 'string'
            ? readAssistantTargetProviderScalar(id)
            : null,
        )
        .filter((id: string | null): id is string => id !== null)
    : []
  const legacyProviderMessageId = readAssistantTargetProviderScalar(
    delivery.providerMessageId,
  )
  if (
    orderedProviderMessageIds.length === 0 &&
    (delivery.providerMessageEffects?.length ?? 0) > 1
  ) {
    return []
  }
  return [...new Set([
    ...orderedProviderMessageIds,
    legacyProviderMessageId,
  ].filter((id): id is string => id !== null))]
}

export function resolveAssistantOutboxProviderMessageMemberships(
  intent: AssistantOutboxIntent,
): readonly AssistantOutboxLookupRefMembership[] {
  const memberships: AssistantOutboxLookupRefMembership[] = []
  if (isAssistantOutboxLookupCanonicalMutationIncomplete(intent)) {
    memberships.push({
      key: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KEY,
      kind: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KIND,
      maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
    })
  }
  if (!isAssistantOutboxProviderMessageEligible(intent)) {
    return memberships
  }
  const delivery = intent.delivery as AssistantOutboxMessageDelivery
  const channel = normalizeNullableString(delivery.channel)?.toLowerCase() ?? null
  const providerMessageIds = readAssistantOutboxDeliveryProviderMessageIds(delivery)
  if (!channel || providerMessageIds.length === 0) {
    return memberships
  }
  if (
    providerMessageIds.length >
    ASSISTANT_OUTBOX_LOOKUP_PROVIDER_IDS_PER_INTENT
  ) {
    memberships.push({
      key: ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KEY,
      kind: ASSISTANT_OUTBOX_PROVIDER_INCOMPLETE_LOOKUP_KIND,
      maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
    })
    return dedupeRefMemberships(memberships)
  }
  memberships.push(...providerMessageIds.map((providerMessageId) => ({
    key: buildAssistantOutboxProviderMessageLookupKey({
      channel,
      providerMessageId,
    }),
    kind: ASSISTANT_OUTBOX_PROVIDER_MESSAGE_LOOKUP_KIND,
    maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
  })))
  return dedupeRefMemberships(memberships)
}

export function isAssistantOutboxLookupCanonicalMutationIncomplete(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.status === 'sending' &&
    !hasAssistantOutboxDeliveryEvidence(intent, true)
}

export function isAssistantOutboxProviderMessageEligible(
  intent: AssistantOutboxIntent,
): boolean {
  if (
    intent.operation !== null ||
    !hasAssistantOutboxDeliveryEvidence(intent, true) ||
    (
      normalizeNullableString(intent.message) === null &&
      intent.media.length === 0
    )
  ) {
    return false
  }
  const delivery = intent.delivery
  return Boolean(
    delivery &&
    delivery.kind !== 'message-reaction' &&
    Number.isFinite(Date.parse(delivery.sentAt)),
  )
}

export function buildAssistantOutboxProviderMessageLookupKey(input: {
  channel: string
  providerMessageId: string
}): string {
  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null
  const providerMessageId = readAssistantTargetProviderScalar(
    input.providerMessageId,
  )
  if (!channel || !providerMessageId) {
    throw new TypeError(
      'Assistant outbox provider-message lookup requires channel and provider id.',
    )
  }
  return JSON.stringify([channel, providerMessageId])
}

export function resolveAssistantOutboxLookupPublicationPath(
  paths: AssistantStatePaths,
): string {
  return path.join(
    resolveAssistantRebuildableLookupOwnerDirectory({
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths,
    }),
    'publication.json',
  )
}

async function runAssistantOutboxStableLookupAtPaths<T>(input: {
  paths: AssistantStatePaths
  run(
    active: AssistantOutboxLookupGenerationPublicationV1,
  ): Promise<AssistantOutboxStableLookupOperationResult<T>>
}): Promise<
  | {
      kind: 'fallback'
      metrics: AssistantOutboxLookupReadMetrics
      reason: string
    }
  | {
      kind: 'value'
      metrics: AssistantOutboxLookupReadMetrics
      value: T
    }
> {
  const startedAt = Date.now()
  const aggregate = createEmptyOperationMetrics()
  let publicationRetries = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await readAssistantOutboxLookupPublicationAtPaths(input.paths)
    aggregate.lookup.bytesRead += before.metrics.bytesRead
    aggregate.lookup.filesRead += before.metrics.filesRead
    const beforeActive = before.kind === 'value'
      ? before.value?.active ?? null
      : null
    if (beforeActive === null) {
      return stableFallback(
        before.kind === 'invalid'
          ? 'publication-invalid'
          : before.kind === 'missing'
            ? 'publication-missing'
            : 'publication-incomplete',
        aggregate,
        publicationRetries,
        startedAt,
      )
    }

    let operation: AssistantOutboxStableLookupOperationResult<T>
    const guardMetrics = createEmptyOperationMetrics()
    const mutationBarrier = await readIntentRefsAtPaths({
      active: beforeActive,
      key: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KEY,
      kind: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KIND,
      maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
      metrics: guardMetrics,
      paths: input.paths,
    })
    if (mutationBarrier.kind === 'fallback') {
      operation = operationFallback(mutationBarrier.reason, guardMetrics)
    } else if (mutationBarrier.refs !== null) {
      operation = operationFallback(
        'lookup-canonical-mutation-incomplete',
        guardMetrics,
      )
    } else {
      try {
        operation = await input.run(beforeActive)
      } catch {
        operation = operationFallback(
          'lookup-operation-failed',
          createEmptyOperationMetrics(),
        )
      }
      addOperationMetrics(operation.metrics, guardMetrics)
    }
    addOperationMetrics(aggregate, operation.metrics)

    const after = await readAssistantOutboxLookupPublicationAtPaths(input.paths)
    aggregate.lookup.bytesRead += after.metrics.bytesRead
    aggregate.lookup.filesRead += after.metrics.filesRead
    const afterActive = after.kind === 'value'
      ? after.value?.active ?? null
      : null
    const stable = afterActive !== null &&
      afterActive.generation === beforeActive.generation &&
      afterActive.publicationId === beforeActive.publicationId
    if (!stable) {
      if (attempt === 0) {
        publicationRetries += 1
        continue
      }
      return stableFallback(
        'publication-changed',
        aggregate,
        publicationRetries,
        startedAt,
      )
    }
    if (operation.kind === 'fallback') {
      return stableFallback(
        operation.reason ?? 'lookup-invalid',
        aggregate,
        publicationRetries,
        startedAt,
      )
    }
    return {
      kind: 'value',
      metrics: finalizeReadMetrics(
        aggregate,
        publicationRetries,
        startedAt,
      ),
      value: operation.value as T,
    }
  }
  return stableFallback(
    'publication-changed',
    aggregate,
    publicationRetries,
    startedAt,
  )
}

async function isAssistantOutboxLookupMutationBarrierPublishedAtPaths(input: {
  active: AssistantOutboxLookupGenerationPublicationV1
  intentId: string
  paths: AssistantStatePaths
}): Promise<boolean> {
  const read = await readAssistantRebuildableLookupAtPaths({
    bucketDigests: input.active.bucketDigests,
    generation: input.active.generation,
    key: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KEY,
    kind: ASSISTANT_OUTBOX_CANONICAL_MUTATION_INCOMPLETE_LOOKUP_KIND,
    owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    parseValue: (value) => parseAssistantOutboxIntentRefs(
      value,
      ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
    ),
    paths: input.paths,
  })
  return read.kind === 'value' && (
    read.value.state !== 'complete' ||
    read.value.intentIds.includes(input.intentId)
  )
}

async function readValidatedRefIntentsAtPaths(input: {
  active: AssistantOutboxLookupGenerationPublicationV1
  canonicalCache: Map<string, AssistantOutboxIntent | null>
  key: string
  kind: string
  maxRefs: number
  metrics: AssistantOutboxStableLookupOperationMetrics
  paths: AssistantStatePaths
  reader: AssistantOutboxLookupCanonicalReader
  validate(intent: AssistantOutboxIntent): boolean
}): Promise<
  | { intents: AssistantOutboxIntent[]; kind: 'complete' }
  | { kind: 'fallback'; reason: string }
> {
  const refs = await readIntentRefsAtPaths(input)
  if (refs.kind === 'fallback') {
    return refs
  }
  const intents: AssistantOutboxIntent[] = []
  for (const intentId of refs.refs?.intentIds ?? []) {
    const intent = await readCanonicalIntentCached({
      cache: input.canonicalCache,
      intentId,
      metrics: input.metrics.canonical,
      reader: input.reader,
    })
    if (!intent || !input.validate(intent)) {
      return {
        kind: 'fallback',
        reason: 'canonical-validation-failed',
      }
    }
    intents.push(intent)
  }
  return { intents, kind: 'complete' }
}

async function readIntentRefsAtPaths(input: {
  active: AssistantOutboxLookupGenerationPublicationV1
  key: string
  kind: string
  maxRefs: number
  metrics: AssistantOutboxStableLookupOperationMetrics
  paths: AssistantStatePaths
}): Promise<
  | { kind: 'complete'; refs: AssistantOutboxIntentRefsV1 | null }
  | { kind: 'fallback'; reason: string }
> {
  const read = await readAssistantRebuildableLookupAtPaths({
    bucketDigests: input.active.bucketDigests,
    generation: input.active.generation,
    key: input.key,
    kind: input.kind,
    owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    parseValue: (value) => parseAssistantOutboxIntentRefs(value, input.maxRefs),
    paths: input.paths,
  })
  addLookupMetrics(input.metrics.lookup, read.metrics)
  if (read.kind === 'invalid') {
    return {
      kind: 'fallback',
      reason: `lookup-${read.reason}`,
    }
  }
  if (read.kind === 'absent') {
    return { kind: 'complete', refs: null }
  }
  if (read.value.state !== 'complete') {
    return {
      kind: 'fallback',
      reason: `lookup-${read.value.state}`,
    }
  }
  return { kind: 'complete', refs: read.value }
}

async function readCanonicalIntentCached(input: {
  cache: Map<string, AssistantOutboxIntent | null>
  intentId: string
  metrics: AssistantOutboxLookupCanonicalReadMetrics
  reader: AssistantOutboxLookupCanonicalReader
}): Promise<AssistantOutboxIntent | null> {
  if (input.cache.has(input.intentId)) {
    return input.cache.get(input.intentId) ?? null
  }
  input.metrics.filesRead += 1
  let intent: AssistantOutboxIntent | null
  try {
    intent = await input.reader.readIntent(input.intentId, (bytes) => {
      input.metrics.bytesRead += bytes
    })
  } catch {
    intent = null
  }
  input.cache.set(input.intentId, intent)
  return intent
}

function buildAssistantOutboxLookupTransitionPlan(
  previous: AssistantOutboxIntent | null,
  next: AssistantOutboxIntent | null,
): AssistantOutboxLookupTransitionPlan {
  const oldSnapshot = buildAssistantOutboxLookupMembershipSnapshot(previous)
  const newSnapshot = buildAssistantOutboxLookupMembershipSnapshot(next)
  const refAdditions = [...newSnapshot.refs.entries()]
    .filter(([identity]) => !oldSnapshot.refs.has(identity))
    .map(([, membership]) => membership)
  const refRemovals = [...oldSnapshot.refs.entries()]
    .filter(([identity]) => !newSnapshot.refs.has(identity))
    .map(([, membership]) => membership)
  const routeUpserts = [...newSnapshot.routes.entries()]
    .filter(([identity, membership]) => {
      const previousMembership = oldSnapshot.routes.get(identity)
      return !previousMembership ||
        JSON.stringify(previousMembership) !== JSON.stringify(membership)
    })
    .map(([, membership]) => membership)
  const routeRemovals = [...oldSnapshot.routes.entries()]
    .filter(([identity]) => !newSnapshot.routes.has(identity))
    .map(([, membership]) => membership)
  const changedRecords = new Set([
    ...refAdditions.map(refMembershipIdentity),
    ...refRemovals.map(refMembershipIdentity),
    ...routeUpserts.map((item) =>
      lookupIdentity(ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND, item.membership.lookupKey),
    ),
    ...routeRemovals.map((item) =>
      lookupIdentity(ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND, item.membership.lookupKey),
    ),
  ])
  if (
    changedRecords.size >
    ASSISTANT_OUTBOX_LOOKUP_MAX_CHANGED_RECORDS_PER_MUTATION
  ) {
    throw new TypeError(
      'Assistant outbox lookup mutation exceeds its fixed changed-record budget.',
    )
  }
  return {
    refAdditions,
    refRemovals,
    routeRemovals,
    routeUpserts,
  }
}

function buildAssistantOutboxLookupMembershipSnapshot(
  intent: AssistantOutboxIntent | null,
): AssistantOutboxLookupMembershipSnapshot {
  const refs = new Map<string, AssistantOutboxLookupRefMembership>()
  const routes = new Map<string, ReturnType<
    typeof resolveAssistantAutoReplyRouteProjectionIntentMemberships
  >[number]>()
  if (!intent) {
    return { refs, routes }
  }

  if (isActiveAssistantOutboxIntent(intent)) {
    addRefMembership(refs, {
      key: intent.dedupeKey,
      kind: ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
      maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
    })
    const deliveryIdempotencyKey = normalizeNullableString(
      intent.deliveryIdempotencyKey,
    )
    if (deliveryIdempotencyKey) {
      addRefMembership(refs, {
        key: deliveryIdempotencyKey,
        kind: ASSISTANT_OUTBOX_ACTIVE_DELIVERY_IDEMPOTENCY_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
      })
    }
    if (intent.legacyDedupeLookupKey === undefined) {
      addRefMembership(refs, {
        key: ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KEY,
        kind: ASSISTANT_OUTBOX_UNCLASSIFIED_LEGACY_DEDUPE_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_UNCLASSIFIED_MAX_REFS,
      })
    } else if (intent.legacyDedupeLookupKey !== null) {
      addRefMembership(refs, {
        key: intent.legacyDedupeLookupKey,
        kind: ASSISTANT_OUTBOX_ACTIVE_LEGACY_DEDUPE_ALIAS_LOOKUP_KIND,
        maxRefs: ASSISTANT_OUTBOX_LOOKUP_MAX_REFS,
      })
    }
  }

  for (const membership of resolveAssistantOutboxProviderMessageMemberships(intent)) {
    addRefMembership(refs, membership)
  }
  for (const membership of resolveAssistantAutoReplyRouteProjectionIntentMemberships(intent)) {
    const identity = lookupIdentity(
      ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
      membership.membership.lookupKey,
    )
    const current = routes.get(identity)
    if (current && JSON.stringify(current) !== JSON.stringify(membership)) {
      throw new TypeError(
        'Assistant outbox intent produced conflicting route projection memberships.',
      )
    }
    routes.set(identity, membership)
  }
  return { refs, routes }
}

function buildAssistantOutboxExpectedLookupChanges(
  intents: readonly AssistantOutboxIntent[],
): AssistantRebuildableLookupChange[] {
  const refs = new Map<string, {
    membership: AssistantOutboxLookupRefMembership
    value: AssistantOutboxIntentRefsV1
  }>()
  const routes = new Map<string, {
    key: string
    value: AssistantAutoReplyRouteProjectionV1
  }>()

  for (const intent of [...intents].sort((left, right) =>
    left.intentId.localeCompare(right.intentId),
  )) {
    const snapshot = buildAssistantOutboxLookupMembershipSnapshot(intent)
    for (const [identity, membership] of snapshot.refs) {
      const current = refs.get(identity)?.value ?? null
      refs.set(identity, {
        membership,
        value: upsertAssistantOutboxIntentRef({
          current,
          intentId: intent.intentId,
          maxRefs: membership.maxRefs,
        }),
      })
    }
    for (const [identity, membership] of snapshot.routes) {
      const current = routes.get(identity)?.value ?? null
      routes.set(identity, {
        key: membership.membership.lookupKey,
        value: upsertAssistantAutoReplyRouteProjectionCandidate({
          candidate: membership.candidate,
          current,
          membership: membership.membership,
        }),
      })
    }
  }

  return [
    ...[...refs.values()].map(({ membership, value }) => ({
      key: membership.key,
      kind: membership.kind,
      value,
    })),
    ...[...routes.values()].map(({ key, value }) => ({
      key,
      kind: ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
      value,
    })),
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key),
  )
}

function assistantOutboxLookupGenerationMatchesCanonical(input: {
  generation: string
  intents: readonly AssistantOutboxIntent[]
  paths: AssistantStatePaths
  publishedBucketDigests: Readonly<Record<string, string>>
}): boolean {
  try {
    const expected = computeAssistantRebuildableLookupBucketDigests({
      changes: buildAssistantOutboxExpectedLookupChanges(input.intents),
      generation: input.generation,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths: input.paths,
    })
    return Object.keys(expected).every(
      (bucketId) => expected[bucketId] === input.publishedBucketDigests[bucketId],
    )
  } catch {
    return false
  }
}

async function applyAssistantOutboxLookupPlanPhaseAtPaths(input: {
  intentId: string
  paths: AssistantStatePaths
  phase: 'additions' | 'removals'
  plan: AssistantOutboxLookupTransitionPlan
  view: AssistantOutboxLookupGenerationView
}): Promise<AssistantOutboxGenerationUpdateResult> {
  const changes: AssistantRebuildableLookupChange[] = []
  const refMemberships = input.phase === 'additions'
    ? input.plan.refAdditions
    : input.plan.refRemovals
  for (const membership of refMemberships) {
    const read = await readAssistantRebuildableLookupAtPaths({
      bucketDigests: input.view.bucketDigests,
      generation: input.view.generation,
      key: membership.key,
      kind: membership.kind,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      parseValue: (value) => parseAssistantOutboxIntentRefs(
        value,
        membership.maxRefs,
      ),
      paths: input.paths,
    })
    if (read.kind === 'invalid') {
      throw new Error(`Assistant outbox lookup record is invalid: ${read.reason}`)
    }
    const current = read.kind === 'value' ? read.value : null
    const next = input.phase === 'additions'
      ? upsertAssistantOutboxIntentRef({
          current,
          intentId: input.intentId,
          maxRefs: membership.maxRefs,
        })
      : current
        ? removeAssistantOutboxIntentRef({
            current,
            intentId: input.intentId,
          })
        : null
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      changes.push({
        key: membership.key,
        kind: membership.kind,
        value: next,
      })
    }
  }

  const routeMemberships = input.phase === 'additions'
    ? input.plan.routeUpserts
    : input.plan.routeRemovals
  for (const routeMembership of routeMemberships) {
    const key = routeMembership.membership.lookupKey
    const read = await readAssistantRebuildableLookupAtPaths({
      bucketDigests: input.view.bucketDigests,
      generation: input.view.generation,
      key,
      kind: ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      parseValue: parseAssistantAutoReplyRouteProjection,
      paths: input.paths,
    })
    if (read.kind === 'invalid') {
      throw new Error(`Assistant outbox route lookup is invalid: ${read.reason}`)
    }
    const current = read.kind === 'value' ? read.value : null
    const next = input.phase === 'additions'
      ? upsertAssistantAutoReplyRouteProjectionCandidate({
          candidate: routeMembership.candidate,
          current,
          membership: routeMembership.membership,
        })
      : current
        ? removeAssistantAutoReplyRouteProjectionCandidate({
            current,
            intentId: input.intentId,
          })
        : null
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      changes.push({
        key,
        kind: ASSISTANT_AUTO_REPLY_ROUTE_LOOKUP_KIND,
        value: next,
      })
    }
  }

  if (changes.length === 0) {
    return { logicalWrites: 0, view: input.view }
  }
  const applied = await applyAssistantRebuildableLookupChangesAtPaths({
    bucketDigests: input.view.bucketDigests,
    changes,
    generation: input.view.generation,
    owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    paths: input.paths,
  })
  return {
    logicalWrites: applied.logicalWrites,
    view: {
      bucketDigests: applied.bucketDigests,
      generation: input.view.generation,
    },
  }
}

function upsertAssistantOutboxIntentRef(input: {
  current: AssistantOutboxIntentRefsV1 | null
  intentId: string
  maxRefs: number
}): AssistantOutboxIntentRefsV1 {
  const ids = [...new Set([
    ...(input.current?.intentIds ?? []),
    input.intentId,
  ])].sort()
  if (input.current?.state === 'degraded') {
    return {
      intentIds: ids.slice(0, input.maxRefs),
      state: 'degraded',
    }
  }
  if (
    input.current?.state === 'overflow' ||
    ids.length > input.maxRefs
  ) {
    return {
      intentIds: ids.slice(0, input.maxRefs),
      state: 'overflow',
    }
  }
  return { intentIds: ids, state: 'complete' }
}

function removeAssistantOutboxIntentRef(input: {
  current: AssistantOutboxIntentRefsV1
  intentId: string
}): AssistantOutboxIntentRefsV1 | null {
  const intentIds = input.current.intentIds.filter(
    (intentId) => intentId !== input.intentId,
  )
  return intentIds.length === 0 && input.current.state === 'complete'
    ? null
    : {
        ...input.current,
        intentIds,
      }
}

function parseAssistantOutboxIntentRefs(
  value: unknown,
  maxRefs: number,
): AssistantOutboxIntentRefsV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['intentIds', 'state'])) {
    throw new TypeError('Assistant outbox lookup refs must be a strict object.')
  }
  if (
    value.state !== 'complete' &&
    value.state !== 'degraded' &&
    value.state !== 'overflow'
  ) {
    throw new TypeError('Assistant outbox lookup refs state is invalid.')
  }
  if (
    !Array.isArray(value.intentIds) ||
    (value.state === 'complete' && value.intentIds.length === 0) ||
    value.intentIds.length > maxRefs
  ) {
    throw new TypeError('Assistant outbox lookup refs exceed their fixed bound.')
  }
  const intentIds = value.intentIds.map((intentId) =>
    parseStrictAssistantOutboxIntentId(intentId),
  )
  if (
    new Set(intentIds).size !== intentIds.length ||
    intentIds.some((intentId, index) =>
      index > 0 && intentIds[index - 1]!.localeCompare(intentId) >= 0,
    )
  ) {
    throw new TypeError('Assistant outbox lookup refs must be sorted and unique.')
  }
  return { intentIds, state: value.state }
}

function assistantOutboxLookupTransitionPlanHasChanges(
  plan: AssistantOutboxLookupTransitionPlan,
): boolean {
  return plan.refAdditions.length > 0 ||
    plan.refRemovals.length > 0 ||
    plan.routeRemovals.length > 0 ||
    plan.routeUpserts.length > 0
}

function dedupeRefMemberships(
  memberships: readonly AssistantOutboxLookupRefMembership[],
): AssistantOutboxLookupRefMembership[] {
  const byIdentity = new Map<string, AssistantOutboxLookupRefMembership>()
  for (const membership of memberships) {
    byIdentity.set(refMembershipIdentity(membership), membership)
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key),
  )
}

function addRefMembership(
  target: Map<string, AssistantOutboxLookupRefMembership>,
  membership: AssistantOutboxLookupRefMembership,
): void {
  const identity = refMembershipIdentity(membership)
  const current = target.get(identity)
  if (current && current.maxRefs !== membership.maxRefs) {
    throw new TypeError('Assistant outbox lookup membership bounds conflict.')
  }
  target.set(identity, membership)
}

function refMembershipIdentity(
  membership: AssistantOutboxLookupRefMembership,
): string {
  return lookupIdentity(membership.kind, membership.key)
}

function lookupIdentity(kind: string, key: string): string {
  return JSON.stringify([kind, key])
}

function isActiveAssistantOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return intent.status !== 'failed' && intent.status !== 'abandoned'
}

function generationViewFromActive(
  active: AssistantOutboxLookupGenerationPublicationV1,
): AssistantOutboxLookupGenerationView {
  return {
    bucketDigests: active.bucketDigests,
    generation: active.generation,
  }
}

function generationViewFromBuilding(
  building: AssistantOutboxLookupBuildingPublicationV1,
): AssistantOutboxLookupGenerationView {
  return {
    bucketDigests: building.bucketDigests,
    generation: building.generation,
  }
}

function buildingPublicationFromView(
  building: AssistantOutboxLookupBuildingPublicationV1,
  view: AssistantOutboxLookupGenerationView,
): AssistantOutboxLookupBuildingPublicationV1 {
  return {
    ...building,
    bucketDigests: view.bucketDigests,
    generation: view.generation,
  }
}

function createEmptyAssistantOutboxLookupPublication(): AssistantOutboxLookupPublicationV1 {
  return {
    active: null,
    building: null,
    writerVersion: ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION,
  }
}

function createAssistantOutboxLookupBuildingPublication(
  startedAt: string,
): AssistantOutboxLookupBuildingPublicationV1 {
  const generation = createUniqueId()
  return {
    afterIntentId: null,
    bucketDigests: createEmptyAssistantRebuildableLookupBucketDigests({
      generation,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    }),
    buildId: createUniqueId(),
    generation,
    startedAt,
  }
}

async function resetAssistantOutboxLookupAfterFailedCanonicalWriteAtPaths(input: {
  paths: AssistantStatePaths
  publication: AssistantOutboxLookupPublicationV1
}): Promise<void> {
  const failedGenerations = [
    input.publication.active?.generation,
    input.publication.building?.generation,
  ].filter((value): value is string => value !== undefined)
  const next = createEmptyAssistantOutboxLookupPublication()
  next.building = createAssistantOutboxLookupBuildingPublication(
    new Date().toISOString(),
  )
  await writeAssistantOutboxLookupPublicationAtPaths(input.paths, next)
  await Promise.all(
    failedGenerations.map((generation) =>
      removeAssistantRebuildableLookupGenerationAtPaths({
        generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      }).catch(() => undefined),
    ),
  )
}

async function cleanupAssistantOutboxLookupGenerationsAtPaths(input: {
  paths: AssistantStatePaths
  publication: AssistantOutboxLookupPublicationV1
}): Promise<number> {
  const keep = new Set([
    input.publication.active?.generation,
    input.publication.building?.generation,
  ].filter((value): value is string => value !== undefined))
  const generations = await listAssistantRebuildableLookupGenerationsAtPaths({
    owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    paths: input.paths,
  })
  let removed = 0
  for (const generation of generations) {
    if (keep.has(generation)) {
      continue
    }
    try {
      await removeAssistantRebuildableLookupGenerationAtPaths({
        generation,
        owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
        paths: input.paths,
      })
      removed += 1
    } catch {}
  }
  return removed
}

async function readAssistantOutboxLookupPublicationAtPaths(
  paths: AssistantStatePaths,
): Promise<AssistantOutboxPublicationReadResult> {
  let raw: string
  try {
    raw = await readFile(
      resolveAssistantOutboxLookupPublicationPath(paths),
      'utf8',
    )
  } catch (error) {
    return isMissingFileError(error)
      ? {
          kind: 'missing',
          metrics: { bytesRead: 0, filesRead: 0 },
        }
      : {
          kind: 'invalid',
          metrics: { bytesRead: 0, filesRead: 1 },
        }
  }

  const bytesRead = Buffer.byteLength(raw, 'utf8')
  if (bytesRead > ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_FILE_MAX_BYTES) {
    return {
      kind: 'invalid',
      metrics: { bytesRead, filesRead: 1 },
    }
  }

  try {
    const value = parseVersionedJsonStateEnvelope(JSON.parse(raw), {
      label: 'assistant outbox lookup publication',
      parseValue: parseAssistantOutboxLookupPublication,
      schema: ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA,
      schemaVersion: ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA_VERSION,
    })
    return {
      kind: 'value',
      metrics: { bytesRead, filesRead: 1 },
      value,
    }
  } catch {
    return {
      kind: 'invalid',
      metrics: { bytesRead, filesRead: 1 },
    }
  }
}

async function writeAssistantOutboxLookupPublicationAtPaths(
  paths: AssistantStatePaths,
  publication: AssistantOutboxLookupPublicationV1,
): Promise<void> {
  const parsed = parseAssistantOutboxLookupPublication(publication)
  await writeVersionedJsonStateFile({
    filePath: resolveAssistantOutboxLookupPublicationPath(paths),
    schema: ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA,
    schemaVersion: ASSISTANT_OUTBOX_LOOKUP_PUBLICATION_SCHEMA_VERSION,
    value: parsed,
  })
}

function parseAssistantOutboxLookupPublication(
  value: unknown,
): AssistantOutboxLookupPublicationV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'active',
    'building',
    'writerVersion',
  ])) {
    throw new TypeError('Assistant outbox lookup publication must be a strict object.')
  }
  if (value.writerVersion !== ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION) {
    throw new TypeError('Assistant outbox lookup writer version is unsupported.')
  }
  const active = value.active === null
    ? null
    : parseAssistantOutboxLookupActivePublication(value.active)
  const building = value.building === null
    ? null
    : parseAssistantOutboxLookupBuildingPublication(value.building)
  if (active && building && active.generation === building.generation) {
    throw new TypeError(
      'Assistant outbox lookup active and building generations must be distinct.',
    )
  }
  return {
    active,
    building,
    writerVersion: ASSISTANT_OUTBOX_LOOKUP_WRITER_VERSION,
  }
}

function parseAssistantOutboxLookupActivePublication(
  value: unknown,
): AssistantOutboxLookupGenerationPublicationV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'bucketDigests',
    'generation',
    'publicationId',
    'publishedAt',
  ])) {
    throw new TypeError('Assistant outbox active lookup publication is invalid.')
  }
  return {
    bucketDigests: parseAssistantRebuildableLookupBucketDigests(
      value.bucketDigests,
    ),
    generation: parseUniqueId(value.generation, 'generation'),
    publicationId: parseUniqueId(value.publicationId, 'publication id'),
    publishedAt: parseIsoTimestamp(value.publishedAt, 'publication timestamp'),
  }
}

function parseAssistantOutboxLookupBuildingPublication(
  value: unknown,
): AssistantOutboxLookupBuildingPublicationV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'afterIntentId',
    'bucketDigests',
    'buildId',
    'generation',
    'startedAt',
  ])) {
    throw new TypeError('Assistant outbox building lookup publication is invalid.')
  }
  const afterIntentId = value.afterIntentId === null
    ? null
    : parseStrictAssistantOutboxIntentId(value.afterIntentId)
  return {
    afterIntentId,
    bucketDigests: parseAssistantRebuildableLookupBucketDigests(
      value.bucketDigests,
    ),
    buildId: parseUniqueId(value.buildId, 'build id'),
    generation: parseUniqueId(value.generation, 'generation'),
    startedAt: parseIsoTimestamp(value.startedAt, 'build timestamp'),
  }
}

function operationValue<T>(
  value: T,
  metrics: AssistantOutboxStableLookupOperationMetrics,
): AssistantOutboxStableLookupOperationResult<T> {
  return { kind: 'value', metrics, value }
}

function operationFallback<T>(
  reason: string,
  metrics: AssistantOutboxStableLookupOperationMetrics,
): AssistantOutboxStableLookupOperationResult<T> {
  return { kind: 'fallback', metrics, reason }
}

function stableFallback(
  reason: string,
  metrics: AssistantOutboxStableLookupOperationMetrics,
  publicationRetries: number,
  startedAt: number,
): {
  kind: 'fallback'
  metrics: AssistantOutboxLookupReadMetrics
  reason: string
} {
  return {
    kind: 'fallback',
    metrics: {
      ...finalizeReadMetrics(metrics, publicationRetries, startedAt),
      fallbackReason: reason,
    },
    reason,
  }
}

function createEmptyOperationMetrics(): AssistantOutboxStableLookupOperationMetrics {
  return {
    canonical: { bytesRead: 0, filesRead: 0 },
    lookup: { bytesRead: 0, elapsedMs: 0, filesRead: 0 },
  }
}

function createEmptyReadMetrics(): AssistantOutboxLookupReadMetrics {
  return {
    canonicalValidationBytesRead: 0,
    canonicalValidationFilesRead: 0,
    elapsedMs: 0,
    lookupBytesRead: 0,
    lookupFilesRead: 0,
    publicationRetries: 0,
  }
}

function addLookupMetrics(
  target: AssistantRebuildableLookupReadMetrics,
  source: AssistantRebuildableLookupReadMetrics,
): void {
  target.bytesRead += source.bytesRead
  target.elapsedMs += source.elapsedMs
  target.filesRead += source.filesRead
}

function addOperationMetrics(
  target: AssistantOutboxStableLookupOperationMetrics,
  source: AssistantOutboxStableLookupOperationMetrics,
): void {
  target.canonical.bytesRead += source.canonical.bytesRead
  target.canonical.filesRead += source.canonical.filesRead
  addLookupMetrics(target.lookup, source.lookup)
}

function finalizeReadMetrics(
  metrics: AssistantOutboxStableLookupOperationMetrics,
  publicationRetries: number,
  startedAt: number,
): AssistantOutboxLookupReadMetrics {
  return {
    canonicalValidationBytesRead: metrics.canonical.bytesRead,
    canonicalValidationFilesRead: metrics.canonical.filesRead,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    lookupBytesRead: metrics.lookup.bytesRead,
    lookupFilesRead: metrics.lookup.filesRead,
    publicationRetries,
  }
}

function parseUniqueId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`Assistant outbox lookup ${label} is invalid.`)
  }
  return value
}

function parseIsoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`Assistant outbox lookup ${label} is invalid.`)
  }
  return value
}

function createUniqueId(): string {
  return randomUUID().replace(/-/gu, '')
}

function parseStrictAssistantOutboxIntentId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Assistant outbox lookup intent ref is invalid.')
  }
  const normalized = normalizeAssistantOpaqueId(value)
  if (normalized === null || normalized !== value) {
    throw new TypeError('Assistant outbox lookup intent ref is invalid.')
  }
  return value
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
