import { randomUUID } from 'node:crypto'
import { parseAutomationSupportSeriesTag } from '@murphai/contracts'
import {
  archiveAutomationIfActiveUntilElapsed,
  isVaultError,
  setScheduledLogStatus,
  splitAutomationAvailabilityConflictBlock,
  stripAutomationAvailabilityConflictEvidenceForProvider,
  upsertAutomation,
} from '@murphai/core'
import {
  isHostedRuntimeProcessEnv,
} from '@murphai/hosted-execution/env'
import type {
  HostedRuntimeGroupEmailScheduledAuthority,
  HostedRuntimeScheduledAutomationAuthority,
} from '@murphai/hosted-execution/runtime-control'
import type {
  HostedRuntimeLinqDeliveryBlockCode,
  HostedRuntimeLinqDeliveryPosture,
} from '@murphai/hosted-execution/routes'
import {
  type AutomationQueryRecord,
} from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronRunOutcome,
  type AssistantCronTrigger,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  sendAssistantNotificationLocal,
  type AssistantNotificationResult,
  type AssistantNotificationTurnPolicy,
} from '../../assistant-service.js'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../automation-tags.js'
import { buildAssistantAutomationTurnEnvelope } from '../automation/turn-envelope.js'
import {
  computeAssistantAutomationRetryAt,
  type AssistantRunEvent,
} from '../automation/shared.js'
import {
  appendAssistantHostedDynamicContextPrompt,
  type AssistantExecutionContext,
} from '../execution-context.js'
import {
  isRetiredMurphManagedAutomationId,
  isRecognizedMurphOnboardingFollowupAutomation,
  MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  resolveMurphManagedAutomationOwnerScope,
  resolveMurphManagedMaintenancePolicy,
  type MurphManagedMaintenancePolicy,
} from '../managed-automations.js'
import {
  isAssistantOnboardingStateReadError,
  readAssistantOnboardingState,
} from '../onboarding-state.js'
import {
  isCurrentMurphOnboardingFollowupAutomation,
} from '../onboarding-followup-automation.js'
import {
  runOnboardingGoalCheckinAuthorityPrecondition,
} from '../onboarding-goal-checkin-automation.js'
import {
  buildAssistantLinqDeliveryPosturePrompt,
} from '../linq-delivery-posture.js'
import {
  findAssistantGroupEmailParentIntent,
} from '../group-email-outbox.js'
import {
  runExperimentLifecycleDeliveryAuthorityPrecondition,
  runExperimentLifecycleOutcomePrecondition,
} from '../experiment-support-automations.js'
import {
  assistantDeliveryErrorPreventsFreshIntentRetry,
  isAssistantOutboxRetryableError,
  markAssistantOutboxIntentMirrorTerminalById,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type {
  AssistantDeliveryOutcome,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import {
  ASSISTANT_BOUNDED_CONVERSATION_HISTORY_INCOMPLETE_TEXT,
  errorMessage,
  normalizeNullableString,
} from '../shared.js'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import {
  buildAssistantCronHostedDeliveryIdempotency,
  buildAssistantCronNotificationDedupeToken,
} from './notification-delivery.js'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
  findAssistantCronCanonicalRuntimeRecord,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeRecord,
  type AssistantCronCanonicalRuntimeState,
  type AssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { runScheduledLogCronJob } from './scheduled-log.js'
import {
  assistantDeviceActivityAuthorityKeyMatches,
  buildAssistantDeviceActivityDeliveryIdempotencyKey,
  readAssistantDeviceActivityCronJobMetadata,
} from '../device-activity-cron-tags.js'
import { readAssistantDeviceActivityParentAutomation } from '../device-activity-parent-automation.js'
import {
  buildCanonicalAutomationUpsertInput,
  buildVisibleLocalAssistantCronStore,
  isAssistantCronNotificationOccurrenceFresh,
  isCanonicalAssistantCronNotificationOccurrenceDeliverable,
  isCanonicalAssistantCronSourceEnabled,
  automationContinuityUsesSessionPin,
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  type CanonicalAssistantCronJobRecord,
  type CanonicalAutomationAssistantCronJobRecord,
  resolveCanonicalAssistantCronJobId,
  resolveCanonicalAssistantCronOccurrenceAt,
  resolveCanonicalRuntimeState,
  type ResolvedAssistantCronJob,
} from './canonical-jobs.js'
import {
  appendAssistantCronRun,
  buildAssistantCronTarget,
  isAssistantCronJobDue,
  type AssistantCronStore,
  readAssistantCronStore,
  resolveAssistantCronJobIndex,
  sortAssistantCronJobs,
  writeAssistantCronStore,
} from './store.js'
import {
  resolveAssistantCronFailureBackoffMs,
  resolveAssistantCronNextRunAfterSuccess,
} from './finalization.js'
import {
  resolveAssistantCronNotificationDeliveryRoute,
  validateAssistantCronDeliveryTarget,
} from './targets.js'

const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000
const ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR =
  'Assistant cron notification expired before delivery.'
const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELD_POLL_MS = 250
const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_NON_REPLAYABLE_WORK_ERROR =
  'Assistant background maintenance stopped after provider work; occurrence consumed to avoid replay.'
const ASSISTANT_CRON_MANAGED_OWNER_SCOPE_MISMATCH_ERROR =
  'Managed automation owner no longer matches the live delivery route.'
const HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH =
  'HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH'
const ASSISTANT_CRON_MANAGED_AUTOMATION_RETIRED_ERROR =
  'Managed automation has been retired.'
const ASSISTANT_CRON_FOREGROUND_YIELDED_ERROR =
  'Assistant cron yielded to fresh foreground input.'
const ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR =
  'Device activity occurrence skipped because its parent listener is no longer authorized.'
const ASSISTANT_CRON_ONBOARDING_OPEN_RESEARCH_SKIP_ERROR =
  'Assistant cron research-oriented managed automation skipped because assistant onboarding is open.'
const ASSISTANT_CRON_ONBOARDING_UNREADABLE_RESEARCH_SKIP_ERROR =
  'Assistant cron research-oriented managed automation skipped because assistant onboarding state could not be read.'
const ASSISTANT_CRON_ONBOARDING_FOLLOWUP_COMPLETED_ERROR =
  'Assistant onboarding follow-up skipped because onboarding is completed.'
const ASSISTANT_CRON_ONBOARDING_FOLLOWUP_RECONCILIATION_REQUIRED_ERROR =
  'Assistant onboarding follow-up predecessor is waiting for managed reconciliation.'
const MURPH_RESEARCH_ORIENTED_MANAGED_AUTOMATION_IDS = new Set([
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
])
export const ASSISTANT_CRON_INDEPENDENT_AUTOMATION_AUTHORITY_INSTRUCTIONS = [
  'Independent automation authority (engine-supplied):',
  '- This active saved automation is a current user request. Related plans and experiments are context, not cancellation authority.',
  "- Do not treat a related plan or experiment's completion as cancellation unless the saved instructions explicitly make that state a skip condition.",
  '- Completion of a broader plan is not proof that this occurrence\'s requested action already happened.',
  '- You may still skip when the saved instructions authorize that outcome or current evidence proves the requested action already happened.',
].join('\n')
// Hosted cron turns are off the user hotpath, so clean first runs prefer the
// OpenAI flex tier (~50% token cost). The Codex provider boundary validates
// route support and bounds flex execution with a deadline; failures land in the
// normal cron backoff (30s first retry), and that retry runs at standard tier.

interface DueAssistantCronCandidate {
  canonicalEntry?: {
    job: AssistantCronJob
    runtimeState: AssistantCronCanonicalRuntimeRecord
    source: CanonicalAssistantCronJobRecord
  }
  job: AssistantCronJob
  localJob?: AssistantCronJob
}

export interface AssistantCronRuntimeScopeInput {
  executionContext?: AssistantExecutionContext | null
  turnEnvironment?: AssistantTurnEnvironment | null
}

export interface AssistantCronRunnableProjectionInput
  extends AssistantCronRuntimeScopeInput {
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
}

export interface RunnableAssistantCronCanonicalEntry {
  job: AssistantCronJob
  runtimeState: AssistantCronCanonicalRuntimeRecord
  runtimeStatePresent: boolean
  source: CanonicalAssistantCronJobRecord
}

export interface RunnableAssistantCronJobProjection {
  canonicalEntries: RunnableAssistantCronCanonicalEntry[]
  jobs: AssistantCronJob[]
  visibleLocalStore: ReturnType<typeof buildVisibleLocalAssistantCronStore>
  yieldDeferredBackgroundMaintenanceEntries: RunnableAssistantCronCanonicalEntry[]
}

const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELDED_CODE =
  'ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELDED'
const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELD_RETRY_MS = 30_000

export function computeAssistantCronBackgroundMaintenanceYieldRetryAt(
  nowIso: string,
): string {
  return computeAssistantAutomationRetryAt(
    ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELD_RETRY_MS,
    Date.parse(nowIso),
  )
}

export async function claimResolvedAssistantCronJob(input: {
  job: ResolvedAssistantCronJob
  occurrenceFallbackAt?: string | null
  paths: AssistantStatePaths
}): Promise<ResolvedAssistantCronJob> {
  if (input.job.kind === 'local') {
    const store = await readAssistantCronStore(input.paths)
    const index = resolveAssistantCronJobIndex(store, input.job.job.jobId)
    const existing = store.jobs[index] as AssistantCronJob

    if (existing.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${existing.name}" is already running.`,
      )
    }

    if (existing.state.pendingDeliveryIntentId) {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_PENDING',
        `Assistant cron job "${existing.name}" is waiting for outbound delivery confirmation.`,
      )
    }

    const now = new Date().toISOString()
    const claimed = assistantCronJobSchema.parse({
      ...existing,
      updatedAt: now,
      state: {
        ...existing.state,
        runningAt: now,
        runningPid: process.pid,
      },
    })

    store.jobs[index] = claimed
    await writeAssistantCronStore(input.paths, store)
    return {
      kind: 'local',
      job: claimed,
    }
  }

  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths)
  const currentRuntimeState =
    findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      resolveCanonicalAssistantCronJobId(input.job.source),
    ) ?? input.job.runtimeState

  if (currentRuntimeState.state.runningAt !== null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_RUNNING',
      `Assistant cron job "${input.job.job.name}" is already running.`,
    )
  }

  if (currentRuntimeState.state.pendingDeliveryIntentId) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_PENDING',
      `Assistant cron job "${input.job.job.name}" is waiting for outbound delivery confirmation.`,
    )
  }

  const now = new Date().toISOString()
  const runningClaimId = cryptoRandomCronClaimId()
  const occurrenceAt =
    resolveCanonicalAssistantCronOccurrenceAt(
      input.job.source,
      currentRuntimeState,
    ) ??
    input.occurrenceFallbackAt ??
    now
  const updatedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
    ...currentRuntimeState,
    updatedAt: now,
    state: {
      ...currentRuntimeState.state,
      pendingOccurrenceAt: occurrenceAt,
      retryAfterAt: null,
      runningAt: now,
      runningClaimId,
      runningPid: process.pid,
    },
  }
  upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, updatedRuntimeState)
  await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)

  return {
    kind: 'canonical',
    source: input.job.source,
    runtimeState: updatedRuntimeState,
    job: projectCanonicalAssistantCronJob({
      source: input.job.source,
      runtimeState: updatedRuntimeState,
    }),
  }
}

export async function claimNextDueAssistantCronJob(
  paths: AssistantStatePaths,
  vault: string,
  runtimeScopeInput: AssistantCronRunnableProjectionInput = {},
): Promise<ResolvedAssistantCronJob | null> {
  return withAssistantCronWriteLock(paths, async () => {
    const [store, canonicalRecords, runtimeStore] = await Promise.all([
      readAssistantCronStore(paths),
      listCanonicalAssistantCronRecords(vault, ['active']),
      readAssistantCronCanonicalRuntimeStore(paths),
    ])
    const now = new Date().toISOString()
    const candidate = resolveNextDueAssistantCronCandidate({
      canonicalRecords,
      localStore: store,
      nowIso: now,
      runtimeScopeInput,
      runtimeStore,
    })
    if (!candidate) {
      return null
    }

    if (candidate.localJob) {
      return claimResolvedAssistantCronJob({
        paths,
        job: {
          kind: 'local',
          job: candidate.localJob,
        },
      })
    }

    const canonicalEntry = candidate.canonicalEntry
    if (!canonicalEntry) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_NOT_FOUND',
        `Assistant cron job "${candidate.job.name}" was not found.`,
      )
    }

    return claimResolvedAssistantCronJob({
      paths,
      job: {
        kind: 'canonical',
        source: canonicalEntry.source,
        runtimeState: canonicalEntry.runtimeState,
        job: canonicalEntry.job,
      },
      occurrenceFallbackAt: candidate.job.state.nextRunAt,
    })
  })
}

export function assertAssistantCronJobRunnableInRuntime(input: {
  job: ResolvedAssistantCronJob
} & AssistantCronRuntimeScopeInput): void {
  if (
    input.job.kind !== 'canonical' ||
    canonicalAssistantCronSourceCanRunInRuntime({
      hostedRuntimeProcess: resolveAssistantCronRuntimeScope(input),
      source: input.job.source,
    })
  ) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CRON_RUNTIME_SCOPE_UNAVAILABLE',
    `Assistant cron job "${input.job.job.name}" is not available in this runtime.`,
  )
}

