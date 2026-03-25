import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronRunRecord,
  type AssistantCronSchedule,
  type AssistantCronTrigger,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { withAssistantCronWriteLock } from './cron/locking.js'
import {
  buildAssistantCronSchedule,
  computeAssistantCronNextRunAt,
} from './cron/schedule.js'
import {
  getAssistantCronPresetDefinition,
  listAssistantCronPresets as listBuiltinAssistantCronPresets,
  renderAssistantCronPreset,
  type AssistantCronPresetDefinition,
} from './cron/presets.js'
import {
  appendAssistantCronRun,
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  createAssistantCronJobId,
  createAssistantCronRunId,
  ensureAssistantCronState,
  isAssistantCronJobDue,
  normalizeRequiredAssistantCronText,
  readAssistantCronRuns,
  readAssistantCronStore,
  resolveAssistantCronJobFromStore,
  resolveAssistantCronJobIndex,
  resolveAssistantCronRunLookupId,
  sortAssistantCronJobs,
  type AssistantCronTargetInput,
  writeAssistantCronStore,
} from './cron/store.js'
import { sendAssistantMessage } from './service.js'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store.js'
import { errorMessage, normalizeNullableString } from './shared.js'

const ASSISTANT_CRON_JOB_SCHEMA = 'healthybob.assistant-cron-job.v1'
const ASSISTANT_CRON_RUN_SCHEMA = 'healthybob.assistant-cron-run.v1'
const ASSISTANT_CRON_MAX_RESPONSE_LENGTH = 4_000

export interface AddAssistantCronJobInput extends AssistantCronTargetInput {
  enabled?: boolean
  keepAfterRun?: boolean
  name: string
  now?: Date
  prompt: string
  schedule: AssistantCronSchedule
  vault: string
}

export interface AssistantCronStatusSnapshot {
  dueJobs: number
  enabledJobs: number
  nextRunAt: string | null
  runningJobs: number
  totalJobs: number
}

export interface AssistantCronRunExecutionResult {
  job: AssistantCronJob
  removedAfterRun: boolean
  run: AssistantCronRunRecord
}

export interface AssistantCronProcessDueResult {
  failed: number
  processed: number
  succeeded: number
}

export interface RunAssistantCronJobInput {
  job: string
  signal?: AbortSignal
  trigger?: AssistantCronTrigger
  vault: string
}

export interface ProcessDueAssistantCronJobsInput {
  limit?: number
  signal?: AbortSignal
  vault: string
}

export interface InstallAssistantCronPresetInput extends AssistantCronTargetInput {
  additionalInstructions?: string | null
  enabled?: boolean
  name?: string | null
  presetId: string
  schedule?: AssistantCronSchedule | null
  variables?: Record<string, string | null | undefined> | null
  vault: string
}

export interface InstallAssistantCronPresetResult {
  job: AssistantCronJob
  preset: AssistantCronPreset
  resolvedPrompt: string
  resolvedVariables: Record<string, string>
}

export function listAssistantCronPresets(): AssistantCronPreset[] {
  return listBuiltinAssistantCronPresets()
}

export function getAssistantCronPreset(
  presetId: string,
): AssistantCronPresetDefinition {
  return getAssistantCronPresetDefinition(presetId)
}

export async function installAssistantCronPreset(
  input: InstallAssistantCronPresetInput,
): Promise<InstallAssistantCronPresetResult> {
  const rendered = renderAssistantCronPreset({
    presetId: input.presetId,
    variables: input.variables,
    additionalInstructions: input.additionalInstructions,
  })
  const resolvedName = normalizeNullableString(input.name) ?? rendered.preset.suggestedName
  const schedule = input.schedule ?? rendered.preset.suggestedSchedule
  const job = await addAssistantCronJob({
    vault: input.vault,
    name: resolvedName,
    prompt: rendered.resolvedPrompt,
    schedule,
    enabled: input.enabled,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    participantId: input.participantId,
    sourceThreadId: input.sourceThreadId,
    deliverResponse: input.deliverResponse,
    deliveryTarget: input.deliveryTarget,
  })

  return {
    preset: rendered.preset,
    job,
    resolvedPrompt: rendered.resolvedPrompt,
    resolvedVariables: rendered.resolvedVariables,
  }
}

