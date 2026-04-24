import { upsertAutomation } from '@murphai/core'
import { showAutomation as showCanonicalAutomation } from '@murphai/query'
import {
  assistantCronJobSchema,
  assistantCronScheduleSchema,
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronSchedule,
  type AssistantCronScheduleInput,
  type AssistantCronTarget,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from '../store/paths.js'
import {
  ASSISTANT_CRON_JOB_SCHEMA,
  buildCanonicalAutomationRoute,
  buildCanonicalAutomationUpsertInput,
  projectCanonicalAssistantCronJob,
  requireCanonicalAssistantCronRecord,
  resolveAssistantCronDefaultTimeZone,
  resolveAssistantCronResolvedSchedule,
  type CanonicalAutomationAssistantCronJobRecord,
} from './canonical-jobs.js'
import { withAssistantCronWriteLock } from './locking.js'
import { renderAssistantCronPreset } from './presets.js'
import {
  createAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { computeAssistantCronNextRunAt } from './schedule.js'
import {
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  createAssistantCronJobId,
  ensureAssistantCronState,
  normalizeRequiredAssistantCronText,
  readAssistantCronStore,
  type AssistantCronTargetInput,
  writeAssistantCronStore,
} from './store.js'
import {
  resolveAssistantCronTargetDefaults,
  validateAssistantCronDeliveryTarget,
} from './targets.js'

export interface AssistantCronJobCreationBaseInput {
  enabled?: boolean
  keepAfterRun?: boolean
  name: string
  now?: Date
  prompt: string
  schedule: AssistantCronScheduleInput
  vault: string
}

export interface AddAssistantCronJobInput
  extends AssistantCronJobCreationBaseInput,
    AssistantCronTargetInput {
  foodAutoLog?: {
    foodId: string
  }
}

export interface AddAssistantFoodAutoLogCronJobInput
  extends AssistantCronJobCreationBaseInput {
  foodAutoLog: {
    foodId: string
  }
}

export interface InstallAssistantCronPresetInput extends AssistantCronTargetInput {
  additionalInstructions?: string | null
  enabled?: boolean
  name?: string | null
  presetId: string
  schedule?: AssistantCronScheduleInput | null
  variables?: Record<string, string | null | undefined> | null
  vault: string
}

export interface InstallAssistantCronPresetResult {
  job: AssistantCronJob
  preset: AssistantCronPreset
  resolvedPrompt: string
  resolvedVariables: Record<string, string>
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
    threadId: input.threadId,
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
  const resolvedInput = await resolveAssistantCronTargetDefaults(input)
  const { foodAutoLog } = resolvedInput
  if (foodAutoLog) {
    return addAssistantFoodAutoLogCronJob({
      vault: resolvedInput.vault,
      name: resolvedInput.name,
      prompt: resolvedInput.prompt,
      schedule: resolvedInput.schedule,
      now: resolvedInput.now,
      enabled: resolvedInput.enabled,
      keepAfterRun: resolvedInput.keepAfterRun,
      foodAutoLog,
      target: buildAssistantCronTarget(resolvedInput),
    })
  }

  const resolvedCreation = await resolveAssistantCronJobCreationInput(resolvedInput)
  const target = validateAssistantCronDeliveryTarget(resolvedInput)

  return withAssistantCronWriteLock(resolvedCreation.paths, async () => {
    const localStore = await readAssistantCronStore(resolvedCreation.paths)
    assertAssistantCronJobNameIsAvailable(localStore, resolvedCreation.name)

    const existingAutomation = await showCanonicalAutomation(
      resolvedCreation.vault,
      resolvedCreation.name,
    )
    if (existingAutomation && existingAutomation.status !== 'archived') {
      throw new VaultCliError(
        'ASSISTANT_CRON_JOB_EXISTS',
        `Assistant cron job "${resolvedCreation.name}" already exists.`,
      )
    }

    const created = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: resolvedCreation.vault,
        automationId: existingAutomation?.automationId,
        automation: existingAutomation,
        title: resolvedCreation.name,
        status: resolvedCreation.enabled ? 'active' : 'paused',
        schedule: resolvedCreation.schedule,
        route: buildCanonicalAutomationRoute(target),
        instructions: resolvedCreation.prompt,
      }),
    )
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
    )
    const timeZone = await resolveAssistantCronDefaultTimeZone(resolvedCreation.vault)
    const source = requireCanonicalAutomationCronRecord(
      created.record,
      timeZone,
    )
    const runtimeState = createAssistantCronCanonicalRuntimeRecord({
      jobId: source.automationId,
      now: resolvedCreation.now.toISOString(),
      sessionId: target.sessionId,
      alias: target.alias,
    })
    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, runtimeState)
    await writeAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
      runtimeStore,
    )

    return projectCanonicalAssistantCronJob({
      source,
      runtimeState,
    })
  })
}