export function buildRunnableAssistantCronJobProjection(input: {
  canonicalRecords: readonly CanonicalAssistantCronJobRecord[]
  localStore: AssistantCronStore
  runtimeScopeInput?: AssistantCronRunnableProjectionInput
  runtimeStore: AssistantCronCanonicalRuntimeStore
}): RunnableAssistantCronJobProjection {
  const runtimeScopeInput = input.runtimeScopeInput ?? {}
  const hostedRuntimeProcess = resolveAssistantCronRuntimeScope(runtimeScopeInput)
  const visibleLocalStore = buildVisibleLocalAssistantCronStore(input.localStore)
  const canonicalEntries: RunnableAssistantCronCanonicalEntry[] = []
  const yieldDeferredBackgroundMaintenanceEntries: RunnableAssistantCronCanonicalEntry[] = []

  for (const source of input.canonicalRecords) {
    if (
      !canonicalAssistantCronSourceCanRunInRuntime({
        hostedRuntimeProcess,
        source,
      })
    ) {
      continue
    }

    const runtimeState = resolveCanonicalRuntimeState(source, input.runtimeStore)
    const entry = {
      source,
      runtimeState,
      runtimeStatePresent: input.runtimeStore.jobs.some(
        (record) => record.jobId === resolveCanonicalAssistantCronJobId(source),
      ),
      job: projectCanonicalAssistantCronJob({
        source,
        runtimeState,
      }),
    }
    // Active foreground yield hides background maintenance from the runnable
    // set, but the entries stay visible here so status/wake computation can
    // schedule the catch-up instead of silently disarming a due occurrence.
    if (
      canonicalAssistantCronSourceIsBackgroundMaintenance(source) &&
      runtimeScopeInput.shouldYieldBackgroundMaintenance?.() === true
    ) {
      yieldDeferredBackgroundMaintenanceEntries.push(entry)
      continue
    }
    canonicalEntries.push(entry)
  }

  return {
    canonicalEntries,
    visibleLocalStore,
    yieldDeferredBackgroundMaintenanceEntries,
    jobs: sortAssistantCronJobs([
      ...visibleLocalStore.jobs,
      ...canonicalEntries.map((entry) => entry.job),
    ]),
  }
}

export function isAssistantCronBackgroundMaintenanceYieldError(
  error: unknown,
): error is VaultCliError {
  return error instanceof VaultCliError &&
    error.code === ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELDED_CODE
}

interface ExecuteClaimedAssistantCronJobInput {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  job: ResolvedAssistantCronJob
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  paths: AssistantStatePaths
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
  turnEnvironment?: AssistantTurnEnvironment | null
  trigger: AssistantCronTrigger
  vault: string
}

interface AssistantCronRunExecutionResult {
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
  runErrorCode: string | null
}

type DeviceActivityParentAuthority = Awaited<
  ReturnType<typeof resolveDeviceActivityParentAuthority>
>

interface AssistantCronOnboardingFollowupDiagnostic {
  activeUntil: string | null
  authorityGate:
    | 'initial'
    | 'pre_provider'
    | 'pre_tool'
    | 'pre_delivery'
    | 'pre_commit'
  occurrenceAt: string
  onboardingStateCreatedAt: string | null
  onboardingStateReadError: 'invalid-json' | 'invalid-schema' | 'read-failed' | 'unknown' | null
  onboardingStateSource: 'default_missing' | 'persisted' | 'read_error'
  onboardingStateStatus: 'completed' | 'open' | 'unreadable'
  onboardingStateUpdatedAt: string | null
  scheduleKind: AssistantCronJob['schedule']['kind']
}