export async function addAssistantCronJob(
  input: AddAssistantCronJobInput,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(input.vault)
  const now = input.now ?? new Date()
  const name = normalizeRequiredAssistantCronText(input.name, 'name')
  const prompt = normalizeRequiredAssistantCronText(input.prompt, 'prompt')
  const enabled = input.enabled ?? true
  const keepAfterRun =
    input.schedule.kind === 'at' ? input.keepAfterRun ?? false : true
  const nextRunAt = computeAssistantCronNextRunAt(input.schedule, now)

  if (enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a future run time.',
    )
  }

  await ensureAssistantCronState(paths)

  return withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    assertAssistantCronJobNameIsAvailable(store, name)

    const timestamp = now.toISOString()
    const job = assistantCronJobSchema.parse({
      schema: ASSISTANT_CRON_JOB_SCHEMA,
      jobId: createAssistantCronJobId(),
      name,
      enabled,
      keepAfterRun,
      prompt,
      schedule: input.schedule,
      target: buildAssistantCronTarget(input),
      createdAt: timestamp,
      updatedAt: timestamp,
      state: {
        nextRunAt,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      },
    })

    store.jobs.push(job)
    await writeAssistantCronStore(paths, store)
    return job
  })
}

export async function listAssistantCronJobs(
  vault: string,
): Promise<AssistantCronJob[]> {
  const paths = resolveAssistantStatePaths(vault)
  const store = await readAssistantCronStore(paths)
  return sortAssistantCronJobs(store.jobs)
}

export async function getAssistantCronJob(
  vault: string,
  job: string,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  const store = await readAssistantCronStore(paths)
  return resolveAssistantCronJobFromStore(store, job)
}

export async function removeAssistantCronJob(
  vault: string,
  job: string,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantCronState(paths)

  return withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const index = resolveAssistantCronJobIndex(store, job)
    const [removed] = store.jobs.splice(index, 1)
    await writeAssistantCronStore(paths, store)
    return removed as AssistantCronJob
  })
}

export async function setAssistantCronJobEnabled(
  vault: string,
  job: string,
  enabled: boolean,
): Promise<AssistantCronJob> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantCronState(paths)

  return withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const index = resolveAssistantCronJobIndex(store, job)
    const existing = store.jobs[index] as AssistantCronJob
    const now = new Date()

    const nextRunAt = enabled
      ? resolveAssistantCronReenabledNextRunAt(existing, now)
      : existing.state.nextRunAt

    if (enabled && nextRunAt === null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_STATE',
        `Assistant cron job "${existing.name}" no longer has a future scheduled run. Run it manually or recreate it with a new schedule.`,
      )
    }

    const updated = assistantCronJobSchema.parse({
      ...existing,
      enabled,
      updatedAt: now.toISOString(),
      state: {
        ...existing.state,
        nextRunAt,
      },
    })

    store.jobs[index] = updated
    await writeAssistantCronStore(paths, store)
    return updated
  })
}

export async function getAssistantCronStatus(
  vault: string,
): Promise<AssistantCronStatusSnapshot> {
  const paths = resolveAssistantStatePaths(vault)
  const store = await readAssistantCronStore(paths)
  const now = new Date().toISOString()

  const enabledJobs = store.jobs.filter((job) => job.enabled)
  const dueJobs = enabledJobs.filter((job) => isAssistantCronJobDue(job, now)).length
  const runningJobs = store.jobs.filter((job) => job.state.runningAt !== null).length
  const nextRunAt =
    enabledJobs
      .map((job) => job.state.nextRunAt)
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null

  return {
    totalJobs: store.jobs.length,
    enabledJobs: enabledJobs.length,
    dueJobs,
    runningJobs,
    nextRunAt,
  }
}

