import { upsertAutomation } from '@murphai/core'
import {
  formatTimeZoneDateTimeParts,
  type AutomationRoute,
} from '@murphai/contracts'
import { showAutomation as showCanonicalAutomation } from '@murphai/query'
import {
  assistantCronScheduleSchema,
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronSchedule,
  type AssistantCronScheduleInput,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeNullableString } from '../shared.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from '../store/paths.js'
import {
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
  findAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { computeAssistantCronNextRunAt } from './schedule.js'
import {
  assertAssistantCronJobNameIsAvailable,
  buildAssistantCronTarget,
  ensureAssistantCronState,
  normalizeRequiredAssistantCronText,
  readAssistantCronStore,
  type AssistantCronTargetInput,
} from './store.js'
import {
  assistantCronTargetAudienceEquals,
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
  resolveTargetDefaults?: boolean
}

export interface UpsertAssistantCronAutomationInput {
  firstOccurrencePolicy?: 'after-current-local-day'
  instructions: string
  now?: Date
  route: AutomationRoute
  schedule: AssistantCronScheduleInput
  slug: string
  summary?: string | null
  tags?: string[]
  title: string
  vault: string
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
  const resolvedInput =
    input.resolveTargetDefaults === false
      ? input
      : await resolveAssistantCronTargetDefaults(input)
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

export async function upsertAssistantCronAutomation(
  input: UpsertAssistantCronAutomationInput,
): Promise<AssistantCronJob | null> {
  const lockPaths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantCronState(lockPaths)

  return withAssistantCronWriteLock(lockPaths, async () => {
    const existingAutomation = await showCanonicalAutomation(input.vault, input.slug)
    const existingStatus = existingAutomation?.status ?? null
    if (existingStatus === 'archived') {
      return null
    }

    const status = existingStatus === 'paused' ? 'paused' : 'active'
    const resolvedCreation = await resolveAssistantCronJobCreationInput({
      enabled: status === 'active',
      name: input.title,
      now: input.now,
      prompt: input.instructions,
      schedule: input.schedule,
      vault: input.vault,
    })
    const target = validateAssistantCronDeliveryTarget(input.route)
    const localStore = await readAssistantCronStore(resolvedCreation.paths)
    assertAssistantCronJobNameIsAvailable(localStore, resolvedCreation.name)

    if (
      existingAutomation &&
      !assistantCronTargetAudienceEquals(existingAutomation.route, target)
    ) {
      return null
    }

    const created = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        vault: resolvedCreation.vault,
        automationId: existingAutomation?.automationId,
        automation: existingAutomation,
        title: resolvedCreation.name,
        status,
        schedule: resolvedCreation.schedule,
        route: buildCanonicalAutomationRoute(target),
        instructions: resolvedCreation.prompt,
        slug: input.slug,
        summary: input.summary ?? null,
        tags: input.tags,
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
    const existingRuntimeState = findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      source.automationId,
    )
    if (existingRuntimeState) {
      return projectCanonicalAssistantCronJob({
        source,
        runtimeState: existingRuntimeState,
      })
    }

    const runtimeState = createAssistantCronCanonicalRuntimeRecord({
      jobId: source.automationId,
      now: resolvedCreation.now.toISOString(),
    })

    const persistedRuntimeState =
      input.firstOccurrencePolicy !== 'after-current-local-day'
        ? runtimeState
        : {
            ...runtimeState,
            state: {
              ...runtimeState.state,
              pendingOccurrenceAt: resolveFirstOccurrenceAfterCurrentLocalDay({
                now: resolvedCreation.now,
                schedule: resolvedCreation.resolvedSchedule,
              }),
            },
          }

    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, persistedRuntimeState)
    // No rollback on write failure: a canonical automation without a runtime
    // record self-heals (readers synthesize initial state) and re-seeding is
    // idempotent, so the worst case is losing the first-occurrence deferral.
    await writeAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
      runtimeStore,
    )

    return projectCanonicalAssistantCronJob({
      source,
      runtimeState: persistedRuntimeState,
    })
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
  resolvedSchedule:
    | AssistantCronSchedule
    | ({ kind: 'cron'; expression: string; timeZone: string })
    | ({ kind: 'dailyLocal'; localTime: string; timeZone: string })
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
    resolvedSchedule,
    schedule,
    keepAfterRun,
    nextRunAt,
  }
}

function resolveFirstOccurrenceAfterCurrentLocalDay(input: {
  now: Date
  schedule:
    | AssistantCronSchedule
    | ({ kind: 'cron'; expression: string; timeZone: string })
    | ({ kind: 'dailyLocal'; localTime: string; timeZone: string })
}): string {
  const schedule = input.schedule
  if (schedule.kind !== 'dailyLocal') {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'First-occurrence local-day deferral requires a daily-local schedule.',
    )
  }

  const timeZone = 'timeZone' in schedule ? schedule.timeZone : null
  if (!timeZone) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'First-occurrence local-day deferral requires a resolved time zone.',
    )
  }

  const first = computeAssistantCronNextRunAt(schedule, input.now)
  if (!first) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a future run time.',
    )
  }

  const nowDayKey = formatTimeZoneDateTimeParts(
    input.now,
    timeZone,
  ).dayKey
  const firstDayKey = formatTimeZoneDateTimeParts(
    first,
    timeZone,
  ).dayKey
  if (firstDayKey !== nowDayKey) {
    return first
  }

  const next = computeAssistantCronNextRunAt(schedule, new Date(first))
  if (!next) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The assistant cron schedule does not produce a deferred future run time.',
    )
  }

  return next
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