export async function executeClaimedAssistantCronJob(
  rawInput: ExecuteClaimedAssistantCronJobInput,
): Promise<AssistantCronRunExecutionResult> {
  const deviceActivityAuthority = await resolveDeviceActivityParentAuthority({
    job: rawInput.job,
    vault: rawInput.vault,
  })
  const deviceActivityPreparedJob = deviceActivityAuthority.route === null
    ? rawInput.job
    : {
        ...rawInput.job,
        job: assistantCronJobSchema.parse({
          ...rawInput.job.job,
          target: {
            ...rawInput.job.job.target,
            ...deviceActivityAuthority.route,
          },
        }),
      }
  const managedOwnerAuthorityTarget = deviceActivityPreparedJob.job.target
  // Maintenance has no audience. Neutralize only this ephemeral claim after
  // authority preparation; the canonical automation route remains unchanged.
  const preparedJob = assistantCronJobIsPreemptibleBackgroundMaintenance(
    deviceActivityPreparedJob,
  )
    ? {
        ...deviceActivityPreparedJob,
        job: assistantCronJobSchema.parse({
          ...deviceActivityPreparedJob.job,
          target: buildAssistantCronTarget({}),
        }),
      }
    : deviceActivityPreparedJob
  const input = {
    ...rawInput,
    job: preparedJob,
  }
  let claimedJob = input.job.job
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
  let errorCode: string | null = null
  let failureConsumesOccurrence = false
  let foregroundYielded = false
  let outcome: AssistantCronRunOutcome = 'failed'
  let reason = 'unhandled'
  let pendingDeliveryIntentId: string | null = null
  let notificationDecision: AssistantCronRunRecord['notificationDecision'] = null
  let groupEmailRecoveryAuthorized = false
  let canonicalSourceDisposition: AssistantCronCanonicalSourceDisposition = 'current'
  let canonicalSourceSkipReason: string | null = null
  let managedOwnerAuthorization: AssistantCronManagedOwnerAuthorization = {
    kind: 'unmanaged',
  }
  let managedOwnerSkipReason: string | null = null
  let notificationDecisionKind: string | null = null
  let notificationDeliveryOutcomeKind: string | null = null
  let onboardingFollowupDiagnostic:
    | AssistantCronOnboardingFollowupDiagnostic
    | null = null
  // Preemptible background maintenance has exactly one yield owner: the
  // maintenance cancellation below. Wiring the generic foreground poller too
  // (hosted passes the same predicate as both callbacks) created a race
  // where whichever poll aborted first decided between a clean maintenance
  // release and a spurious failed foreground-yield run.
  const maintenanceJob = assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)
  let maintenanceProviderStarted = false
  let notificationProviderStarted = false
  const foregroundPreemption = createAssistantCronForegroundPreemption({
    jobName: claimedJob.name,
    parentSignal: input.signal,
    shouldYield: maintenanceJob ? null : input.shouldYield ?? null,
  })
  const occurrenceAt =
    input.job.kind === 'canonical'
      ? input.job.runtimeState.state.pendingOccurrenceAt ??
        resolveCanonicalAssistantCronOccurrenceAt(
          input.job.source,
          input.job.runtimeState,
        ) ??
        startedAt
      : claimedJob.state.nextRunAt ?? startedAt
  const scheduledGroupEmailAuthority =
    resolveAssistantCronScheduledGroupEmailAuthority({
      job: input.job,
      occurrenceAt,
      trigger: input.trigger,
    })
  const yieldCancellation = createAssistantCronBackgroundMaintenanceCancellation({
    job: input.job,
    signal: foregroundPreemption.signal ?? null,
    shouldYieldBackgroundMaintenance:
      input.shouldYieldBackgroundMaintenance ?? null,
  })
  try {
    if (yieldCancellation.signal.aborted) {
      if (yieldCancellation.yieldRequested()) {
        throw createAssistantCronBackgroundMaintenanceYieldError()
      }

      if (foregroundPreemption.wasForegroundYielded()) {
        throw buildAssistantCronForegroundYieldedError(claimedJob.name)
      }

      throw new VaultCliError(
        'ASSISTANT_CRON_ABORTED',
        `Assistant cron job "${claimedJob.name}" was aborted before it started.`,
      )
    }

    if (yieldCancellation.shouldYield()) {
      throw createAssistantCronBackgroundMaintenanceYieldError()
    }

    if (input.job.kind === 'canonical') {
      await assertCanonicalRuntimeClaimCurrent({
        job: input.job,
        paths: input.paths,
      })
      const authority = await resolveAssistantCronCanonicalSourceAuthority({
        job: input.job,
        now: new Date(startedAt),
        trigger: input.trigger,
        vault: input.vault,
      })
      if (authority.kind !== 'current') {
        canonicalSourceDisposition = authority.kind
        canonicalSourceSkipReason = authority.reason
      }
      if (
        canonicalSourceSkipReason === null
        && scheduledGroupEmailAuthority
      ) {
        groupEmailRecoveryAuthorized = true
        pendingDeliveryIntentId = (
          await findAssistantGroupEmailParentIntent({
            authority: scheduledGroupEmailAuthority,
            vault: input.vault,
          })
        )?.intentId ?? null
      }
    }

    if (
      deviceActivityAuthority.error === null &&
      canonicalSourceSkipReason === null &&
      pendingDeliveryIntentId === null
    ) {
      managedOwnerAuthorization =
        await resolveAssistantCronManagedOwnerAuthorization({
          executionContext: input.executionContext ?? null,
          job: input.job,
          signal: yieldCancellation.signal,
          target: managedOwnerAuthorityTarget,
        })
      if (managedOwnerAuthorization.kind === 'mismatch') {
        managedOwnerSkipReason = ASSISTANT_CRON_MANAGED_OWNER_SCOPE_MISMATCH_ERROR
      } else if (managedOwnerAuthorization.kind === 'retired') {
        managedOwnerSkipReason = ASSISTANT_CRON_MANAGED_AUTOMATION_RETIRED_ERROR
      }
    }

    // Lifecycle-owned writes happen before notification expiry so a cleanup
    // failure remains retryable even when its next attempt crosses the stale
    // delivery window. Expiry may suppress the outbound, never the owner work.
    let lifecycleSkipReason: string | null = null
    if (
      deviceActivityAuthority.error === null &&
      canonicalSourceSkipReason === null &&
      managedOwnerSkipReason === null &&
      pendingDeliveryIntentId === null &&
      input.job.kind === 'canonical' &&
      input.job.source.kind === 'automation'
    ) {
      const onboardingFollowup =
        await readAssistantCronOnboardingFollowupDiagnostic({
          authorityGate: 'initial',
          job: input.job,
          occurrenceAt,
          vault: input.vault,
        })
      if (onboardingFollowup) {
        onboardingFollowupDiagnostic = onboardingFollowup.diagnostic
        if (isAssistantCronOnboardingFollowupPredecessorJob(input.job)) {
          throw buildAssistantCronOnboardingFollowupReconciliationRequiredError()
        } else if (onboardingFollowup.error) {
          throw onboardingFollowup.error
        } else if (
          onboardingFollowup.diagnostic.onboardingStateStatus === 'completed'
        ) {
          lifecycleSkipReason =
            ASSISTANT_CRON_ONBOARDING_FOLLOWUP_COMPLETED_ERROR
        }
      }
      // Route on the immutable automationId so a user-edited slug cannot
      // silently bypass the precondition.
      const onboardingAuthority =
        await runOnboardingGoalCheckinAuthorityPrecondition({
          automationId: input.job.source.automationId,
          occurrenceAt,
          vault: input.vault,
        })
      if (onboardingAuthority.kind === 'skip') {
        lifecycleSkipReason = onboardingAuthority.reason
      }
      const lifecycleResult =
        lifecycleSkipReason === null
          ? await runExperimentLifecycleOutcomePrecondition({
              automationId: input.job.source.automationId,
              tags: input.job.source.tags,
              vault: input.vault,
            })
          : null
      if (lifecycleResult?.kind === 'skip') {
        lifecycleSkipReason = lifecycleResult.reason
      }
    }

    const staleError =
      input.trigger === 'scheduled' &&
        !assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)
        ? resolveStaleAssistantCronNotificationError({
            job: input.job,
            nowIso: startedAt,
            occurrenceAt,
          })
        : null

    if (canonicalSourceSkipReason !== null) {
      outcome = 'skipped_gate'
      reason = `canonical_source_${canonicalSourceDisposition}`
      errorText = canonicalSourceSkipReason
    } else if (deviceActivityAuthority.error !== null) {
      outcome = 'skipped_gate'
      reason = 'device_activity_authority_stale'
      errorText = deviceActivityAuthority.error
    } else if (pendingDeliveryIntentId !== null) {
      outcome = 'delivery_pending'
      reason = 'delivery_pending'
    } else if (managedOwnerSkipReason !== null) {
      outcome = 'skipped_gate'
      reason = managedOwnerSkipReason ===
          ASSISTANT_CRON_MANAGED_AUTOMATION_RETIRED_ERROR
        ? 'managed_automation_retired'
        : 'managed_owner_scope_mismatch'
      errorText = managedOwnerSkipReason
    } else if (staleError) {
      outcome = 'expired'
      reason = 'late_occurrence'
      errorText = staleError.message
      emitAssistantCronOccurrenceExpiredEvent({
        job: input.job,
        latenessMinutes: staleError.latenessMinutes,
        onEvent: input.onEvent,
      })
    } else {
      const onboardingSkipError =
        await resolveResearchOrientedManagedAutomationOnboardingSkipError({
          job: input.job,
          vault: input.vault,
        })

      if (onboardingSkipError !== null) {
        outcome = 'skipped_gate'
        reason = onboardingSkipError === ASSISTANT_CRON_ONBOARDING_OPEN_RESEARCH_SKIP_ERROR
          ? 'onboarding_open'
          : 'onboarding_unreadable'
        errorText = onboardingSkipError
      } else if (
        input.job.kind === 'canonical' &&
        input.job.source.kind === 'scheduledLog'
      ) {
        assertAssistantCronForegroundNotYielded({
          jobName: claimedJob.name,
          shouldYield: input.shouldYield ?? null,
        })
        response = await runScheduledLogCronJob({
          vault: input.vault,
          scheduledLogId: input.job.source.scheduledLogId,
          occurrenceAt,
          beforeWrite: async () => {
            assertAssistantCronForegroundNotYielded({
              jobName: claimedJob.name,
              shouldYield: input.shouldYield ?? null,
            })
          },
        })
        assertAssistantCronForegroundNotYielded({
          jobName: claimedJob.name,
          shouldYield: input.shouldYield ?? null,
        })
        outcome = 'no_op'
        reason = 'scheduled_log'
      } else {
        // Background maintenance never delivers (exact-skip policy), so a
        // stale or unresolvable route must not block the memory work.
        if (!assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)) {
          validateAssistantCronDeliveryTarget(
            claimedJob.target,
            assistantCronExecutionDeliveryTargetProfile(input),
          )
        }
        const serviceTier = resolveAssistantCronTurnServiceTier({
          executionContext: input.executionContext ?? null,
          job: claimedJob,
        })
        const scheduledInvocationAuthority =
          resolveAssistantCronScheduledInvocationAuthority({
            job: input.job,
            occurrenceAt,
            trigger: input.trigger,
          })
        const automationTurn = buildAssistantAutomationTurnEnvelope({
          assistantTargetOverride:
            resolveAssistantCronAutomationTargetOverride(input.job) ??
            deviceActivityAuthority.assistantTargetOverride,
          deliveryDispatchMode: input.deliveryDispatchMode,
          executionContext: input.executionContext,
          scheduledAutomationAuthority: scheduledGroupEmailAuthority,
          scheduledInvocationAuthority,
          scheduledOccurrenceAt: occurrenceAt,
          serviceTier,
          signal: yieldCancellation.signal,
          turnEnvironment: input.turnEnvironment ?? null,
          turnTrigger: 'automation-cron',
        })
        if (lifecycleSkipReason !== null) {
          outcome = 'skipped_gate'
          reason = 'lifecycle_precondition'
          errorText = lifecycleSkipReason
        } else {
          if (yieldCancellation.shouldYield()) {
            throw createAssistantCronBackgroundMaintenanceYieldError()
          }

          if (!maintenanceJob) {
            assertAssistantCronForegroundNotYielded({
              jobName: claimedJob.name,
              shouldYield: input.shouldYield ?? null,
            })
          }
          const authorizedDelivery = maintenanceJob
            ? {
                conversationThreadId: null,
                deliveryPosture: null,
                externalThreadRouteAuthority: null,
                route: resolveAssistantCronNotificationDeliveryRoute(claimedJob.target),
              }
            : managedOwnerAuthorization.kind === 'authorized'
              ? managedOwnerAuthorization.authorizedDelivery
              : await resolveAssistantCronAuthorizedNotificationDeliveryRoute({
                  executionContext: input.executionContext ?? null,
                  signal: yieldCancellation.signal,
                  target: claimedJob.target,
                })
          const deliveryRoute = authorizedDelivery.route
          const postureExecutionContext =
            appendAssistantHostedDynamicContextPrompt({
              executionContext:
                automationTurn.executionContext ?? { hosted: null },
              prompt: buildAssistantLinqDeliveryPosturePrompt(
                authorizedDelivery.deliveryPosture,
              ),
            })
          const notificationExecutionContext =
            scopeAssistantCronScheduledGroupTools({
              channel: claimedJob.target.channel,
              executionContext: postureExecutionContext,
              route: deliveryRoute,
              routeAuthorityVerified: !maintenanceJob,
              scheduledInvocationAuthority,
            })
          const assertNotificationStillAuthorized = async (
            authorityGate: AssistantCronOnboardingFollowupDiagnostic['authorityGate'],
          ): Promise<void> => {
            const authority = await resolveAssistantCronCanonicalSourceAuthority({
              job: input.job,
              now: new Date(),
              trigger: input.trigger,
              vault: input.vault,
            })
            if (authority.kind !== 'current') {
              canonicalSourceDisposition = authority.kind
              throw new AssistantCronCanonicalSourceInvalidatedError(authority)
            }
            await assertAssistantCronLifecycleNotificationStillAuthorized({
              authorityGate,
              job: input.job,
              onOnboardingFollowupDiagnostic(diagnostic) {
                onboardingFollowupDiagnostic = diagnostic
              },
              occurrenceAt,
              vault: input.vault,
            })
            await assertAssistantCronManagedOwnerStillAuthorized({
              expected: managedOwnerAuthorization,
              executionContext: input.executionContext ?? null,
              job: input.job,
              signal: yieldCancellation.signal,
              target: managedOwnerAuthorityTarget,
            })

            if (notificationExecutionContext?.hosted?.groupTool) {
              const currentAuthorizedDelivery =
                await resolveAssistantCronAuthorizedNotificationDeliveryRoute({
                  executionContext: input.executionContext ?? null,
                  signal: yieldCancellation.signal,
                  target: claimedJob.target,
                })
              const currentRoute = currentAuthorizedDelivery.route
              const expectedTarget = normalizeNullableString(
                deliveryRoute.bindingDelivery?.target
                  ?? deliveryRoute.deliveryTarget,
              )
              const currentTarget = normalizeNullableString(
                currentRoute.bindingDelivery?.target
                  ?? currentRoute.deliveryTarget,
              )
              if (
                currentRoute.threadIsDirect !== false
                || !expectedTarget
                || currentTarget !== expectedTarget
              ) {
                throw new VaultCliError(
                  'ASSISTANT_CRON_GROUP_ROUTE_STALE',
                  'Scheduled group route changed before the next tool or delivery.',
                  { retryable: true },
                )
              }
            }
          }
          const recordNotificationDecision = (
            decision: AssistantNotificationResult['decision'] | null | undefined,
          ): void => {
            if (!decision || !notificationProviderStarted) {
              return
            }
            notificationDecision = decision.kind === 'skip'
              ? { kind: 'skip', reasonCode: 'provider_skip' }
              : { kind: 'send_message', reasonCode: 'provider_send_message' }
          }
          const notificationInput: Parameters<
            typeof sendAssistantNotificationLocal
          >[0] = {
            vault: input.vault,
            ...automationTurn,
            executionContext: notificationExecutionContext,
            // Provider admission distinguishes provider decisions from host
            // gates. For maintenance it is also the replay barrier: admitted
            // work may have committed writes before a terminal interruption.
            onProviderRequestStarted: () => {
              notificationProviderStarted = true
              if (maintenanceJob) {
                maintenanceProviderStarted = true
              }
            },
            beforeProviderAcceptedInputs: () =>
              assertNotificationStillAuthorized('pre_provider'),
            beforeDelivery: async (context) => {
              recordNotificationDecision(context?.decision)
              await assertNotificationStillAuthorized('pre_delivery')
            },
            beforeToolExecution: () =>
              assertNotificationStillAuthorized('pre_tool'),
            beforeCommit: async (context) => {
              recordNotificationDecision(context.decision)
              await assertNotificationStillAuthorized('pre_commit')
              await preemptAssistantCronNotificationCommitForForeground({
                allowTerminalNoDelivery:
                  assistantCronDeviceActivitySkipConsumesOccurrence({
                    decision: context.decision,
                    deliveryOutcome: context.deliveryOutcome ?? null,
                    job: input.job,
                  }),
                deliveryOutcome: context.deliveryOutcome ?? null,
                foregroundPreemption,
                jobName: claimedJob.name,
                shouldYield: input.shouldYield ?? null,
                vault: input.vault,
              })
            },
            instructions: buildAssistantCronExecutionInstructions(input.job),
            scheduledAutomationScheduleKind:
              input.job.kind === 'canonical'
                && input.job.source.kind === 'automation'
                ? input.job.source.schedule.kind
                : null,
            deliveryDedupeToken: buildAssistantCronNotificationDedupeToken({
              job: claimedJob,
              trigger: input.trigger,
            }),
            deliveryIdempotencyKey: buildAssistantCronDeviceActivityDeliveryIdempotencyKey({
              job: claimedJob,
              trigger: input.trigger,
            }),
            hostedDeliveryIdempotency: buildAssistantCronHostedDeliveryIdempotency({
              job: claimedJob,
              trigger: input.trigger,
            }),
            sessionId: claimedJob.target.sessionId,
            alias: claimedJob.target.alias,
            allowBindingRebind: claimedJob.target.sessionId !== null,
            channel: claimedJob.target.channel,
            identityId: claimedJob.target.identityId,
            onTraceEvent: input.onTraceEvent,
            onGroupEmailPendingDeliveryIntentId: (intentId) => {
              pendingDeliveryIntentId = intentId
            },
            outboxAutomationAuthority:
              resolveAssistantCronOutboxAutomationAuthority({
                job: input.job,
                occurrenceAt,
                trigger: input.trigger,
              }),
            outboxPlannedOccurrenceAt:
              resolveAssistantCronOutboxPlannedOccurrenceAt({
                job: input.job,
                occurrenceAt,
              }),
            outboxExternalThreadRouteAuthority:
              authorizedDelivery.externalThreadRouteAuthority,
            participantId: claimedJob.target.participantId,
            turnPolicy: resolveAssistantCronNotificationTurnPolicy(input.job),
            responsePolicy: resolveAssistantCronNotificationResponsePolicy(input.job),
            threadId:
              authorizedDelivery.conversationThreadId ??
              claimedJob.target.threadId,
            bindingDeliveryTarget:
              deliveryRoute.bindingDelivery?.target ??
              deliveryRoute.deliveryTarget ??
              undefined,
            deferCommitUntilDeliveryAccepted:
              input.deliveryDispatchMode === 'queue-only',
            deliveryKind: deliveryRoute.bindingDelivery?.kind ?? undefined,
            deliverySource: claimedJob.target.deliverySource,
            deliveryTarget: deliveryRoute.deliveryTarget,
            threadIsDirect: deliveryRoute.threadIsDirect,
            operatorAuthority: 'direct-operator',
            workingDirectory: input.vault,
          }
          const result = await sendAssistantNotificationLocal(notificationInput)

          recordNotificationDecision(result.decision)
          sessionId = result.session.sessionId
          response = result.response ?? result.decision.privateSummary
          notificationDecisionKind = result.decision?.kind ?? null
          notificationDeliveryOutcomeKind =
            result.deliveryOutcome?.kind ?? 'none'
          const foregroundYieldedAfterNotification =
            !maintenanceJob &&
            (foregroundPreemption.wasForegroundYielded() ||
              input.shouldYield?.() === true)
          const deviceActivitySkipConsumedOccurrence =
            assistantCronDeviceActivitySkipConsumesOccurrence({
              decision: result.decision,
              deliveryOutcome: result.deliveryOutcome ?? null,
              job: input.job,
            })
          const groupEmailPendingDeliveryIntentId =
            resolveAssistantCronGroupEmailPendingDeliveryIntentId(result)
          if (assistantCronGroupEmailAttemptFailed(result)) {
            throw new VaultCliError(
              'ASSISTANT_GROUP_EMAIL_DELIVERY_FAILED',
              'Group email delivery did not complete.',
            )
          }
          if (groupEmailPendingDeliveryIntentId) {
            pendingDeliveryIntentId = groupEmailPendingDeliveryIntentId
            outcome = 'delivery_pending'
            reason = 'delivery_pending'
          } else if (result.deliveryOutcome?.kind === 'queued') {
            pendingDeliveryIntentId = result.deliveryOutcome.intentId
            outcome = 'delivery_pending'
            reason = 'delivery_pending'
          } else {
            outcome = result.deliveryOutcome?.kind === 'sent'
              ? 'delivered'
              : 'no_op'
            reason = result.deliveryOutcome?.kind === 'sent'
              ? 'sent'
              : 'no_delivery'
            // Background maintenance success is terminal even when foreground
            // input arrived during the turn: the provider work (including any
            // memory writes) already happened, so treating it as yielded would
            // replay a completed occurrence. Preemption for maintenance only
            // applies before or during provider work.
            if (
              foregroundYieldedAfterNotification &&
              result.deliveryOutcome?.kind !== 'sent' &&
              !deviceActivitySkipConsumedOccurrence
            ) {
              throw buildAssistantCronForegroundYieldedError(claimedJob.name)
            }
          }
        }
      }
    }
  } catch (error) {
    if (
      pendingDeliveryIntentId === null
      && groupEmailRecoveryAuthorized
      && scheduledGroupEmailAuthority
    ) {
      try {
        pendingDeliveryIntentId = (
          await findAssistantGroupEmailParentIntent({
            authority: scheduledGroupEmailAuthority,
            vault: input.vault,
          })
        )?.intentId ?? null
      } catch {
        // Preserve the original failure. A failed recovery read leaves the
        // occurrence retryable, and the next run checks durable outbox state
        // before admitting the provider.
      }
    }
    const backgroundMaintenanceYielded =
      isAssistantCronBackgroundMaintenanceYieldError(error) ||
      yieldCancellation.yieldRequested()
    // Provider admission is the single replay barrier for maintenance: any
    // terminal failure after admission may have committed memory writes even
    // when the completed-command event was lost, so the occurrence is
    // consumed. The overlapping evidence window makes a skipped night safe;
    // a replay after a committed write is not. The raw-event detector stays
    // only as a defensive signal for pre-admission edge cases.
    const nonReplayableBackgroundMaintenanceWork =
      maintenanceJob &&
      (maintenanceProviderStarted ||
        assistantNotificationErrorHasNonReplayableProviderWork(error))
    if (nonReplayableBackgroundMaintenanceWork) {
      errorText = ASSISTANT_CRON_BACKGROUND_MAINTENANCE_NON_REPLAYABLE_WORK_ERROR
      errorCode = backgroundMaintenanceYielded
        ? ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELDED_CODE
        : error instanceof VaultCliError ? error.code : null
      outcome = 'no_op'
      reason = 'background_maintenance_non_replayable_work'
    } else if (backgroundMaintenanceYielded) {
      if (yieldCancellation.yieldRequested()) {
        await releaseClaimedAssistantCronJobAfterBackgroundMaintenanceYield({
          job: input.job,
          paths: input.paths,
        })
        throw createAssistantCronBackgroundMaintenanceYieldError()
      } else {
        errorText = errorMessage(error)
        errorCode = error instanceof VaultCliError ? error.code : null
        outcome = 'failed'
        reason = errorCode ?? 'background_maintenance_yield_failed'
      }
    } else if (error instanceof AssistantCronCanonicalSourceInvalidatedError) {
      canonicalSourceDisposition = error.disposition
      errorText = error.message
      errorCode = error.code
      outcome = 'skipped_gate'
      reason = `canonical_source_${error.disposition}`
    } else if (error instanceof AssistantCronLifecycleNotificationInvalidatedError) {
      errorText = error.message
      errorCode = error.code
      outcome = 'skipped_gate'
      reason = 'lifecycle_precondition'
    } else if (error instanceof AssistantCronManagedOwnerInvalidatedError) {
      errorText = error.message
      errorCode = error.code
      outcome = 'skipped_gate'
      reason = 'managed_owner_scope_mismatch'
    } else if (error instanceof AssistantCronLinqHealthPreflightBlockedError) {
      errorText = error.message
      errorCode = error.code
      outcome = 'skipped_gate'
      reason = 'linq_health_preflight'
    } else {
      const yieldedError =
        error instanceof AssistantCronForegroundYieldedError ||
        (
          foregroundPreemption.wasForegroundYielded() &&
          !input.signal?.aborted
        )
      if (yieldedError) {
        foregroundYielded = true
        errorText = ASSISTANT_CRON_FOREGROUND_YIELDED_ERROR
        errorCode = 'ASSISTANT_CRON_FOREGROUND_YIELDED'
        reason = 'foreground_yielded'
      } else {
        errorText = errorMessage(error)
        errorCode = readAssistantCronErrorCode(error)
        failureConsumesOccurrence = assistantCronDeliveryFailureConsumesOccurrence(
          error,
          input.job,
        )
        reason = errorCode ?? 'error'
      }
      outcome = 'failed'
    }
  } finally {
    foregroundPreemption.dispose()
    finishedAt = new Date().toISOString()
    yieldCancellation.dispose()
  }

  if (pendingDeliveryIntentId) {
    foregroundYielded = false
    outcome = 'delivery_pending'
    reason = errorCode
      ? `delivery_pending_after_${errorCode}`
      : errorText
        ? 'delivery_pending_after_error'
        : 'delivery_pending'
  }

  const run = assistantCronRunRecordSchema.parse({
    schema: ASSISTANT_CRON_RUN_SCHEMA,
    runId: cryptoRandomRunId(),
    jobId: claimedJob.jobId,
    trigger: input.trigger,
    outcome,
    reason: normalizeAssistantCronRunReason(reason),
    status: legacyAssistantCronRunStatusForOutcome({
      outcome,
      reason: normalizeAssistantCronRunReason(reason),
    }),
    startedAt,
    finishedAt,
    sessionId,
    response: truncateAssistantCronResponse(response),
    responseLength: response?.length ?? 0,
    error: errorText,
    notificationDecision,
    scheduledOccurrenceAt: occurrenceAt,
  })

  const finalized = await withAssistantCronWriteLock(input.paths, async () => {
    if (input.job.kind === 'local') {
      await appendAssistantCronRun(input.paths, run)

      const store = await readAssistantCronStore(input.paths)
      const index = store.jobs.findIndex((job) => job.jobId === claimedJob.jobId)

      if (index === -1) {
        return {
          job: claimedJob,
          removedAfterRun: true,
        }
      }

      const current = store.jobs[index] as AssistantCronJob
      const finalizedJob = finalizeAssistantCronJobAfterRun({
        job: current,
        finishedAt,
        foregroundYielded,
        failureConsumesOccurrence,
        responseSessionId: sessionId,
        pendingDeliveryIntentId,
        run,
      })
      let removedAfterRun = false

      if (
        shouldRemoveAssistantCronJobAfterRun(
          current,
          run,
          pendingDeliveryIntentId,
          failureConsumesOccurrence,
        )
      ) {
        store.jobs.splice(index, 1)
        removedAfterRun = true
      } else {
        store.jobs[index] = finalizedJob
      }

      await writeAssistantCronStore(input.paths, store)
      return {
        job: finalizedJob,
        removedAfterRun,
      }
    }

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths, {
      reclaimStaleRunningClaims: false,
    })
    const currentRuntimeState =
      findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      ) ?? input.job.runtimeState
    if (!canonicalRuntimeClaimMatches(input.job.runtimeState, currentRuntimeState)) {
      return {
        job: projectCanonicalAssistantCronJob({
          source: input.job.source,
          runtimeState: currentRuntimeState,
        }),
        removedAfterRun: false,
      }
    }
    await appendAssistantCronRun(input.paths, run)

    const usesSessionPin = automationContinuityUsesSessionPin(input.job.source)
    const updatedRuntimeState = finalizeCanonicalAssistantCronRuntimeAfterRun({
      finishedAt,
      foregroundYielded,
      failureConsumesOccurrence,
      run,
      runtimeState: currentRuntimeState,
      responseSessionId: usesSessionPin ? sessionId : null,
      pendingDeliveryIntentId,
      source: input.job.source,
    })
    const persistedRuntimeState: AssistantCronCanonicalRuntimeRecord = {
      ...currentRuntimeState,
      // Aliases are explicit creation-time bindings and survive preserve runs;
      // only the automatic session pin is gated by the conversation key.
      alias:
        input.job.source.kind === 'automation' &&
        input.job.source.continuityPolicy === 'preserve'
          ? updatedRuntimeState.alias
          : null,
      sessionId: usesSessionPin ? updatedRuntimeState.sessionId : null,
      updatedAt: finishedAt,
      state: updatedRuntimeState.state,
    }
    const finalizedJob = projectCanonicalAssistantCronJob({
      source: input.job.source,
      runtimeState: persistedRuntimeState,
    })
    let removedAfterRun = false

    if (canonicalSourceDisposition === 'inactive') {
      removeAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      )
      removedAfterRun = true
    } else if (canonicalSourceDisposition === 'changed') {
      upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, persistedRuntimeState)
    } else if (
      shouldRemoveAssistantCronJobAfterRun(
        finalizedJob,
        run,
        pendingDeliveryIntentId,
        failureConsumesOccurrence,
      )
    ) {
      if (input.job.source.kind === 'automation') {
        await upsertAutomation(
          buildCanonicalAutomationUpsertInput({
            vault: input.vault,
            automationId: input.job.source.automationId,
            automation: input.job.source,
            title: input.job.source.title,
            status: 'archived',
            schedule: input.job.source.schedule,
            route: input.job.source.route,
            instructions: input.job.source.instructions,
          }),
        )
      } else if (input.job.source.kind === 'scheduledLog') {
        await setScheduledLogStatus({
          vaultRoot: input.vault,
          scheduledLogId: input.job.source.scheduledLogId,
          status: 'archived',
        })
      }
      removeAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(input.job.source),
      )
      removedAfterRun = true
    } else {
      upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, persistedRuntimeState)
    }

    await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)

    return {
      job:
        removedAfterRun
          ? finalizedJob
          : projectCanonicalAssistantCronJob({
              source: input.job.source,
              runtimeState: persistedRuntimeState,
            }),
      removedAfterRun,
    }
  })

  emitAssistantCronOnboardingFollowupCompletedEvent({
    diagnostic: onboardingFollowupDiagnostic,
    notificationDecisionKind,
    notificationDeliveryOutcomeKind,
    onEvent: input.onEvent,
    run,
  })

  return {
    job: finalized.job,
    removedAfterRun: finalized.removedAfterRun,
    run,
    // Typed failure class (e.g. ASSISTANT_CODEX_USAGE_LIMIT) for runtime-log
    // observability; the persisted run record keeps only the error text.
    runErrorCode: errorCode,
  }
}