export async function addAssistantFoodAutoLogCronJob(
  input: AddAssistantFoodAutoLogCronJobInput & {
    target: AssistantCronTarget
  },
): Promise<AssistantCronJob> {
  const resolvedCreation = await resolveAssistantCronJobCreationInput(input)

  return withAssistantCronWriteLock(resolvedCreation.paths, async () => {
    const store = await readAssistantCronStore(resolvedCreation.paths)
    assertAssistantCronJobNameIsAvailable(store, resolvedCreation.name)

    const timestamp = resolvedCreation.now.toISOString()
    const job = assistantCronJobSchema.parse({
      schema: ASSISTANT_CRON_JOB_SCHEMA,
      jobId: createAssistantCronJobId(),
      name: resolvedCreation.name,
      enabled: resolvedCreation.enabled,
      keepAfterRun: resolvedCreation.keepAfterRun,
      prompt: resolvedCreation.prompt,
      schedule: resolvedCreation.schedule,
      target: input.target,
      foodAutoLog: input.foodAutoLog,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: {
        nextRunAt: resolvedCreation.nextRunAt,
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
    await writeAssistantCronStore(resolvedCreation.paths, store)
    return job
  })
}

export async function resolveAssistantCronJobCreationInput(
  input: AssistantCronJobCreationBaseInput,
): Promise<{
  enabled: boolean
  keepAfterRun: boolean
  name: string
  nextRunAt: string | null
  now: Date
  paths: AssistantStatePaths
  prompt: string
  schedule: AssistantCronSchedule
  vault: string
}> {
  const now = input.now ?? new Date()
  const name = normalizeRequiredAssistantCronText(input.name, 'name')
  const prompt = normalizeRequiredAssistantCronText(input.prompt, 'prompt')
  const enabled = input.enabled ?? true
  const resolvedSchedule = await resolveAssistantCronScheduleForVault(
    input.vault,
    input.schedule,
  )
  const schedule = assistantCronScheduleSchema.parse(input.schedule)
  const keepAfterRun =
    schedule.kind === 'at'
      ? input.keepAfterRun ?? false
      : true
  const nextRunAt = computeAssistantCronNextRunAt(resolvedSchedule, now)

  if (enabled && nextRunAt === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a future run time.',
    )
  }

  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(paths)

  return {
    vault: input.vault,
    paths,
    now,
    name,
    prompt,
    enabled,
    schedule,
    keepAfterRun,
    nextRunAt,
  }
}

function requireCanonicalAutomationCronRecord(
  record: Parameters<typeof requireCanonicalAssistantCronRecord>[0],
  timeZone: string,
): CanonicalAutomationAssistantCronJobRecord {
  const source = requireCanonicalAssistantCronRecord(record, timeZone)
  if (source.kind !== 'automation') {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_AUTOMATION',
      `Canonical automation "${record.automationId}" did not resolve to an automation cron record.`,
    )
  }

  return source
}

async function resolveAssistantCronScheduleForVault(
  vault: string,
  schedule: AssistantCronScheduleInput,
): Promise<
  | AssistantCronSchedule
  | ({ kind: 'cron'; expression: string; timeZone: string })
  | ({ kind: 'dailyLocal'; localTime: string; timeZone: string })
> {
  const publicSchedule = assistantCronScheduleSchema.parse(schedule)
  if (publicSchedule.kind === 'cron' || publicSchedule.kind === 'dailyLocal') {
    return resolveAssistantCronResolvedSchedule({
      schedule: publicSchedule,
      timeZone: await resolveAssistantCronDefaultTimeZone(vault),
    })
  }

  return publicSchedule
}
