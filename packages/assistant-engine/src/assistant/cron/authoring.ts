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
import {
  computeAssistantCronFirstRunAfterCurrentLocalDay,
  computeAssistantCronNextRunAt,
} from './schedule.js'
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
  buildCanonicalAutomationRoute,
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
  activeUntil?: string | null
  deferUpdateWhileDeliveryPending?: boolean
  firstOccurrenceAt?: string
  firstOccurrenceActiveDayCount?: number
  firstOccurrenceActiveUntilLocalTime?: string
  firstOccurrencePolicy?:
    | 'after-current-local-day'
    | 'once-after-current-local-day'
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

    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
    )
    const existingRuntimeState = existingAutomation
      ? findAssistantCronCanonicalRuntimeRecord(
          runtimeStore,
          existingAutomation.automationId,
        )
      : null
    // A queued intent carries the source revision that authorized its payload.
    // Keep that revision in place until the existing outbox owner settles the
    // intent, so reconciliation cannot erase the occurrence by changing the
    // identity that delivery finalization observes.
    if (
      input.deferUpdateWhileDeliveryPending === true &&
      existingRuntimeState?.state.pendingDeliveryIntentId
    ) {
      return null
    }
    const requestedFirstOccurrenceAt = input.firstOccurrenceAt === undefined
      ? null
      : normalizeFirstOccurrenceAt(input.firstOccurrenceAt)
    const firstOccurrenceAt = input.firstOccurrencePolicy === undefined
      ? null
      : existingAutomation?.schedule.kind === 'at'
        ? existingAutomation.schedule.at
        : existingRuntimeState?.state.pendingOccurrenceAt ??
          requestedFirstOccurrenceAt ??
          resolveFirstOccurrenceAfterCurrentLocalDay({
            now: resolvedCreation.now,
            schedule: resolvedCreation.resolvedSchedule,
          })
    const materializeOneShot =
      input.firstOccurrencePolicy === 'once-after-current-local-day'
    const recurringFirstOccurrenceNeedsBinding =
      input.firstOccurrencePolicy === 'after-current-local-day' &&
      (
        existingAutomation?.schedule.kind === 'at' ||
        existingRuntimeState === null
      )
    const deferredSchedule = firstOccurrenceAt === null
      ? null
      : {
          kind: 'at' as const,
          at: firstOccurrenceAt,
        }
    const bindRecurringFirstOccurrence =
      recurringFirstOccurrenceNeedsBinding && deferredSchedule !== null
    const desiredSchedule = materializeOneShot && deferredSchedule
      ? deferredSchedule
      : resolvedCreation.schedule
    // Until the canonical runtime cursor durably owns the first occurrence,
    // keep a recurring seed as the finite one-shot it is replacing. A failed
    // runtime-state write can therefore under-send, but it cannot expose the
    // recurring source early on the current local day.
    const initialSchedule = bindRecurringFirstOccurrence
      ? deferredSchedule
      : desiredSchedule
    const activeWindowFirstOccurrenceAt =
      requestedFirstOccurrenceAt ?? firstOccurrenceAt
    const activeUntil =
      input.activeUntil === undefined &&
      input.firstOccurrencePolicy !== undefined &&
      input.firstOccurrenceActiveUntilLocalTime !== undefined &&
      activeWindowFirstOccurrenceAt !== null
        ? typeof existingAutomation?.activeUntil === 'string'
          ? existingAutomation.activeUntil
          : resolveFirstOccurrenceActiveUntil({
              activeDayCount: input.firstOccurrenceActiveDayCount ?? 1,
              activeUntilLocalTime: input.firstOccurrenceActiveUntilLocalTime,
              now: resolvedCreation.now,
              occurrenceSchedule: {
                kind: 'at',
                at: activeWindowFirstOccurrenceAt,
              },
              resolvedSchedule: resolvedCreation.resolvedSchedule,
            })
        : input.activeUntil

    let created = await upsertAutomation(
      buildCanonicalAutomationUpsertInput({
        activeUntil,
        vault: resolvedCreation.vault,
        automationId: existingAutomation?.automationId,
        automation: existingAutomation,
        title: resolvedCreation.name,
        status,
        schedule: initialSchedule,
        route: buildCanonicalAutomationRoute(target),
        instructions: resolvedCreation.prompt,
        slug: input.slug,
        summary: input.summary ?? null,
        tags: input.tags,
      }),
    )
    const timeZone = await resolveAssistantCronDefaultTimeZone(resolvedCreation.vault)
    let source = requireCanonicalAutomationCronRecord(
      created.record,
      timeZone,
    )
    if (existingRuntimeState && !bindRecurringFirstOccurrence) {
      return projectCanonicalAssistantCronJob({
        source,
        runtimeState: existingRuntimeState,
      })
    }

    const runtimeState = existingRuntimeState ??
      createAssistantCronCanonicalRuntimeRecord({
        jobId: source.automationId,
        now: resolvedCreation.now.toISOString(),
      })

    const persistedRuntimeState =
      !bindRecurringFirstOccurrence
        ? runtimeState
        : {
            ...runtimeState,
            updatedAt: resolvedCreation.now.toISOString(),
            state: {
              ...runtimeState.state,
              pendingOccurrenceAt: deferredSchedule.at,
            },
          }

    upsertAssistantCronCanonicalRuntimeRecord(runtimeStore, persistedRuntimeState)
    await writeAssistantCronCanonicalRuntimeStore(
      resolvedCreation.paths,
      runtimeStore,
    )

    if (bindRecurringFirstOccurrence) {
      created = await upsertAutomation(
        buildCanonicalAutomationUpsertInput({
          activeUntil,
          vault: resolvedCreation.vault,
          automationId: source.automationId,
          automation: created.record,
          title: resolvedCreation.name,
          status,
          schedule: desiredSchedule,
          route: buildCanonicalAutomationRoute(target),
          instructions: resolvedCreation.prompt,
          slug: input.slug,
          summary: input.summary ?? null,
          tags: input.tags,
        }),
      )
      source = requireCanonicalAutomationCronRecord(created.record, timeZone)
    }

    return projectCanonicalAssistantCronJob({
      source,
      runtimeState: persistedRuntimeState,
    })
  })
}