async function resolveResearchOrientedManagedAutomationOnboardingSkipError(input: {
  job: ResolvedAssistantCronJob
  vault: string
}): Promise<string | null> {
  if (!isResearchOrientedManagedAutomationCronJob(input.job)) {
    return null
  }

  try {
    const onboardingState = await readAssistantOnboardingState(input.vault)
    return onboardingState.status === 'open'
      ? ASSISTANT_CRON_ONBOARDING_OPEN_RESEARCH_SKIP_ERROR
      : null
  } catch {
    return ASSISTANT_CRON_ONBOARDING_UNREADABLE_RESEARCH_SKIP_ERROR
  }
}

async function readAssistantCronOnboardingFollowupDiagnostic(input: {
  authorityGate: AssistantCronOnboardingFollowupDiagnostic['authorityGate']
  job: ResolvedAssistantCronJob
  occurrenceAt: string
  vault: string
}): Promise<{
  diagnostic: AssistantCronOnboardingFollowupDiagnostic
  error: unknown | null
} | null> {
  if (!isAssistantCronOnboardingFollowupJob(input.job)) {
    return null
  }
  if (input.job.source.kind !== 'automation') {
    return null
  }

  const base = {
    activeUntil: input.job.source.activeUntil,
    authorityGate: input.authorityGate,
    occurrenceAt: input.occurrenceAt,
    scheduleKind: input.job.source.schedule.kind,
  }
  try {
    const state = await readAssistantOnboardingState(input.vault)
    return {
      diagnostic: {
        ...base,
        onboardingStateCreatedAt: state.createdAt,
        onboardingStateReadError: null,
        onboardingStateSource:
          state.createdAt === null ? 'default_missing' : 'persisted',
        onboardingStateStatus: state.status,
        onboardingStateUpdatedAt: state.updatedAt,
      },
      error: null,
    }
  } catch (error) {
    const onboardingStateReadError = isAssistantOnboardingStateReadError(error)
    const authorityError = onboardingStateReadError
      ? new VaultCliError(
          'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
          'Onboarding follow-up authority could not be revalidated.',
          {
            reason: error.reason,
            retryable: true,
          },
        )
      : error
    return {
      diagnostic: {
        ...base,
        onboardingStateCreatedAt: null,
        onboardingStateReadError: onboardingStateReadError
          ? error.reason
          : 'unknown',
        onboardingStateSource: 'read_error',
        onboardingStateStatus: 'unreadable',
        onboardingStateUpdatedAt: null,
      },
      error: authorityError,
    }
  }
}

function isAssistantCronOnboardingFollowupJob(
  job: ResolvedAssistantCronJob,
): job is Extract<ResolvedAssistantCronJob, { kind: 'canonical' }> & {
  source: CanonicalAutomationAssistantCronJobRecord
} {
  if (job.kind !== 'canonical' || job.source.kind !== 'automation') {
    return false
  }
  return isRecognizedMurphOnboardingFollowupAutomation(job.source)
}

function isAssistantCronOnboardingFollowupPredecessorJob(
  job: ResolvedAssistantCronJob,
): job is Extract<ResolvedAssistantCronJob, { kind: 'canonical' }> & {
  source: CanonicalAutomationAssistantCronJobRecord
} {
  return isAssistantCronOnboardingFollowupJob(job) &&
    !isCurrentMurphOnboardingFollowupAutomation(job.source)
}

function emitAssistantCronOnboardingFollowupCompletedEvent(input: {
  diagnostic: AssistantCronOnboardingFollowupDiagnostic | null
  notificationDecisionKind: string | null
  notificationDeliveryOutcomeKind: string | null
  onEvent?: (event: AssistantRunEvent) => void
  run: AssistantCronRunRecord
}): void {
  if (!input.diagnostic) {
    return
  }

  input.onEvent?.({
    type: 'onboarding.followup.completed',
    details: 'onboarding follow-up occurrence completed',
    safeDetails: 'onboarding_followup_completed',
    failureContext: {
      activeUntil: input.diagnostic.activeUntil,
      authorityGate: input.diagnostic.authorityGate,
      occurrenceAt: input.diagnostic.occurrenceAt,
      notificationDecisionKind: input.notificationDecisionKind,
      notificationDeliveryOutcomeKind:
        input.notificationDeliveryOutcomeKind,
      onboardingStateCreatedAt:
        input.diagnostic.onboardingStateCreatedAt,
      onboardingStateReadError:
        input.diagnostic.onboardingStateReadError,
      onboardingStateSource: input.diagnostic.onboardingStateSource,
      onboardingStateStatus: input.diagnostic.onboardingStateStatus,
      onboardingStateUpdatedAt:
        input.diagnostic.onboardingStateUpdatedAt,
      runOutcome: input.run.outcome,
      runReason: input.run.reason,
      scheduleKind: input.diagnostic.scheduleKind,
    },
    providerKind: 'status',
    providerState: 'completed',
  })
}

function isResearchOrientedManagedAutomationCronJob(
  job: ResolvedAssistantCronJob,
): boolean {
  return (
    job.kind === 'canonical' &&
    job.source.kind === 'automation' &&
    MURPH_RESEARCH_ORIENTED_MANAGED_AUTOMATION_IDS.has(
      job.source.automationId,
    )
  )
}

type AssistantCronCanonicalSourceDisposition =
  | 'changed'
  | 'current'
  | 'inactive'

type AssistantCronCanonicalSourceAuthority =
  | { kind: 'current' }
  | {
      kind: Exclude<AssistantCronCanonicalSourceDisposition, 'current'>
      reason: string
    }

async function resolveAssistantCronCanonicalSourceAuthority(input: {
  job: ResolvedAssistantCronJob
  now: Date
  trigger: AssistantCronTrigger
  vault: string
}): Promise<AssistantCronCanonicalSourceAuthority> {
  if (
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation'
  ) {
    return { kind: 'current' }
  }

  try {
    const result = await archiveAutomationIfActiveUntilElapsed({
      expectedUpdatedAt: input.job.source.updatedAt,
      lookup: input.job.source.automationId,
      now: input.now,
      vaultRoot: input.vault,
    })
    if (result.archived) {
      return {
        kind: 'inactive',
        reason: 'automation reached its activeUntil boundary',
      }
    }
    const manualRunOfPausedSource =
      input.trigger === 'manual' && input.job.source.status === 'paused'
    if (
      result.record.status !== 'active' &&
      !(manualRunOfPausedSource && result.record.status === 'paused')
    ) {
      return {
        kind: 'inactive',
        reason: `automation status changed to ${result.record.status}`,
      }
    }
    if (result.record.updatedAt !== input.job.source.updatedAt) {
      return {
        kind: 'changed',
        reason: 'automation changed after this occurrence was claimed',
      }
    }
    return { kind: 'current' }
  } catch (error) {
    if (isVaultError(error) && error.code === 'VAULT_AUTOMATION_MISSING') {
      return {
        kind: 'inactive',
        reason: 'automation was removed after this occurrence was claimed',
      }
    }
    throw error
  }
}