export async function listAssistantCronRuns(input: {
  job: string
  limit?: number
  vault: string
}): Promise<{
  jobId: string
  runs: AssistantCronRunRecord[]
}> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)
  const store = await readAssistantCronStore(paths)
  const jobId = resolveAssistantCronRunLookupId(store, input.job)
  const runs = await readAssistantCronRuns(paths, jobId)
  const limit = typeof input.limit === 'number' ? Math.max(1, input.limit) : 20

  return {
    jobId,
    runs: runs.slice(0, limit),
  }
}

export async function runAssistantCronJobNow(
  input: RunAssistantCronJobInput,
): Promise<AssistantCronRunExecutionResult> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)

  const claimed = await withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const index = resolveAssistantCronJobIndex(store, input.job)
    const existing = store.jobs[index] as AssistantCronJob

    if (existing.state.runningAt !== null) {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_RUNNING',
        `Assistant cron job "${existing.name}" is already running.`,
      )
    }

    const claimedJob = assistantCronJobSchema.parse({
      ...existing,
      updatedAt: new Date().toISOString(),
      state: {
        ...existing.state,
        runningAt: new Date().toISOString(),
        runningPid: process.pid,
      },
    })

    store.jobs[index] = claimedJob
    await writeAssistantCronStore(paths, store)
    return claimedJob
  })

  return executeClaimedAssistantCronJob({
    paths,
    signal: input.signal,
    trigger: input.trigger ?? 'manual',
    vault: input.vault,
    job: claimed,
  })
}

export async function processDueAssistantCronJobs(
  input: ProcessDueAssistantCronJobsInput,
): Promise<AssistantCronProcessDueResult> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)

  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : Number.POSITIVE_INFINITY
  const summary: AssistantCronProcessDueResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
  }

  while (!input.signal?.aborted && summary.processed < limit) {
    const claimed = await claimNextDueAssistantCronJob(paths)
    if (!claimed) {
      break
    }

    const result = await executeClaimedAssistantCronJob({
      paths,
      signal: input.signal,
      trigger: 'scheduled',
      vault: input.vault,
      job: claimed,
    })
    summary.processed += 1

    if (result.run.status === 'succeeded') {
      summary.succeeded += 1
    } else if (result.run.status === 'failed') {
      summary.failed += 1
    }
  }

  return summary
}

export { buildAssistantCronSchedule }

async function claimNextDueAssistantCronJob(
  paths: AssistantStatePaths,
): Promise<AssistantCronJob | null> {
  return withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const now = new Date().toISOString()
    const candidate = sortAssistantCronJobs(store.jobs).find((job) =>
      isAssistantCronJobDue(job, now),
    )
    if (!candidate) {
      return null
    }

    const index = store.jobs.findIndex((job) => job.jobId === candidate.jobId)
    if (index === -1) {
      return null
    }

    const claimed = assistantCronJobSchema.parse({
      ...candidate,
      updatedAt: now,
      state: {
        ...candidate.state,
        runningAt: now,
        runningPid: process.pid,
      },
    })

    store.jobs[index] = claimed
    await writeAssistantCronStore(paths, store)
    return claimed
  })
}