function normalizeFirstOccurrenceAt(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'First-occurrence deferral requires a valid timestamp.',
    )
  }
  return parsed.toISOString()
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

  return computeAssistantCronFirstRunAfterCurrentLocalDay({
    after: input.now,
    schedule: {
      kind: 'dailyLocal',
      localTime: schedule.localTime,
      timeZone,
    },
  })
}

function resolveFirstOccurrenceActiveUntil(input: {
  activeDayCount: number
  activeUntilLocalTime: string
  now: Date
  occurrenceSchedule: AssistantCronSchedule
  resolvedSchedule:
    | AssistantCronSchedule
    | ({ kind: 'cron'; expression: string; timeZone: string })
    | ({ kind: 'dailyLocal'; localTime: string; timeZone: string })
}): string {
  const timeZone =
    input.resolvedSchedule.kind === 'dailyLocal'
      ? input.resolvedSchedule.timeZone
      : undefined
  if (timeZone === undefined) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'A finite local cutoff requires a daily-local occurrence.',
    )
  }
  if (
    !Number.isSafeInteger(input.activeDayCount) ||
    input.activeDayCount <= 0
  ) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'A finite local cutoff requires at least one active local day.',
    )
  }
  const firstOccurrenceAt =
    input.occurrenceSchedule.kind === 'at'
      ? input.occurrenceSchedule.at
      : resolveFirstOccurrenceAfterCurrentLocalDay({
          now: input.now,
          schedule: input.resolvedSchedule,
        })
  const cutoffSchedule = {
    kind: 'dailyLocal' as const,
    localTime: input.activeUntilLocalTime,
    timeZone,
  }
  let activeUntilAnchor = firstOccurrenceAt
  let activeUntil: string | null = null
  for (let day = 0; day < input.activeDayCount; day += 1) {
    activeUntil = computeAssistantCronNextRunAt(
      cutoffSchedule,
      new Date(activeUntilAnchor),
    )
    if (!activeUntil) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_SCHEDULE',
        'The finite local cutoff does not produce a future boundary.',
      )
    }
    activeUntilAnchor = activeUntil
  }
  if (activeUntil === null) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The finite local cutoff requires at least one active day.',
    )
  }

  const occurrenceDay = formatTimeZoneDateTimeParts(
    firstOccurrenceAt,
    timeZone,
  ).dayKey
  const firstCutoff = computeAssistantCronNextRunAt(
    cutoffSchedule,
    new Date(firstOccurrenceAt),
  )
  const firstCutoffDay = firstCutoff
    ? formatTimeZoneDateTimeParts(
        firstCutoff,
        timeZone,
      ).dayKey
    : null
  if (firstCutoffDay !== occurrenceDay) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The first local cutoff must fall after the first occurrence on the same local day.',
    )
  }
  const activeUntilDay = formatTimeZoneDateTimeParts(
    activeUntil,
    timeZone,
  ).dayKey
  if (activeUntilDay < occurrenceDay) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The finite local cutoff must not precede its first occurrence.',
    )
  }

  return activeUntil
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