async function assertAssistantCronLifecycleNotificationStillAuthorized(input: {
  authorityGate: AssistantCronOnboardingFollowupDiagnostic['authorityGate']
  job: ResolvedAssistantCronJob
  onOnboardingFollowupDiagnostic?: (
    diagnostic: AssistantCronOnboardingFollowupDiagnostic
  ) => void
  occurrenceAt: string
  vault: string
}): Promise<void> {
  if (
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation'
  ) {
    return
  }

  if (isAssistantCronOnboardingFollowupPredecessorJob(input.job)) {
    throw buildAssistantCronOnboardingFollowupReconciliationRequiredError()
  }

  const onboardingFollowup =
    await readAssistantCronOnboardingFollowupDiagnostic({
      authorityGate: input.authorityGate,
      job: input.job,
      occurrenceAt: input.occurrenceAt,
      vault: input.vault,
    })
  if (onboardingFollowup) {
    input.onOnboardingFollowupDiagnostic?.(onboardingFollowup.diagnostic)
  }
  if (onboardingFollowup?.error) {
    throw onboardingFollowup.error
  }
  if (
    onboardingFollowup?.diagnostic.onboardingStateStatus === 'completed'
  ) {
    throw new AssistantCronLifecycleNotificationInvalidatedError(
      ASSISTANT_CRON_ONBOARDING_FOLLOWUP_COMPLETED_ERROR,
    )
  }

  const onboardingAuthority =
    await runOnboardingGoalCheckinAuthorityPrecondition({
      automationId: input.job.source.automationId,
      occurrenceAt: input.occurrenceAt,
      vault: input.vault,
    })
  if (onboardingAuthority.kind === 'skip') {
    throw new AssistantCronLifecycleNotificationInvalidatedError(
      onboardingAuthority.reason,
    )
  }

  const result = await runExperimentLifecycleDeliveryAuthorityPrecondition({
    automationId: input.job.source.automationId,
    tags: input.job.source.tags,
    vault: input.vault,
  })
  if (result.kind === 'skip') {
    throw new AssistantCronLifecycleNotificationInvalidatedError(result.reason)
  }
}

function resolveAssistantCronOutboxAutomationAuthority(input: {
  job: ResolvedAssistantCronJob
  occurrenceAt: string
  trigger: AssistantCronTrigger
}): AssistantOutboxIntent['automationAuthority'] {
  if (
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation'
  ) {
    return null
  }

  // A manual run is a distinct, current user authorization for a paused job.
  // It intentionally does not inherit active automation lifecycle authority;
  // active jobs always carry their exact revision even when the first provider
  // attempt is immediate, because a transient failure can still enter outbox.
  if (input.job.source.status !== 'active') {
    return null
  }

  const supportSeriesId = resolveAssistantCronOutboxSupportSeriesId(
    input.job.source.tags,
  )

  return {
    automationId: input.job.source.automationId,
    expectedUpdatedAt: input.job.source.updatedAt,
    ...(supportSeriesId === null ? {} : { supportSeriesId }),
    ...(input.trigger === 'scheduled'
      ? {
          ...(input.job.source.scheduledReply == null
            ? {}
            : { scheduledReply: input.job.source.scheduledReply }),
          scheduledOccurrenceAt: input.occurrenceAt,
        }
      : {}),
  }
}

function resolveAssistantCronOutboxPlannedOccurrenceAt(input: {
  job: ResolvedAssistantCronJob
  occurrenceAt: string
}): string | null {
  if (
    input.job.kind !== 'canonical'
    || input.job.source.kind !== 'automation'
    || input.job.source.plannedOccurrenceOffsetMs === null
  ) {
    return null
  }

  const plannedOccurrenceAt = new Date(
    Date.parse(input.occurrenceAt) + input.job.source.plannedOccurrenceOffsetMs,
  )
  if (Number.isNaN(plannedOccurrenceAt.getTime())) {
    throw new TypeError('Automation planned occurrence is outside the supported date range.')
  }
  return plannedOccurrenceAt.toISOString()
}

function resolveAssistantCronOutboxSupportSeriesId(
  tags: readonly string[],
): string | null {
  const supportSeriesIds = [...new Set(
    tags
      .map((tag) => parseAutomationSupportSeriesTag(tag)?.seriesId ?? null)
      .filter((seriesId): seriesId is string => seriesId !== null),
  )]
  return supportSeriesIds.length === 1 ? supportSeriesIds[0]! : null
}

function buildAssistantCronExecutionInstructions(
  job: ResolvedAssistantCronJob,
): string {
  const lastFailedAt = job.job.state.lastFailedAt
  const retryEvidence =
    !lastFailedAt ||
    !assistantCronTimestampIsLater(lastFailedAt, job.job.state.lastSucceededAt)
      ? null
      : [
          'Delivery integrity evidence (engine-supplied):',
          `- A previous attempt failed or ended without confirmed delivery at ${lastFailedAt}.`,
          '- Do not interpret the absence of a user reply to that attempt as silence, disengagement, or non-adherence.',
          '- Treat this run as the next valid delivery attempt or check-in; do not claim the prior message reached the user.',
        ].join('\n')
  const supportScope = buildAssistantCronSupportScopeInstructions(job)
  const independentAuthority =
    buildAssistantCronIndependentAutomationAuthorityInstructions(job)
  const recurringReminderConversation =
    buildAssistantCronRecurringReminderConversationInstructions(job)
  const overlays = [
    retryEvidence,
    independentAuthority,
    recurringReminderConversation,
    supportScope,
  ]
    .filter((section): section is string => section !== null)
  const providerSafeBase =
    stripAutomationAvailabilityConflictEvidenceForProvider(job.job.prompt)
  let availabilityBlock: string | null = null

  try {
    availabilityBlock = splitAutomationAvailabilityConflictBlock(
      job.job.prompt,
    ).block
  } catch {
    // Malformed evidence remains fail-open for delivery and provider-private.
    // Only a structurally valid block retains host skip authority below.
  }

  return [providerSafeBase, ...overlays, availabilityBlock]
    .filter((section): section is string => section !== null)
    .join('\n\n')
}

function buildAssistantCronIndependentAutomationAuthorityInstructions(
  job: ResolvedAssistantCronJob,
): string | null {
  if (
    job.kind !== 'canonical' ||
    job.source.kind !== 'automation' ||
    job.source.status !== 'active' ||
    job.source.supportKind !== null ||
    resolveMurphManagedAutomationOwnerScope(job.source.automationId) !== null ||
    job.source.tags.some((tag) => parseAutomationSupportSeriesTag(tag) !== null)
  ) {
    return null
  }

  return ASSISTANT_CRON_INDEPENDENT_AUTOMATION_AUTHORITY_INSTRUCTIONS
}

function buildAssistantCronSupportScopeInstructions(
  job: ResolvedAssistantCronJob,
): string | null {
  if (
    job.kind !== 'canonical' ||
    job.source.kind !== 'automation' ||
    job.source.supportKind === null
  ) {
    return null
  }

  const exactScope = job.source.supportKind === 'reminder'
    ? 'Deliver only the agreed reminder purpose, including a consented first-session walkthrough when the automation says so, plus any necessary skip or invalid-state note. For a recurring reminder, the engine-supplied cadence-administration question is the sole allowed exception to cue-only delivery. Do not ask whether the action was completed or add a proactive repair, accountability, or reflection question.'
    : job.source.supportKind === 'check_in'
      ? 'Ask at most one narrow check-in or repair question about the current plan. Do not expand into a review, digest, or new coaching agenda.'
      : job.source.supportKind === 'review'
        ? "Conduct only the bounded review and ask at most one question requesting the user's continue, modify, pause, stop, or escalate decision. Do not record or apply that decision until the user replies in a later turn. Do not add a recurring accountability loop."
        : 'Provide only the agreed weekly summary shape from current evidence. Do not append a surprise accountability, repair, or coaching question.'

  return [
    'Accepted support scope (engine-supplied; this overrides any broader repair or follow-up option above):',
    `- Persisted support kind: ${job.source.supportKind}.`,
    `- ${exactScope}`,
  ].join('\n')
}

export const ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_INSTRUCTIONS = [
  'Recurring reminder conversation (engine-supplied; apply only when the saved request is an ordinary reminder):',
  '- This silence policy does not apply to medication, prescribed treatment, clinician-directed care, clinical monitoring, or safety-critical reminders. For those reminders, send the saved cue normally unless the member explicitly changes or pauses it or an existing authoritative owner supplies a valid skip condition.',
  '- Apply a silence-based cadence question or skip only when the immediately prior confirmed output appears in this request\'s engine-supplied automation-output history. If that output is unavailable under the existing evidence-retention horizon, send the current cue normally. Do not use an assistant transcript entry alone as proof of dispatch because transcript persistence precedes delivery.',
  '- Use recent conversation plus engine delivery evidence. A failed or unconfirmed immediately prior attempt does not count: send the current reminder normally instead of treating that attempt as unanswered.',
  '- Otherwise find the most recent output from this automation whose dispatch was confirmed by provider acceptance or runtime `sent` state.',
  '- If there is no such confirmed output for this revision, send the current reminder normally.',
  '- If a relevant human reply followed that output, use it when composing the current reminder.',
  `- When a history item with the exact text \`${ASSISTANT_BOUNDED_CONVERSATION_HISTORY_INCOMPLETE_TEXT}\` appears inside this provider request's engine-supplied recent-conversation-history section, the current cold reconstruction is incomplete because an existing retention, count, or byte bound omitted committed details. It is not a human reply and does not prove silence. For this occurrence, do not apply a silence-based cadence question or skip: continue the current cue unless retained conversation or another authoritative owner proves an explicit pause, change, or valid skip condition.`,
  '- That marker expires after the provider request that supplied it. If it is visible only in an earlier turn of a resumed provider thread, ignore it when deciding whether a later confirmed reminder received a relevant reply.',
  '- If no relevant human reply followed and that output already asked whether to keep, change, or pause these interruptions, return `skip`.',
  '- Otherwise send the current concise cue and ask one natural question about whether to keep, change, or pause these interruptions.',
  '- This question administers reminder cadence only. Do not ask whether the action was completed, infer failure or refusal from silence, increase frequency, or manufacture novelty when the same concise cue still fits.',
  '- In a group, address the room collectively. Never assign silence, non-completion, or failure to an individual participant.',
].join('\n')

function buildAssistantCronRecurringReminderConversationInstructions(
  job: ResolvedAssistantCronJob,
): string | null {
  if (
    job.kind !== 'canonical' ||
    job.source.kind !== 'automation' ||
    job.source.status !== 'active' ||
    (job.source.supportKind !== null && job.source.supportKind !== 'reminder') ||
    resolveMurphManagedAutomationOwnerScope(job.source.automationId) !== null ||
    job.source.schedule.kind === 'at'
  ) {
    return null
  }

  return ASSISTANT_CRON_RECURRING_REMINDER_CONVERSATION_INSTRUCTIONS
}

function assistantCronTimestampIsLater(
  candidate: string,
  reference: string | null | undefined,
): boolean {
  const candidateMs = Date.parse(candidate)
  const referenceMs = reference ? Date.parse(reference) : Number.NEGATIVE_INFINITY
  return Number.isFinite(candidateMs) && candidateMs > referenceMs
}

function resolveAssistantCronTurnServiceTier(input: {
  executionContext: AssistantExecutionContext | null
  job: AssistantCronJob
}): AssistantProviderServiceTier | null {
  // Hosted API-key turns only; dev/local Codex subscription auth has no tiers.
  if (!input.executionContext?.hosted) {
    return null
  }

  // Retries after a failed (or deadline-aborted) flex run use the standard
  // tier so the existing 30s failure backoff bounds reminder lateness.
  return input.job.state.consecutiveFailures === 0 ? 'flex' : null
}

function resolveAssistantCronAutomationTargetOverride(
  job: ResolvedAssistantCronJob,
): AutomationQueryRecord['assistantTargetOverride'] | null {
  return job.kind === 'canonical' && job.source.kind === 'automation'
    ? job.source.assistantTargetOverride
    : null
}

export function resolveAssistantCronScheduledInvocationAuthority(input: {
  job: ResolvedAssistantCronJob
  occurrenceAt: string
  trigger: AssistantCronTrigger
}): HostedRuntimeScheduledAutomationAuthority | null {
  if (
    input.trigger !== 'scheduled' ||
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation'
  ) {
    return null
  }
  return {
    automationId: input.job.source.automationId,
    occurrenceAt: input.occurrenceAt,
  }
}

function resolveAssistantCronScheduledGroupEmailAuthority(input: {
  job: ResolvedAssistantCronJob
  occurrenceAt: string
  trigger: AssistantCronTrigger
}): HostedRuntimeGroupEmailScheduledAuthority | null {
  if (
    input.trigger !== 'scheduled' ||
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation' ||
    input.job.source.schedule.kind !== 'cron' ||
    input.job.source.route.threadIsDirect !== false ||
    (
      input.job.source.route.channel !== 'linq' &&
      input.job.source.route.channel !== 'telegram'
    )
  ) {
    return null
  }

  return {
    automationId: input.job.source.automationId,
    occurrenceAt: input.occurrenceAt,
  }
}

function resolveAssistantCronGroupEmailPendingDeliveryIntentId(
  result: Awaited<ReturnType<typeof sendAssistantNotificationLocal>>,
): string | null {
  const expectations = result.postTurnDeliveryExpectations
  const intentId = expectations?.groupEmailPendingDeliveryIntentId ?? null
  return expectations?.groupEmailSendResult?.status === 'accepted'
    && intentId
    && intentId.trim().length > 0
    ? intentId
    : null
}

