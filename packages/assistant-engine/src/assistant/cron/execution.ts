import { randomUUID } from 'node:crypto'
import { setScheduledLogStatus, upsertAutomation } from '@murphai/core'
import {
  isHostedRuntimeProcessEnv,
} from '@murphai/hosted-execution/cli-runtime-bridge'
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
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  sendAssistantNotificationLocal,
  type AssistantNotificationTurnPolicy,
} from '../../assistant-service.js'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from '../automation-tags.js'
import { buildAssistantAutomationTurnEnvelope } from '../automation/turn-envelope.js'
import {
  computeAssistantAutomationRetryAt,
  type AssistantRunEvent,
} from '../automation/shared.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import {
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
} from '../managed-automations.js'
import { readAssistantOnboardingState } from '../onboarding-state.js'
import { runExperimentLifecycleOutcomePrecondition } from '../experiment-support-automations.js'
import {
  markAssistantOutboxIntentMirrorTerminalById,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type {
  AssistantDeliveryOutcome,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import type { AssistantStatePaths } from '../store/paths.js'
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
  isCanonicalAssistantCronSourceEnabled,
  automationContinuityUsesSessionPin,
  listCanonicalAssistantCronRecords,
  projectCanonicalAssistantCronJob,
  type CanonicalAssistantCronJobRecord,
  resolveCanonicalAssistantCronJobId,
  resolveCanonicalAssistantCronOccurrenceAt,
  resolveCanonicalRuntimeState,
  type ResolvedAssistantCronJob,
} from './canonical-jobs.js'
import {
  appendAssistantCronRun,
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
  resolveAssistantCronTargetBindingDelivery,
  validateAssistantCronDeliveryTarget,
} from './targets.js'

const ASSISTANT_CRON_RUN_SCHEMA = 'murph.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000
const ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS = 60 * 60 * 1000
const ASSISTANT_CRON_NOTIFICATION_EXPIRED_ERROR =
  'Assistant cron notification expired before delivery.'
const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_YIELD_POLL_MS = 250
const ASSISTANT_CRON_BACKGROUND_MAINTENANCE_NON_REPLAYABLE_WORK_ERROR =
  'Assistant background maintenance stopped after provider work; occurrence consumed to avoid replay.'
const ASSISTANT_CRON_FOREGROUND_YIELDED_ERROR =
  'Assistant cron yielded to fresh foreground input.'
const ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR =
  'Device activity occurrence skipped because its parent listener is no longer authorized.'
const ASSISTANT_CRON_ONBOARDING_OPEN_RESEARCH_SKIP_ERROR =
  'Assistant cron research-oriented managed automation skipped because assistant onboarding is open.'
const ASSISTANT_CRON_ONBOARDING_UNREADABLE_RESEARCH_SKIP_ERROR =
  'Assistant cron research-oriented managed automation skipped because assistant onboarding state could not be read.'
const MURPH_RESEARCH_ORIENTED_MANAGED_AUTOMATION_TAGS = new Set([
  'murph-managed:weekly-health-insight',
  'murph-managed:weekly-health-research-scout',
])
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

export async function executeClaimedAssistantCronJob(input: {
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
}): Promise<{
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
  runErrorCode: string | null
}> {
  const claimedJob = input.job.job
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
  let errorCode: string | null = null
  let foregroundYielded = false
  let outcome: AssistantCronRunOutcome = 'failed'
  let reason = 'unhandled'
  let pendingDeliveryIntentId: string | null = null
  // Preemptible background maintenance has exactly one yield owner: the
  // maintenance cancellation below. Wiring the generic foreground poller too
  // (hosted passes the same predicate as both callbacks) created a race
  // where whichever poll aborted first decided between a clean maintenance
  // release and a spurious failed foreground-yield run.
  const maintenanceJob = assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)
  let maintenanceProviderStarted = false
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
    }

    const deviceActivityAuthority = await resolveDeviceActivityParentAuthority({
      job: input.job,
      vault: input.vault,
    })
    const staleError =
      input.trigger === 'scheduled' &&
        !assistantCronJobIsPreemptibleBackgroundMaintenance(input.job)
        ? resolveStaleAssistantCronNotificationError({
            job: claimedJob,
            nowIso: startedAt,
            occurrenceAt,
          })
        : null

    if (deviceActivityAuthority.error !== null) {
      outcome = 'skipped_gate'
      reason = 'device_activity_authority_stale'
      errorText = deviceActivityAuthority.error
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
        const automationTurn = buildAssistantAutomationTurnEnvelope({
          assistantTargetOverride:
            resolveAssistantCronAutomationTargetOverride(input.job) ??
            deviceActivityAuthority.assistantTargetOverride,
          deliveryDispatchMode: input.deliveryDispatchMode,
          executionContext: input.executionContext,
          serviceTier,
          signal: yieldCancellation.signal,
          turnEnvironment: input.turnEnvironment ?? null,
          turnTrigger: 'automation-cron',
        })
        const bindingDelivery = resolveAssistantCronTargetBindingDelivery(
          claimedJob.target,
        )
        // Run lifecycle-owned deterministic eligibility + persistence BEFORE
        // the LLM turn. The precondition reads canonical experiment state
        // once and decides:
        //   - `continue`: not a lifecycle job (or eligible and outcome
        //     persisted); proceed to the LLM as normal.
        //   - `skip`: ineligible at fire time; mark the run skipped so the
        //     one-shot is consumed without writing an outcome or invoking
        //     the LLM.
        // A persistence failure throws → the surrounding try/catch records
        // the run as failed and the existing cron backoff retries. We must
        // not delegate this to the LLM: skip and send_message both mark the
        // run successful and consume the at-occurrence.
        let lifecycleSkipReason: string | null = null
        if (
          input.job.kind === 'canonical' &&
          input.job.source.kind === 'automation'
        ) {
          // Route on the immutable automationId so a user-edited slug cannot
          // silently bypass the precondition.
          const lifecycleResult = await runExperimentLifecycleOutcomePrecondition({
            automationId: input.job.source.automationId,
            tags: input.job.source.tags,
            vault: input.vault,
          })
          if (lifecycleResult.kind === 'skip') {
            lifecycleSkipReason = lifecycleResult.reason
          }
        }
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
          const result = await sendAssistantNotificationLocal({
            vault: input.vault,
            ...automationTurn,
            // Replay barrier: once the provider was admitted, a yielded
            // maintenance turn may already have committed memory writes even
            // if the completed-command event never reached the buffered raw
            // events, so the occurrence must be consumed, not retried.
            ...(maintenanceJob
              ? {
                  onProviderRequestStarted: () => {
                    maintenanceProviderStarted = true
                  },
                }
              : {}),
            beforeCommit: async (context) => {
              await preemptAssistantCronNotificationCommitForForeground({
                deliveryOutcome: context.deliveryOutcome ?? null,
                foregroundPreemption,
                jobName: claimedJob.name,
                shouldYield: input.shouldYield ?? null,
                vault: input.vault,
              })
            },
            instructions: buildAssistantCronExecutionInstructions(claimedJob),
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
            participantId: claimedJob.target.participantId,
            turnPolicy: resolveAssistantCronNotificationTurnPolicy(input.job),
            responsePolicy: resolveAssistantCronNotificationResponsePolicy(input.job),
            threadId: claimedJob.target.threadId,
            bindingDeliveryTarget: bindingDelivery?.target ?? undefined,
            deferCommitUntilDeliveryAccepted:
              input.deliveryDispatchMode === 'queue-only',
            deliveryKind: bindingDelivery?.kind ?? undefined,
            deliverySource: claimedJob.target.deliverySource,
            deliveryTarget: claimedJob.target.deliveryTarget,
            operatorAuthority: 'direct-operator',
            workingDirectory: input.vault,
          })

          sessionId = result.session.sessionId
          response = result.response ?? result.decision.privateSummary
          const foregroundYieldedAfterNotification =
            !maintenanceJob &&
            (foregroundPreemption.wasForegroundYielded() ||
              input.shouldYield?.() === true)
          if (result.deliveryOutcome?.kind === 'queued') {
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
              result.deliveryOutcome?.kind !== 'sent'
            ) {
              throw buildAssistantCronForegroundYieldedError(claimedJob.name)
            }
          }
        }
      }
    }
  } catch (error) {
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
        errorCode = error instanceof VaultCliError ? error.code : null
        reason = errorCode ?? 'error'
      }
      outcome = 'failed'
    }
  } finally {
    foregroundPreemption.dispose()
    finishedAt = new Date().toISOString()
    yieldCancellation.dispose()
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
        responseSessionId: sessionId,
        pendingDeliveryIntentId,
        run,
      })
      let removedAfterRun = false

      if (shouldRemoveAssistantCronJobAfterRun(current, run, pendingDeliveryIntentId)) {
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

    if (shouldRemoveAssistantCronJobAfterRun(finalizedJob, run, pendingDeliveryIntentId)) {
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

function isResearchOrientedManagedAutomationCronJob(
  job: ResolvedAssistantCronJob,
): boolean {
  return (
    job.kind === 'canonical' &&
    job.source.kind === 'automation' &&
    job.source.tags.some((tag) =>
      MURPH_RESEARCH_ORIENTED_MANAGED_AUTOMATION_TAGS.has(tag),
    )
  )
}

function buildAssistantCronExecutionInstructions(job: AssistantCronJob): string {
  return job.prompt
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

function resolveAssistantCronNotificationResponsePolicy(
  job: ResolvedAssistantCronJob,
): { kind: 'require_send' } | null {
  if (readAssistantDeviceActivityCronJobMetadata(job.job.name)) {
    return { kind: 'require_send' }
  }

  return listAssistantCronNotificationTags(job).includes(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    ? { kind: 'require_send' }
    : null
}

function resolveAssistantCronNotificationTurnPolicy(
  job: ResolvedAssistantCronJob,
): AssistantNotificationTurnPolicy | null {
  return assistantCronJobIsPreemptibleBackgroundMaintenance(job)
    ? {
        kind: 'maintenance-exact-skip',
        privateSummary: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_PRIVATE_SUMMARY,
      }
    : null
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

  if (assistantCronRunConsumedOccurrence(input.run, input.pendingDeliveryIntentId)) {
    const nextRunAt = resolveAssistantCronNextRunAfterSuccess(
      input.job,
      new Date(input.finishedAt),
    )

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
): boolean {
  return (
    job.schedule.kind === 'at' &&
    !job.keepAfterRun &&
    assistantCronRunConsumedOccurrence(run, pendingDeliveryIntentId)
  )
}

// A stale-skipped wake consumes its occurrence like a success so one-shots
// archive and recurring schedules advance; a delivery-queued skip keeps the
// occurrence pending until the outbound delivery confirms.
function assistantCronRunConsumedOccurrence(
  run: AssistantCronRunRecord,
  pendingDeliveryIntentId: string | null,
): boolean {
  return (
    run.outcome === 'delivered' ||
    run.outcome === 'no_op' ||
    run.outcome === 'expired' ||
    run.outcome === 'skipped_gate'
  )
}

function finalizeCanonicalAssistantCronRuntimeAfterRun(input: {
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

  if (assistantCronRunConsumedOccurrence(input.run, input.pendingDeliveryIntentId)) {
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
}> {
  if (input.job.kind !== 'local') {
    return {
      assistantTargetOverride: null,
      error: null,
    }
  }

  const metadata = readAssistantDeviceActivityCronJobMetadata(input.job.job.name)
  if (!metadata) {
    return {
      assistantTargetOverride: null,
      error: null,
    }
  }

  const parentAutomation = await readAssistantDeviceActivityParentAutomation({
    metadata,
    vault: input.vault,
  })
  if (!parentAutomation || parentAutomation.status !== 'active') {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
    }
  }
  if (parentAutomation.schedule.kind !== 'deviceActivity') {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
    }
  }
  if (!assistantCronTargetMatchesAutomationRoute(input.job.job.target, parentAutomation.route)) {
    return {
      assistantTargetOverride: null,
      error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
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

  return authorityMatches
    ? {
        assistantTargetOverride: parentAutomation.assistantTargetOverride,
        error: null,
      }
    : {
        assistantTargetOverride: null,
        error: ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_STALE_ERROR,
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
    target.threadId === route.threadId
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
  job: AssistantCronJob
  nowIso: string
  occurrenceAt: string
}): { latenessMinutes: number; message: string } | null {
  if (input.job.scheduledLog) {
    return null
  }

  const nowMs = Date.parse(input.nowIso)
  const occurrenceMs = Date.parse(input.occurrenceAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(occurrenceMs)) {
    return null
  }

  const ageMs = nowMs - occurrenceMs
  if (ageMs <= ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS) {
    return null
  }

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

class AssistantCronForegroundYieldedError extends VaultCliError {
  constructor(jobName: string) {
    super(
      'ASSISTANT_CRON_FOREGROUND_YIELDED',
      `Assistant cron job "${jobName}" yielded to fresh foreground input.`,
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
    source.automationId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID
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