async function executeClaimedAssistantCronJob(input: {
  job: AssistantCronJob
  paths: AssistantStatePaths
  signal?: AbortSignal
  trigger: AssistantCronTrigger
  vault: string
}): Promise<AssistantCronRunExecutionResult> {
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let sessionId: string | null = null
  let response: string | null = null
  let errorText: string | null = null
  let status: AssistantCronRunRecord['status'] = 'failed'

  try {
    if (input.signal?.aborted) {
      throw new VaultCliError(
        'ASSISTANT_CRON_ABORTED',
        `Assistant cron job "${input.job.name}" was aborted before it started.`,
      )
    }

    const result = await sendAssistantMessage({
      vault: input.vault,
      prompt: input.job.prompt,
      sessionId: input.job.target.sessionId ?? undefined,
      alias: input.job.target.alias ?? undefined,
      channel: input.job.target.channel ?? undefined,
      identityId: input.job.target.identityId ?? undefined,
      participantId: input.job.target.participantId ?? undefined,
      sourceThreadId: input.job.target.sourceThreadId ?? undefined,
      deliverResponse: input.job.target.deliverResponse,
      deliveryTarget: input.job.target.deliveryTarget ?? undefined,
      workingDirectory: input.vault,
    })

    response = result.response
    sessionId = result.session.sessionId
    status = 'succeeded'
  } catch (error) {
    errorText = errorMessage(error)
    status = 'failed'
  } finally {
    finishedAt = new Date().toISOString()
  }

  const run = assistantCronRunRecordSchema.parse({
    schema: ASSISTANT_CRON_RUN_SCHEMA,
    runId: createAssistantCronRunId(),
    jobId: input.job.jobId,
    trigger: input.trigger,
    status,
    startedAt,
    finishedAt,
    sessionId,
    response: truncateAssistantCronResponse(response),
    responseLength: response?.length ?? 0,
    error: errorText,
  })

  const finalized = await withAssistantCronWriteLock(input.paths, async () => {
    const store = await readAssistantCronStore(input.paths)
    const index = store.jobs.findIndex((job) => job.jobId === input.job.jobId)

    if (index === -1) {
      await appendAssistantCronRun(input.paths, run)
      return {
        job: input.job,
        removedAfterRun: true,
      }
    }

    const current = store.jobs[index] as AssistantCronJob
    const finalizedJob = finalizeAssistantCronJobAfterRun({
      job: current,
      finishedAt,
      responseSessionId: sessionId,
      run,
    })
    let removedAfterRun = false

    if (shouldRemoveAssistantCronJobAfterRun(current, run)) {
      store.jobs.splice(index, 1)
      removedAfterRun = true
    } else {
      store.jobs[index] = finalizedJob
    }

    await appendAssistantCronRun(input.paths, run)
    await writeAssistantCronStore(input.paths, store)

    return {
      job: finalizedJob,
      removedAfterRun,
    }
  })

  return {
    job: finalized.job,
    removedAfterRun: finalized.removedAfterRun,
    run,
  }
}

function finalizeAssistantCronJobAfterRun(input: {
  finishedAt: string
  job: AssistantCronJob
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

  if (input.run.status === 'succeeded') {
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

  if (input.run.status === 'skipped') {
    return assistantCronJobSchema.parse({
      ...input.job,
      updatedAt: input.finishedAt,
      state: runningClearedState,
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
): boolean {
  return job.schedule.kind === 'at' && !job.keepAfterRun && run.status === 'succeeded'
}

function resolveAssistantCronNextRunAfterSuccess(
  job: AssistantCronJob,
  now: Date,
): string | null {
  if (!job.enabled) {
    return job.state.nextRunAt
  }

  if (job.schedule.kind === 'at') {
    return null
  }

  return computeAssistantCronNextRunAt(job.schedule, now)
}

function resolveAssistantCronReenabledNextRunAt(
  job: AssistantCronJob,
  now: Date,
): string | null {
  if (job.schedule.kind === 'at') {
    const oneShotTime = new Date(job.schedule.at)
    return oneShotTime.getTime() > now.getTime() ? oneShotTime.toISOString() : null
  }

  return computeAssistantCronNextRunAt(job.schedule, now)
}

function resolveAssistantCronFailureBackoffMs(failureCount: number): number {
  if (failureCount <= 1) {
    return 30_000
  }

  if (failureCount === 2) {
    return 60_000
  }

  if (failureCount === 3) {
    return 5 * 60_000
  }

  if (failureCount === 4) {
    return 15 * 60_000
  }

  return 60 * 60_000
}

function assistantCronJobHasStableSessionLocator(job: AssistantCronJob): boolean {
  return Boolean(
    job.target.sessionId ||
      job.target.alias ||
      (job.target.channel &&
        (job.target.participantId || job.target.sourceThreadId)),
  )
}

function truncateAssistantCronResponse(response: string | null): string | null {
  if (response === null) {
    return null
  }

  return response.slice(0, ASSISTANT_CRON_MAX_RESPONSE_LENGTH)
}