function assistantCronGroupEmailAttemptFailed(
  result: Awaited<ReturnType<typeof sendAssistantNotificationLocal>>,
): boolean {
  const sendResult = result.postTurnDeliveryExpectations?.groupEmailSendResult
  if (!sendResult) {
    return false
  }
  if (sendResult.status === 'unavailable') {
    return true
  }
  if (
    sendResult.status === 'partial_failure'
    && sendResult.sentRecipientCount === 0
  ) {
    return true
  }
  return sendResult.status === 'accepted'
    && resolveAssistantCronGroupEmailPendingDeliveryIntentId(result) === null
}

function resolveAssistantCronNotificationResponsePolicy(
  job: ResolvedAssistantCronJob,
): { kind: 'require_send' } | null {
  return listAssistantCronNotificationTags(job).includes(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    ? { kind: 'require_send' }
    : null
}

function resolveAssistantCronNotificationTurnPolicy(
  job: ResolvedAssistantCronJob,
): AssistantNotificationTurnPolicy | null {
  const policy = resolveAssistantCronBackgroundMaintenancePolicy(job)
  if (policy) {
    return {
      kind: 'maintenance-exact-skip',
      maintenanceProfile: policy.profile,
      privateSummary: policy.privateSummary,
    }
  }

  return null
}

function assistantCronDeviceActivitySkipConsumesOccurrence(input: {
  decision: AssistantNotificationResult['decision']
  deliveryOutcome: AssistantDeliveryOutcome | null
  job: ResolvedAssistantCronJob
}): boolean {
  return (
    input.decision?.kind === 'skip' &&
    input.deliveryOutcome === null &&
    readAssistantDeviceActivityCronJobMetadata(input.job.job.name) !== null
  )
}

function buildAssistantCronDeviceActivityDeliveryIdempotencyKey(input: {
  job: AssistantCronJob
  trigger: AssistantCronTrigger
}): string | null {
  const metadata = readAssistantDeviceActivityCronJobMetadata(input.job.name)
  const dueAt = normalizeNullableString(input.job.state.nextRunAt)
  if (!metadata || input.trigger !== 'scheduled' || !dueAt) {
    return null
  }

  return buildAssistantDeviceActivityDeliveryIdempotencyKey({
    discriminator: {
      operation: 'assistant-device-activity-notification',
    },
    metadata,
  })
}

function listAssistantCronNotificationTags(
  job: ResolvedAssistantCronJob,
): readonly string[] {
  if (job.kind === 'canonical' && job.source.kind === 'automation') {
    return job.source.tags
  }

  return []
}

function finalizeAssistantCronJobAfterRun(input: {
  failureConsumesOccurrence: boolean
  finishedAt: string
  foregroundYielded: boolean
  job: AssistantCronJob
  pendingDeliveryIntentId: string | null
  responseSessionId: string | null
  run: AssistantCronRunRecord
}): AssistantCronJob {
  const runningClearedState = {
    ...input.job.state,
    runningAt: null,
    runningPid: null,
    lastRunAt: input.finishedAt,
  }
  const shouldAutoBindSession =
    input.responseSessionId !== null && !assistantCronJobHasStableSessionLocator(input.job)

  if (input.foregroundYielded) {
    return assistantCronJobSchema.parse({
      ...input.job,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        nextRunAt: computeAssistantCronForegroundYieldRetryAt(input.finishedAt),
      },
    })
  }

  if (
    assistantCronRunConsumedOccurrence(
      input.run,
      input.pendingDeliveryIntentId,
      input.failureConsumesOccurrence,
    )
  ) {
    const nextRunAt = resolveAssistantCronNextRunAfterSuccess(
      input.job,
      new Date(input.finishedAt),
    )

    if (input.run.outcome === 'failed') {
      return assistantCronJobSchema.parse({
        ...input.job,
        enabled:
          input.job.schedule.kind === 'at' && input.job.keepAfterRun
            ? false
            : input.job.enabled,
        target: shouldAutoBindSession
          ? {
              ...input.job.target,
              sessionId: input.responseSessionId,
            }
          : input.job.target,
        updatedAt: input.finishedAt,
        state: {
          ...runningClearedState,
          nextRunAt,
          lastFailedAt: input.finishedAt,
          lastError: input.run.error,
          consecutiveFailures: 0,
        },
      })
    }

    return assistantCronJobSchema.parse({
      ...input.job,
      enabled:
        input.job.schedule.kind === 'at' && input.job.keepAfterRun
          ? false
          : input.job.enabled,
      target: shouldAutoBindSession
        ? {
            ...input.job.target,
            sessionId: input.responseSessionId,
          }
        : input.job.target,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        nextRunAt,
        lastSucceededAt: input.finishedAt,
        lastError: null,
        consecutiveFailures: 0,
      },
    })
  }

  if (input.run.outcome === 'delivery_pending' && input.pendingDeliveryIntentId !== null) {
    return assistantCronJobSchema.parse({
      ...input.job,
      target: shouldAutoBindSession
        ? {
            ...input.job.target,
            sessionId: input.responseSessionId,
          }
        : input.job.target,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        nextRunAt: null,
        lastError: null,
        pendingDeliveryIntentId: input.pendingDeliveryIntentId,
      },
    })
  }

  const failureCount = input.job.state.consecutiveFailures + 1
  const nextRunAt = input.job.enabled
    ? new Date(
        Date.parse(input.finishedAt) + resolveAssistantCronFailureBackoffMs(failureCount),
      ).toISOString()
    : input.job.state.nextRunAt

  return assistantCronJobSchema.parse({
    ...input.job,
    updatedAt: input.finishedAt,
    state: {
      ...runningClearedState,
      nextRunAt,
      lastFailedAt: input.finishedAt,
      lastError: input.run.error,
      consecutiveFailures: failureCount,
    },
  })
}

function shouldRemoveAssistantCronJobAfterRun(
  job: AssistantCronJob,
  run: AssistantCronRunRecord,
  pendingDeliveryIntentId: string | null,
  failureConsumesOccurrence = false,
): boolean {
  return (
    job.schedule.kind === 'at' &&
    !job.keepAfterRun &&
    assistantCronRunConsumedOccurrence(
      run,
      pendingDeliveryIntentId,
      failureConsumesOccurrence,
    )
  )
}

// A stale-skipped wake consumes its occurrence like a success so one-shots
// archive and recurring schedules advance; a delivery-queued skip keeps the
// occurrence pending until the outbound delivery confirms. Terminal delivery
// failures normally consume the occurrence while remaining failed for
// observability. Automations explicitly requiring delivery keep the occurrence
// retryable until their finite activeUntil boundary.
function assistantCronRunConsumedOccurrence(
  run: AssistantCronRunRecord,
  pendingDeliveryIntentId: string | null,
  failureConsumesOccurrence = false,
): boolean {
  return (
    run.outcome === 'delivered' ||
    run.outcome === 'no_op' ||
    run.outcome === 'expired' ||
    run.outcome === 'skipped_gate' ||
    (failureConsumesOccurrence && run.outcome === 'failed')
  )
}

function assistantCronDeliveryFailureConsumesOccurrence(
  error: unknown,
  job: ResolvedAssistantCronJob,
): boolean {
  if (!assistantCronErrorHasNotificationDeliveryStage(error)) {
    return false
  }
  if (assistantDeliveryErrorPreventsFreshIntentRetry(error)) {
    return true
  }
  return !isAssistantOutboxRetryableError(error) &&
    !assistantCronRequiredDeliveryCanRetry(job, new Date())
}

function assistantCronRequiredDeliveryCanRetry(
  job: ResolvedAssistantCronJob,
  now: Date,
): boolean {
  if (
    !listAssistantCronNotificationTags(job).includes(
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    )
  ) {
    return false
  }

  return (
    job.kind === 'canonical' &&
    job.source.kind === 'automation' &&
    job.source.activeUntil !== null &&
    Number.isFinite(Date.parse(job.source.activeUntil)) &&
    now.getTime() < Date.parse(job.source.activeUntil)
  )
}

function assistantCronErrorHasNotificationDeliveryStage(error: unknown): boolean {
  const details = readAssistantCronErrorRecord(readAssistantCronErrorRecord(error)?.details)
  return details?.assistantNotificationStage === 'delivery'
}

function readAssistantCronErrorCode(error: unknown): string | null {
  if (error instanceof VaultCliError) {
    return error.code
  }
  const code = readAssistantCronErrorRecord(error)?.code
  const normalized = typeof code === 'string' ? code.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function readAssistantCronErrorRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finalizeCanonicalAssistantCronRuntimeAfterRun(input: {
  failureConsumesOccurrence: boolean
  finishedAt: string
  foregroundYielded: boolean
  pendingDeliveryIntentId: string | null
  responseSessionId: string | null
  run: AssistantCronRunRecord
  runtimeState: AssistantCronCanonicalRuntimeRecord
  source: CanonicalAssistantCronJobRecord
}): AssistantCronCanonicalRuntimeRecord {
  const runningClearedState: AssistantCronCanonicalRuntimeState = {
    ...input.runtimeState.state,
    runningAt: null,
    runningClaimId: null,
    runningPid: null,
    lastRunAt: input.finishedAt,
  }

  if (input.foregroundYielded) {
    return {
      ...input.runtimeState,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        pendingOccurrenceAt:
          input.runtimeState.state.pendingOccurrenceAt ??
          resolveCanonicalAssistantCronOccurrenceAt(input.source, input.runtimeState),
        retryAfterAt: computeAssistantCronForegroundYieldRetryAt(input.finishedAt),
      },
    }
  }

  if (
    assistantCronRunConsumedOccurrence(
      input.run,
      input.pendingDeliveryIntentId,
      input.failureConsumesOccurrence,
    )
  ) {
    if (input.run.outcome === 'failed') {
      return {
        ...input.runtimeState,
        sessionId: input.responseSessionId ?? input.runtimeState.sessionId,
        updatedAt: input.finishedAt,
        state: {
          ...runningClearedState,
          pendingOccurrenceAt: null,
          retryAfterAt: null,
          lastFailedAt: input.finishedAt,
          lastError: input.run.error,
          consecutiveFailures: 0,
        },
      }
    }

    return {
      ...input.runtimeState,
      sessionId: input.responseSessionId ?? input.runtimeState.sessionId,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        lastSucceededAt: input.finishedAt,
        lastError: null,
        consecutiveFailures: 0,
      },
    }
  }

  if (input.run.outcome === 'delivery_pending' && input.pendingDeliveryIntentId !== null) {
    return {
      ...input.runtimeState,
      sessionId: input.responseSessionId ?? input.runtimeState.sessionId,
      updatedAt: input.finishedAt,
      state: {
        ...runningClearedState,
        retryAfterAt: null,
        lastError: null,
        pendingDeliveryIntentId: input.pendingDeliveryIntentId,
      },
    }
  }

  const failureCount = input.runtimeState.state.consecutiveFailures + 1
  const retryAfterAt = isCanonicalAssistantCronSourceEnabled(input.source)
    ? new Date(
        Date.parse(input.finishedAt) +
          resolveAssistantCronFailureBackoffMs(failureCount),
      ).toISOString()
    : null

  return {
    ...input.runtimeState,
    updatedAt: input.finishedAt,
    state: {
      ...runningClearedState,
      pendingOccurrenceAt:
        input.runtimeState.state.pendingOccurrenceAt ??
        resolveCanonicalAssistantCronOccurrenceAt(input.source, input.runtimeState),
      retryAfterAt,
      lastFailedAt: input.finishedAt,
      lastError: input.run.error,
      consecutiveFailures: failureCount,
    },
  }
}

function assistantCronJobHasStableSessionLocator(job: AssistantCronJob): boolean {
  return Boolean(
    job.target.sessionId ||
      job.target.alias ||
      (job.target.channel &&
        (job.target.participantId || job.target.threadId)),
  )
}

async function resolveDeviceActivityParentAuthority(input: {
  job: ResolvedAssistantCronJob
  vault: string
}): Promise<{
  assistantTargetOverride: AutomationQueryRecord['assistantTargetOverride'] | null
  error: string | null
  route: AutomationQueryRecord['route'] | null
}> {
  if (input.job.kind !== 'local') {
    return {
      assistantTargetOverride: null,
      error: null,
      route: null,
    }
  }

  const metadata = readAssistantDeviceActivityCronJobMetadata(input.job.job.name)
  if (!metadata) {
    return {
      assistantTargetOverride: null,
      error: null,
      route: null,
    }
  }

  let parentAutomation = await readAssistantDeviceActivityParentAutomation({
    metadata,
    vault: input.vault,
  })
  if (
    parentAutomation?.activeUntil &&
    Date.now() >= Date.parse(parentAutomation.activeUntil)
  ) {
    const expiry = await archiveAutomationIfActiveUntilElapsed({
      expectedUpdatedAt: parentAutomation.updatedAt,
      lookup: parentAutomation.automationId,
      now: new Date(),
      vaultRoot: input.vault,
    })
    parentAutomation = expiry.record
  }
  if (!parentAutomation || parentAutomation.status !== 'active') {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
      route: null,
    }
  }
  if (parentAutomation.schedule.kind !== 'deviceActivity') {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
      route: null,
    }
  }
  const authorityMatches = assistantDeviceActivityAuthorityKeyMatches({
    authorityKey: metadata.authorityKey,
    automation: {
      ...parentAutomation,
      schedule: {
        activityKind: parentAutomation.schedule.activityKind,
        source: parentAutomation.schedule.source,
      },
    },
  })
  if (
    !authorityMatches ||
    !assistantCronTargetMatchesAutomationRoute(input.job.job.target, parentAutomation.route)
  ) {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
      route: null,
    }
  }

  return {
    assistantTargetOverride: parentAutomation.assistantTargetOverride,
    error: null,
    route: parentAutomation.route,
  }
}

function assistantCronTargetMatchesAutomationRoute(
  target: AssistantCronJob['target'],
  route: AutomationQueryRecord['route'],
): boolean {
  return target.channel === route.channel &&
    JSON.stringify(target.deliverySource) === JSON.stringify(route.deliverySource) &&
    target.deliveryTarget === route.deliveryTarget &&
    target.identityId === route.identityId &&
    target.participantId === route.participantId &&
    target.threadId === route.threadId &&
    (
      (target.threadIsDirect ?? null) === (route.threadIsDirect ?? null) ||
      (
        !Object.hasOwn(target, 'threadIsDirect') &&
        typeof route.threadIsDirect === 'boolean'
      )
    )
}

function truncateAssistantCronResponse(response: string | null): string | null {
  if (response === null) {
    return null
  }

  return response.slice(0, ASSISTANT_CRON_MAX_RESPONSE_LENGTH)
}

function legacyAssistantCronRunStatusForOutcome(input: {
  outcome: AssistantCronRunOutcome
  reason: string
}): string {
  switch (input.outcome) {
    case 'delivered':
      return 'succeeded'
    case 'no_op':
      return input.reason === 'background_maintenance_non_replayable_work'
        ? 'skipped'
        : 'succeeded'
    case 'delivery_pending':
    case 'expired':
    case 'skipped_gate':
      return 'skipped'
    case 'failed':
      return 'failed'
  }
}

function normalizeAssistantCronRunReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/gu, '_').slice(0, 120)
  return normalized.length > 0 ? normalized : 'unknown'
}

function resolveStaleAssistantCronNotificationError(input: {
  job: ResolvedAssistantCronJob
  nowIso: string
  occurrenceAt: string
}): { latenessMinutes: number; message: string } | null {
  if (input.job.job.scheduledLog) {
    return null
  }

  const now = new Date(input.nowIso)
  const deliverable = input.job.kind === 'canonical'
    ? isCanonicalAssistantCronNotificationOccurrenceDeliverable({
        now,
        occurrenceAt: input.occurrenceAt,
        source: input.job.source,
      })
    : isAssistantCronNotificationOccurrenceFresh({
        now,
        occurrenceAt: input.occurrenceAt,
      })
  if (deliverable) {
    return null
  }

  const ageMs = now.getTime() - Date.parse(input.occurrenceAt)
  const lateMinutes = Math.floor(ageMs / 60_000)
  return {
    latenessMinutes: lateMinutes,
    message:
      `${ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR} Scheduled occurrence was ${lateMinutes} minute(s) late.`,
  }
}

function emitAssistantCronOccurrenceExpiredEvent(input: {
  job: ResolvedAssistantCronJob
  latenessMinutes: number
  onEvent?: (event: AssistantRunEvent) => void
}): void {
  const automationSlug = resolveAssistantCronAutomationSlug(input.job)
  if (!automationSlug) {
    return
  }

  input.onEvent?.({
    type: 'cron.occurrence.expired',
    details: 'scheduled occurrence expired before delivery',
    safeDetails: 'cron_occurrence_expired',
    failureContext: {
      automationSlug,
      latenessMinutes: input.latenessMinutes,
    },
    providerKind: 'status',
    providerState: 'completed',
  })
}

function resolveAssistantCronAutomationSlug(
  job: ResolvedAssistantCronJob,
): string | null {
  if (job.kind !== 'canonical' || job.source.kind !== 'automation') {
    return null
  }

  return normalizeAssistantCronAutomationSlug(job.source.slug) ??
    normalizeAssistantCronAutomationSlug(job.job.name)
}

function normalizeAssistantCronAutomationSlug(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized && normalized.length > 0 ? normalized : null
}

function assistantCronExecutionDeliveryTargetProfile(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
}): 'hosted' | 'local' {
  const isHostedExecution =
    normalizeNullableString(input.executionContext?.hosted?.memberId) !== null
  return isHostedExecution ? 'hosted' : 'local'
}

function scopeAssistantCronScheduledGroupTools(input: {
  channel: string | null
  executionContext: AssistantExecutionContext | null | undefined
  route: ReturnType<typeof resolveAssistantCronNotificationDeliveryRoute>
  routeAuthorityVerified: boolean
  scheduledInvocationAuthority: HostedRuntimeScheduledAutomationAuthority | null
}): AssistantExecutionContext | null | undefined {
  const hosted = input.executionContext?.hosted
  if (
    !hosted ||
    input.routeAuthorityVerified !== true ||
    (input.channel !== 'linq' && input.channel !== 'telegram') ||
    input.route.threadIsDirect !== false
  ) {
    return input.executionContext
  }

  const {
    createScheduledGroupTools,
    groupPermissionOfferTool: _unscopedGroupPermissionOfferTool,
    groupSharedReader: _unscopedGroupSharedReader,
    groupTool: _unscopedGroupTool,
    ...hostedWithoutScheduledGroupTools
  } = hosted
  void _unscopedGroupPermissionOfferTool
  void _unscopedGroupSharedReader
  void _unscopedGroupTool
  const unscopedExecutionContext: AssistantExecutionContext = {
    hosted: hostedWithoutScheduledGroupTools,
  }
  if (!input.scheduledInvocationAuthority) {
    return unscopedExecutionContext
  }
  const target = normalizeNullableString(
    input.route.bindingDelivery?.target ?? input.route.deliveryTarget,
  )
  if (!target || typeof createScheduledGroupTools !== 'function') {
    return unscopedExecutionContext
  }

  let scheduledGroupTools: ReturnType<typeof createScheduledGroupTools>
  try {
    scheduledGroupTools = createScheduledGroupTools({
      channel: input.channel,
      target,
      threadIsDirect: false,
    })
  } catch {
    return unscopedExecutionContext
  }
  if (!scheduledGroupTools) {
    return unscopedExecutionContext
  }
  return {
    hosted: {
      ...hostedWithoutScheduledGroupTools,
      ...scheduledGroupTools,
    },
  }
}

type AssistantCronAuthorizedNotificationDelivery = Awaited<
  ReturnType<typeof resolveAssistantCronAuthorizedNotificationDeliveryRoute>
>

type AssistantCronManagedOwnerAuthorization =
  | { kind: 'unmanaged' }
  | { kind: 'mismatch' }
  | { kind: 'retired' }
  | {
      authorizedDelivery: AssistantCronAuthorizedNotificationDelivery
      channel: string | null
      automationId: string
      kind: 'authorized'
      ownerScope: 'member' | 'authenticated-group'
      target: string | null
      threadIsDirect: boolean | null
    }

async function resolveAssistantCronManagedOwnerAuthorization(input: {
  executionContext: AssistantExecutionContext | null
  job: ResolvedAssistantCronJob
  signal: AbortSignal
  target: AssistantCronJob['target']
}): Promise<AssistantCronManagedOwnerAuthorization> {
  if (
    input.job.kind !== 'canonical' ||
    input.job.source.kind !== 'automation'
  ) {
    return { kind: 'unmanaged' }
  }
  if (isRetiredMurphManagedAutomationId(input.job.source.automationId)) {
    return { kind: 'retired' }
  }

  // Only immutable current built-in or explicitly registered dynamic identities
  // carry hidden owner policy. Other dynamic lifecycle seeds deliberately remain
  // on their existing path until their source can expose an exact identity
  // resolver; tags, slugs, and prompt text are never authority.
  const ownerScope = resolveMurphManagedAutomationOwnerScope(
    input.job.source.automationId,
  )
  if (!ownerScope) {
    return { kind: 'unmanaged' }
  }
  const declaredRoute = resolveAssistantCronNotificationDeliveryRoute(
    input.target,
  )
  if (
    ownerScope === 'authenticated-group' &&
    !assistantCronManagedRouteIsAuthenticatedGroup({
      channel: input.target.channel,
      threadIsDirect: declaredRoute.threadIsDirect,
    })
  ) {
    return { kind: 'mismatch' }
  }
  if (
    ownerScope === 'member' &&
    declaredRoute.threadIsDirect === false
  ) {
    return { kind: 'mismatch' }
  }

  let authorizedDelivery: Awaited<
    ReturnType<typeof resolveAssistantCronAuthorizedNotificationDeliveryRoute>
  >
  if (
    ownerScope === 'authenticated-group'
    || !assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)
  ) {
    try {
      authorizedDelivery =
        await resolveAssistantCronAuthorizedNotificationDeliveryRoute({
          executionContext: input.executionContext,
          signal: input.signal,
          target: input.target,
        })
    } catch (error) {
      if (
        ownerScope === 'member'
        && input.target.channel === 'linq'
        && readAssistantCronErrorCode(error)
          === HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH
      ) {
        return { kind: 'mismatch' }
      }
      throw error
    }
  } else {
    authorizedDelivery = {
      conversationThreadId: null,
      deliveryPosture: null,
      externalThreadRouteAuthority: null,
      route: declaredRoute,
    }
  }
  const route = authorizedDelivery.route
  const channel = normalizeNullableString(input.target.channel)?.toLowerCase() ?? null
  const target = normalizeNullableString(
    route.bindingDelivery?.target ?? route.deliveryTarget,
  )
  const ownerMatches = ownerScope === 'authenticated-group'
    ? assistantCronManagedRouteIsAuthenticatedGroup({
        channel,
        threadIsDirect: route.threadIsDirect,
      }) && target !== null
    : route.threadIsDirect !== false
  if (!ownerMatches) {
    return { kind: 'mismatch' }
  }

  return {
    authorizedDelivery,
    automationId: input.job.source.automationId,
    channel,
    kind: 'authorized',
    ownerScope,
    target,
    threadIsDirect: route.threadIsDirect,
  }
}

function assistantCronManagedRouteIsAuthenticatedGroup(input: {
  channel: string | null | undefined
  threadIsDirect: boolean | null | undefined
}): boolean {
  const channel = normalizeNullableString(input.channel)?.toLowerCase()
  return input.threadIsDirect === false &&
    (channel === 'linq' || channel === 'telegram')
}

async function assertAssistantCronManagedOwnerStillAuthorized(input: {
  expected: AssistantCronManagedOwnerAuthorization
  executionContext: AssistantExecutionContext | null
  job: ResolvedAssistantCronJob
  signal: AbortSignal
  target: AssistantCronJob['target']
}): Promise<void> {
  if (input.expected.kind === 'unmanaged') {
    return
  }
  const current = await resolveAssistantCronManagedOwnerAuthorization({
    executionContext: input.executionContext,
    job: input.job,
    signal: input.signal,
    target: input.target,
  })
  if (!assistantCronManagedOwnerAuthorizationMatches(input.expected, current)) {
    throw new AssistantCronManagedOwnerInvalidatedError()
  }
}

function assistantCronManagedOwnerAuthorizationMatches(
  expected: AssistantCronManagedOwnerAuthorization,
  current: AssistantCronManagedOwnerAuthorization,
): boolean {
  if (expected.kind !== 'authorized' || current.kind !== 'authorized') {
    return expected.kind === current.kind && expected.kind === 'unmanaged'
  }
  return expected.automationId === current.automationId &&
    expected.ownerScope === current.ownerScope &&
    expected.channel === current.channel &&
    expected.target === current.target &&
    expected.threadIsDirect === current.threadIsDirect &&
    expected.authorizedDelivery.conversationThreadId ===
      current.authorizedDelivery.conversationThreadId
}

async function resolveAssistantCronAuthorizedNotificationDeliveryRoute(input: {
  executionContext: AssistantExecutionContext | null
  signal: AbortSignal
  target: AssistantCronJob['target']
}): Promise<{
  conversationThreadId: string | null
  deliveryPosture: HostedRuntimeLinqDeliveryPosture | null
  externalThreadRouteAuthority:
    AssistantOutboxIntent['externalThreadRouteAuthority']
  route: ReturnType<typeof resolveAssistantCronNotificationDeliveryRoute>
}> {
  const route = resolveAssistantCronNotificationDeliveryRoute(input.target)
  if (assistantCronExecutionDeliveryTargetProfile(input) !== 'hosted') {
    return {
      conversationThreadId: null,
      deliveryPosture: null,
      externalThreadRouteAuthority: null,
      route,
    }
  }

  if (input.target.channel === 'telegram' && route.threadIsDirect === false) {
    const target = normalizeNullableString(
      route.deliveryTarget ?? route.bindingDelivery?.target,
    )
    if (!target) {
      throw new VaultCliError(
        'ASSISTANT_CRON_DELIVERY_REQUIRED',
        'Assistant cron jobs must bind one concrete Telegram destination.',
      )
    }
    const resolveScheduledExternalThreadRoute =
      input.executionContext?.hosted?.resolveScheduledExternalThreadRoute
    if (!resolveScheduledExternalThreadRoute) {
      throw new VaultCliError(
        'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE',
        'Hosted group delivery requires live thread route authority before provider work.',
        { retryable: true },
      )
    }
    const authority = await resolveScheduledExternalThreadRoute({
      channel: 'telegram',
      signal: input.signal,
      target,
    })
    if (
      authority.channel !== 'telegram'
      || normalizeNullableString(authority.containerMemberId) === null
      || normalizeNullableString(authority.threadId) !== target
    ) {
      throw new VaultCliError(
        'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE',
        'Hosted group delivery requires exact thread route authority before provider work.',
        { retryable: true },
      )
    }
    return {
      conversationThreadId: null,
      deliveryPosture: null,
      externalThreadRouteAuthority: authority,
      route,
    }
  }

  if (input.target.channel !== 'linq') {
    return {
      conversationThreadId: null,
      deliveryPosture: null,
      externalThreadRouteAuthority: null,
      route,
    }
  }

  const target = normalizeNullableString(
    route.deliveryTarget ?? route.bindingDelivery?.target,
  )
  const targetKind = route.deliveryTarget || route.bindingDelivery?.kind === 'participant'
    ? 'explicit' as const
    : route.bindingDelivery?.kind === 'thread'
      ? 'thread' as const
      : null
  if (!target || !targetKind) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must bind one concrete Linq destination.',
    )
  }

  const resolveScheduledLinqRoute =
    input.executionContext?.hosted?.resolveScheduledLinqRoute
  if (!resolveScheduledLinqRoute) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
      'Hosted Linq delivery requires direct or group authority before provider work.',
      { retryable: true },
    )
  }
  const authority = await resolveScheduledLinqRoute({
    fromPhoneNumber:
      input.target.deliverySource?.kind === 'linq'
        ? input.target.deliverySource.fromPhoneNumber
        : null,
    homeRouteFallbackAllowed: route.threadIsDirect !== false,
    signal: input.signal,
    target,
    targetKind,
  })
  if (authority.deliveryBlockCode) {
    throw new AssistantCronLinqHealthPreflightBlockedError(
      authority.deliveryBlockCode,
    )
  }
  const authorizedTarget = normalizeNullableString(authority.target)
  const conversationThreadId = normalizeNullableString(
    authority.conversationThreadId,
  )
  if (!authorizedTarget || typeof authority.threadIsDirect !== 'boolean') {
    throw new VaultCliError(
      'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
      'Hosted Linq delivery requires direct or group authority before provider work.',
      { retryable: true },
    )
  }
  if (authorizedTarget !== target && !conversationThreadId) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE',
      'Hosted Linq route changes require a matching conversation locator.',
      { retryable: true },
    )
  }

  const bindingDelivery = route.bindingDelivery
    ? {
        kind: route.bindingDelivery.kind === 'participant'
          ? 'thread' as const
          : route.bindingDelivery.kind,
        target: authorizedTarget,
      }
    : null

  return {
    conversationThreadId,
    deliveryPosture: authority.deliveryPosture ?? null,
    externalThreadRouteAuthority: null,
    route: {
      bindingDelivery,
      deliveryTarget: route.deliveryTarget === null ? null : authorizedTarget,
      threadIsDirect: authority.threadIsDirect,
    },
  }
}

class AssistantCronLinqHealthPreflightBlockedError extends VaultCliError {
  constructor(blockCode: HostedRuntimeLinqDeliveryBlockCode) {
    super(
      `ASSISTANT_LINQ_EGRESS_${blockCode.toUpperCase()}`,
      'Scheduled Linq delivery skipped by current line or chat health.',
    )
  }
}

class AssistantCronForegroundYieldedError extends VaultCliError {
  constructor(jobName: string) {
    super(
      'ASSISTANT_CRON_FOREGROUND_YIELDED',
      `Assistant cron job "${jobName}" yielded to fresh foreground input.`,
    )
  }
}

class AssistantCronCanonicalSourceInvalidatedError extends VaultCliError {
  readonly disposition: Exclude<AssistantCronCanonicalSourceDisposition, 'current'>

  constructor(input: Exclude<AssistantCronCanonicalSourceAuthority, { kind: 'current' }>) {
    super(
      'ASSISTANT_CRON_AUTHORITY_STALE',
      input.reason,
    )
    this.disposition = input.kind
  }
}

class AssistantCronLifecycleNotificationInvalidatedError extends VaultCliError {
  constructor(reason: string) {
    super('ASSISTANT_CRON_LIFECYCLE_AUTHORITY_STALE', reason)
  }
}

function buildAssistantCronOnboardingFollowupReconciliationRequiredError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CRON_ONBOARDING_FOLLOWUP_RECONCILIATION_REQUIRED',
    ASSISTANT_CRON_ONBOARDING_FOLLOWUP_RECONCILIATION_REQUIRED_ERROR,
    { retryable: true },
  )
}

class AssistantCronManagedOwnerInvalidatedError extends VaultCliError {
  constructor() {
    super(
      'ASSISTANT_CRON_MANAGED_OWNER_SCOPE_STALE',
      ASSISTANT_CRON_MANAGED_OWNER_SCOPE_MISMATCH_ERROR,
    )
  }
}

function buildAssistantCronForegroundYieldedError(
  jobName: string,
): AssistantCronForegroundYieldedError {
  return new AssistantCronForegroundYieldedError(jobName)
}

function assertAssistantCronForegroundNotYielded(input: {
  jobName: string
  shouldYield: (() => boolean) | null
}): void {
  if (input.shouldYield?.() === true) {
    throw buildAssistantCronForegroundYieldedError(input.jobName)
  }
}

async function preemptAssistantCronNotificationCommitForForeground(input: {
  allowTerminalNoDelivery: boolean
  deliveryOutcome: AssistantDeliveryOutcome | null
  foregroundPreemption: ReturnType<typeof createAssistantCronForegroundPreemption>
  jobName: string
  shouldYield: (() => boolean) | null
  vault: string
}): Promise<void> {
  const foregroundYielded =
    input.foregroundPreemption.wasForegroundYielded()
    || input.shouldYield?.() === true
  if (!foregroundYielded) {
    return
  }

  if (input.allowTerminalNoDelivery) {
    return
  }

  const deliveryOutcome = input.deliveryOutcome
  if (deliveryOutcome?.kind === 'sent') {
    return
  }

  if (deliveryOutcome?.kind === 'queued') {
    const abandonedIntent = await markAssistantOutboxIntentMirrorTerminalById({
      error: buildAssistantCronForegroundYieldedError(input.jobName),
      intentId: deliveryOutcome.intentId,
      onlyCurrentStatuses: ['pending', 'retryable', 'awaiting_approval'],
      status: 'abandoned',
      vault: input.vault,
    })
    if (abandonedIntent !== null && abandonedIntent.status !== 'abandoned') {
      return
    }
  }

  throw buildAssistantCronForegroundYieldedError(input.jobName)
}

function createAssistantCronForegroundPreemption(input: {
  jobName: string
  parentSignal?: AbortSignal
  shouldYield: (() => boolean) | null
}): {
  dispose: () => void
  signal?: AbortSignal
  wasForegroundYielded: () => boolean
} {
  if (!input.shouldYield) {
    return {
      dispose: () => {},
      signal: input.parentSignal,
      wasForegroundYielded: () => false,
    }
  }

  const controller = new AbortController()
  let foregroundYielded = false
  let disposed = false
  let interval: ReturnType<typeof setInterval> | null = null

  const abortForForeground = (): void => {
    if (disposed || controller.signal.aborted) {
      return
    }

    foregroundYielded = true
    controller.abort(buildAssistantCronForegroundYieldedError(input.jobName))
  }
  const checkForeground = (): void => {
    if (input.shouldYield?.() === true) {
      abortForForeground()
    }
  }
  const abortFromParent = (): void => {
    if (disposed || controller.signal.aborted) {
      return
    }

    controller.abort(input.parentSignal?.reason)
  }

  if (input.parentSignal?.aborted) {
    abortFromParent()
  } else {
    input.parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  checkForeground()
  interval = setInterval(checkForeground, 50)
  interval.unref?.()

  return {
    dispose: () => {
      disposed = true
      if (interval) {
        clearInterval(interval)
      }
      input.parentSignal?.removeEventListener('abort', abortFromParent)
    },
    signal: controller.signal,
    wasForegroundYielded: () => foregroundYielded,
  }
}

function computeAssistantCronForegroundYieldRetryAt(finishedAt: string): string {
  return new Date(Date.parse(finishedAt) + 10_000).toISOString()
}

function cryptoRandomRunId(): string {
  return `cronrun_${randomUUID().replace(/-/gu, '')}`
}

function resolveNextDueAssistantCronCandidate(input: {
  canonicalRecords: readonly CanonicalAssistantCronJobRecord[]
  localStore: AssistantCronStore
  nowIso: string
  runtimeScopeInput: AssistantCronRunnableProjectionInput
  runtimeStore: AssistantCronCanonicalRuntimeStore
}): DueAssistantCronCandidate | null {
  const projection = buildRunnableAssistantCronJobProjection({
    canonicalRecords: input.canonicalRecords,
    localStore: input.localStore,
    runtimeScopeInput: input.runtimeScopeInput,
    runtimeStore: input.runtimeStore,
  })
  const candidate = projection.jobs.find((job) =>
    isAssistantCronJobDue(job, input.nowIso)
  )
  if (!candidate) {
    return null
  }

  const localJob =
    input.localStore.jobs.find((job) => job.jobId === candidate.jobId) ?? undefined
  if (localJob) {
    return {
      job: candidate,
      localJob,
    }
  }

  const canonicalEntry = projection.canonicalEntries.find(
    (entry) => resolveCanonicalAssistantCronJobId(entry.source) === candidate.jobId,
  )
  return {
    job: candidate,
    ...(canonicalEntry ? { canonicalEntry } : {}),
  }
}

// Background maintenance is hosted-only; everything else runs anywhere.
function canonicalAssistantCronSourceCanRunInRuntime(input: {
  hostedRuntimeProcess: boolean
  source: CanonicalAssistantCronJobRecord
}): boolean {
  return !canonicalAssistantCronSourceIsBackgroundMaintenance(input.source) ||
    input.hostedRuntimeProcess
}

export function canonicalAssistantCronSourceIsBackgroundMaintenance(
  source: CanonicalAssistantCronJobRecord,
): boolean {
  return source.kind === 'automation' &&
    resolveMurphManagedMaintenancePolicy(source.automationId) !== null
}

function resolveAssistantCronRuntimeScope(
  input: AssistantCronRuntimeScopeInput,
): boolean {
  return input.executionContext?.hosted != null ||
    isHostedRuntimeProcessEnv(input.turnEnvironment?.env ?? {}) ||
    isHostedRuntimeProcessEnv(process.env)
}

function cryptoRandomCronClaimId(): string {
  return `cronclaim_${randomUUID().replace(/-/gu, '')}`
}

function canonicalRuntimeClaimMatches(
  claimed: AssistantCronCanonicalRuntimeRecord,
  current: AssistantCronCanonicalRuntimeRecord,
): boolean {
  return claimed.state.runningClaimId !== null &&
    claimed.state.runningClaimId === current.state.runningClaimId
}

async function assertCanonicalRuntimeClaimCurrent(input: {
  job: Extract<ResolvedAssistantCronJob, { kind: 'canonical' }>
  paths: AssistantStatePaths
}): Promise<void> {
  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths)
  const currentRuntimeState =
    findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      resolveCanonicalAssistantCronJobId(input.job.source),
    ) ?? input.job.runtimeState

  if (!canonicalRuntimeClaimMatches(input.job.runtimeState, currentRuntimeState)) {
    throw new VaultCliError(
      'ASSISTANT_CRON_CLAIM_LOST',
      `Assistant cron job "${input.job.job.name}" was reclaimed before it started.`,
    )
  }
}

function createAssistantCronBackgroundMaintenanceCancellation(input: {
  job: ResolvedAssistantCronJob
  signal: AbortSignal | null
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
}): {
  dispose(): void
  shouldYield(): boolean
  yieldRequested(): boolean
  signal: AbortSignal
} {
  if (!assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)) {
    return {
      dispose() {},
      shouldYield: () => false,
      yieldRequested: () => false,
      signal: input.signal ?? new AbortController().signal,
    }
  }

  const controller = new AbortController()
  let yielded = false
  const abortForYield = () => {
    yielded = true
    if (!controller.signal.aborted) {
      controller.abort(createAssistantCronBackgroundMaintenanceYieldError())
    }
  }
  const abortForParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(input.signal?.reason)
    }
  }
  const checkYield = () => {
    if (input.shouldYieldBackgroundMaintenance?.() === true) {
      abortForYield()
    }
  }

  if (input.signal?.aborted) {
    abortForParent()
  } else {
    input.signal?.addEventListener('abort', abortForParent, { once: true })
  }

  checkYield()
  const timer =
    input.shouldYieldBackgroundMaintenance &&
    !controller.signal.aborted
      ? setInterval(checkYield, ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELD_POLL_MS)
      : null
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }

  return {
    dispose() {
      if (timer) {
        clearInterval(timer)
      }
      input.signal?.removeEventListener('abort', abortForParent)
    },
    shouldYield() {
      if (yielded) {
        return true
      }
      if (input.shouldYieldBackgroundMaintenance?.() === true) {
        abortForYield()
        return true
      }
      return false
    },
    yieldRequested() {
      return yielded
    },
    signal: controller.signal,
  }
}

function assistantNotificationErrorHasNonReplayableProviderWork(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const details = Reflect.get(error, 'details')
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return false
  }

  return Reflect.get(details, 'assistantNotificationProviderNonReplayableWork') === true
}

function resolveAssistantCronBackgroundMaintenancePolicy(
  job: ResolvedAssistantCronJob,
): MurphManagedMaintenancePolicy | null {
  return job.kind === 'canonical' && job.source.kind === 'automation'
    ? resolveMurphManagedMaintenancePolicy(job.source.automationId)
    : null
}

function assistantCronJobIsPreemptibleBackgroundMaintenance(
  job: ResolvedAssistantCronJob,
): boolean {
  return job.kind === 'canonical' &&
    canonicalAssistantCronSourceIsBackgroundMaintenance(job.source)
}

function createAssistantCronBackgroundMaintenanceYieldError(): VaultCliError {
  return new VaultCliError(
    ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELDED_CODE,
    'Assistant cron background maintenance yielded to foreground input.',
  )
}

async function releaseClaimedAssistantCronJobAfterBackgroundMaintenanceYield(input: {
  job: ResolvedAssistantCronJob
  paths: AssistantStatePaths
}): Promise<void> {
  if (input.job.kind !== 'canonical') {
    return
  }
  const job = input.job

  await withAssistantCronWriteLock(input.paths, async () => {
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(input.paths, {
      reclaimStaleRunningClaims: false,
    })
    const currentRuntimeState =
      findAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        resolveCanonicalAssistantCronJobId(job.source),
      ) ?? job.runtimeState

    if (!canonicalRuntimeClaimMatches(job.runtimeState, currentRuntimeState)) {
      return
    }

    const now = new Date().toISOString()
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, {
      ...currentRuntimeState,
      updatedAt: now,
      state: {
        ...currentRuntimeState.state,
        runningAt: null,
        runningClaimId: null,
        runningPid: null,
        retryAfterAt: computeAssistantCronBackgroundMaintenanceYieldRetryAt(now),
      },
    })
    await writeAssistantCronCanonicalRuntimeStore(input.paths, runtimeStore)
  })
}
