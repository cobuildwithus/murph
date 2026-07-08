import { createHash } from 'node:crypto'

import {
  experimentFrontmatterSchema,
  formatTimeZoneDateTimeParts,
  isValidIanaTimeZone,
  type ExperimentFrontmatter,
} from '@murphai/contracts'
import { isVaultError, loadVault, patchAutomation } from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'

import { listAssistantExperimentFrontmatter } from './active-experiment-context.js'
import type { MurphManagedAutomationSeed } from './managed-automations.js'

/**
 * Per-experiment managed-automation seeds.
 *
 * Each eligible active run gets two bounded lifecycle moments: an early visual
 * progress check after three complete intervention days, and a final review the
 * morning after the intervention ends. The existing managed-automation installer
 * owns route selection, idempotency, and stale one-shot suppression.
 */

export interface BuildExperimentLifecycleSeedsInput {
  vaultRoot: string
  now?: Date
}

const FIRST_PROGRESS_DAY = 4
const LIFECYCLE_FIRE_HOUR_LOCAL = 9
const PROGRESS_MILESTONE_TAGS = ['experiment', 'progress-card', 'milestone'] as const
const FINAL_RESULTS_TAGS = ['experiment', 'final-results', 'progress-card'] as const
const AUTOMATION_ID_PREFIX = 'automation_'
const EXPERIMENT_ID_PREFIX = 'exp_'
const ACTIVITY_NUDGE_AUTOMATION_SLUG_PREFIX = 'experiment-activity-nudge-'

export async function buildExperimentLifecycleSeeds(
  input: BuildExperimentLifecycleSeedsInput,
): Promise<MurphManagedAutomationSeed[]> {
  let experiments: ExperimentFrontmatter[]
  try {
    experiments = await listAssistantExperimentFrontmatter(input.vaultRoot)
  } catch {
    // Best-effort: a vault read problem must not block global managed
    // automations from being seeded.
    return []
  }

  const vaultTimeZone = await resolveVaultTimeZone(input.vaultRoot)

  return experiments.flatMap((experiment) =>
    buildExperimentSeeds(experiment, vaultTimeZone),
  )
}

async function resolveVaultTimeZone(vaultRoot: string): Promise<string> {
  return (await resolveVaultTimeZoneOrNull(vaultRoot)) ?? 'UTC'
}

async function resolveVaultTimeZoneOrNull(vaultRoot: string): Promise<string | null> {
  try {
    const { metadata } = await loadVault({ vaultRoot })
    if (isValidIanaTimeZone(metadata.timezone)) {
      return metadata.timezone
    }
  } catch {
    // Best-effort: the caller decides whether UTC fallback is appropriate.
  }
  return null
}

/** Kept for the existing managed-automations call site. */
export function buildExperimentFinalResultsSeeds(
  input: BuildExperimentLifecycleSeedsInput,
): Promise<MurphManagedAutomationSeed[]> {
  return buildExperimentLifecycleSeeds(input)
}

function buildExperimentSeeds(
  experiment: ExperimentFrontmatter,
  vaultTimeZone: string,
): MurphManagedAutomationSeed[] {
  if (experiment.status !== 'active') {
    return []
  }

  const timeZone = resolveExperimentTimeZone(experiment, vaultTimeZone)
  return [
    buildProgressMilestoneSeed(experiment, timeZone),
    buildFinalResultsSeed(experiment, timeZone),
  ].filter((seed): seed is MurphManagedAutomationSeed => seed !== null)
}

function resolveExperimentTimeZone(
  experiment: ExperimentFrontmatter,
  vaultTimeZone: string,
): string {
  const runTimeZone = experiment.runPlan?.schedule?.timeZone
  if (runTimeZone && isValidIanaTimeZone(runTimeZone)) {
    return runTimeZone
  }
  return vaultTimeZone
}

function buildProgressMilestoneSeed(
  experiment: ExperimentFrontmatter,
  timeZone: string,
): MurphManagedAutomationSeed | null {
  const interventionStart = experiment.runPlan?.interventionStart
  const interventionEnd = experiment.runPlan?.interventionEnd
  if (!interventionStart || !interventionEnd) {
    return null
  }

  const milestoneDate = addDaysToIsoDate(interventionStart, FIRST_PROGRESS_DAY - 1)
  if (milestoneDate > interventionEnd) {
    return null
  }

  return {
    automationId: experimentProgressAutomationId(experiment.experimentId),
    slug: `experiment-progress-${experiment.slug}-day-${FIRST_PROGRESS_DAY}`,
    title: `First progress · ${experiment.title}`,
    summary: 'A visual progress check after three completed intervention days.',
    schedule: { kind: 'at', at: lifecycleFireTimestamp(milestoneDate, timeZone) },
    continuityPolicy: 'fresh',
    tags: [...PROGRESS_MILESTONE_TAGS],
    instructions: buildProgressMilestoneInstructions(experiment, milestoneDate),
  }
}

function buildProgressMilestoneInstructions(
  experiment: ExperimentFrontmatter,
  milestoneDate: string,
): string {
  const slug = experiment.slug
  return [
    `Goal: give the user an encouraging first progress moment for the experiment "${experiment.title}" (${slug}) after three completed intervention days.`,
    // Pin --as-of to the milestone local date so the report and card
    // describe day four even when 09:00 local falls on the previous UTC
    // calendar day for eastern time zones.
    `Read \`vault-cli experiment show ${slug} --format json\` and \`vault-cli experiment progress ${slug} --as-of ${milestoneDate} --format json\` first.`,
    'Skip when the run is no longer active, intervention day four has not arrived, the current intervention window no longer spans four days, this milestone was already shared, or saved assistant support opts out of scheduled summaries.',
    `Otherwise build \`vault-cli experiment progress-card ${slug} --as-of ${milestoneDate} --format json\` and attach its returned \`url\` with \`murph.attach_response_media\`.`,
    'Lead with what the user completed. Mention at most two metric changes as early signals, with plain uncertainty.',
    'Sparse or unchanged metric data is not a reason to skip: show the adherence card and say the trend needs more time.',
    'Keep it warm, brief, and grounded. Avoid causal claims, score worship, or compliance language.',
  ].join('\n')
}

function buildFinalResultsSeed(
  experiment: ExperimentFrontmatter,
  timeZone: string,
): MurphManagedAutomationSeed | null {
  const interventionEnd = experiment.runPlan?.interventionEnd
  if (!interventionEnd) {
    return null
  }

  return {
    // Preserve the original final-results id so existing seeds update in place.
    automationId: experimentFinalResultsAutomationId(experiment.experimentId),
    slug: `experiment-final-results-${experiment.slug}`,
    title: `Final results · ${experiment.title}`,
    summary: 'A celebratory final review after the experiment finishes.',
    schedule: {
      kind: 'at',
      at: lifecycleFireTimestamp(addDaysToIsoDate(interventionEnd, 1), timeZone),
    },
    continuityPolicy: 'fresh',
    tags: [...FINAL_RESULTS_TAGS],
    instructions: buildFinalResultsInstructions(experiment, interventionEnd),
  }
}

function buildFinalResultsInstructions(
  experiment: ExperimentFrontmatter,
  interventionEndDate: string,
): string {
  const slug = experiment.slug
  return [
    `Goal: make finishing the experiment "${experiment.title}" (${slug}) feel complete, useful, and worth celebrating.`,
    `Read \`vault-cli experiment show ${slug} --format json\` first. Skip when the run ended early, is no longer eligible for review, its final review was already shared, or saved assistant support opts out of scheduled summaries.`,
    `The deterministic outcome was persisted by the cron precondition before this turn — do not attempt to write it yourself. Reference the saved outcome record when composing the review.`,
    `Archive the experiment's activity nudge automation if it exists: run \`vault-cli automation set-status experiment-activity-nudge-${slug} --status archived\` and ignore errors if it does not exist.`,
    // Pin --as-of to the run's intervention end so the card matches the
    // outcome the precondition just persisted (and stays stable across cron
    // retries that may cross a UTC midnight boundary).
    `Build \`vault-cli experiment progress-card ${slug} --as-of ${interventionEndDate} --format json\` and attach its returned \`url\` with \`murph.attach_response_media\`.`,
    'Open with direct congratulations for completing the experiment. Celebrate the follow-through, not whether a biomarker went up or down.',
    'Summarize adherence, the primary result, confidence and confounders in plain language, then ask one lightweight next-decision question: repeat it, adapt it, or leave it alone?',
    'An inconclusive or sparse result is still a result. Do not suppress the completion moment; explain what was learned and what remains uncertain.',
    'Use associated-with or early-signal language rather than causal certainty.',
    'The card plus warm text is the primary experience. If the card cannot be attached, a short celebratory voice memo may replace it when that tool is available; do not try to combine both media types.',
  ].join('\n')
}

export type ExperimentLifecyclePreconditionResult =
  | { kind: 'continue' }
  | { kind: 'skip'; reason: string }

/**
 * Single deterministic fire-time gate for experiment final-results cron jobs.
 *
 * Reads canonical experiment state once through the authoritative single-
 * entity query (NOT the bounded prompt-context scanner — that scanner caps
 * at 200 matches and silently drops unreadable files, both of which would
 * make a real run look absent and consume the one-shot). When the run is
 * no longer eligible for a final review (status, early stop, opt-out)
 * returns `skip` so the cron consumes the at-occurrence as skipped — no
 * outcome write, no LLM invocation, no retry. When the run is eligible,
 * persists the deterministic outcome before the LLM notification turn so a
 * transient storage failure throws (→ retryable cron failure) rather than
 * being swallowed by an LLM skip that would consume the one-shot.
 *
 * Persistence is pinned to runPlan.interventionEnd as `asOf` so the
 * outcome's ID and filename are stable across cron retries that may cross a
 * UTC midnight boundary.
 *
 * Returns `continue` for non-final-results automations so the caller can run
 * its normal notification flow unchanged.
 *
 * Routing is keyed on the immutable automation ID, not the mutable slug, so
 * a user-edited slug cannot silently bypass persistence. The seed builder
 * mints final-results automation IDs by stripping the `exp_` prefix from the
 * experiment ID, so the reverse mapping uniquely identifies the experiment.
 */
export async function runExperimentLifecycleOutcomePrecondition(input: {
  automationId: string
  now?: Date | string
  tags: readonly string[]
  vault: string
}): Promise<ExperimentLifecyclePreconditionResult> {
  if (!isExperimentFinalResultsAutomation(input.tags)) {
    return { kind: 'continue' }
  }
  const experimentLookup = experimentLookupForFinalResultsAutomationId(
    input.automationId,
  )
  if (!experimentLookup) {
    return { kind: 'continue' }
  }

  const services = createIntegratedVaultServices()

  let experiment: ExperimentFrontmatter
  try {
    const shown = await services.query.showExperiment({
      vault: input.vault,
      lookup: experimentLookup,
      requestId: null,
    })
    const data = shown.entity.data as Record<string, unknown>
    // The query layer denormalizes a few non-frontmatter fields onto data;
    // strip them before validating, matching the CLI's read pattern.
    const { experimentSlug, relatedIds, ...frontmatterAttributes } = data
    void experimentSlug
    void relatedIds
    experiment = experimentFrontmatterSchema.parse(frontmatterAttributes)
  } catch (error) {
    // A genuine absence (the run was deleted) is a real skip. Read, parse,
    // and other I/O failures must propagate so cron records the run as
    // failed and retries — the one-shot must not be consumed when the
    // current view of the vault is unreliable.
    if (error instanceof VaultCliError && error.code === 'not_found') {
      return { kind: 'skip', reason: 'experiment no longer present in the vault' }
    }
    throw error
  }

  const archiveActivityNudge = async (): Promise<void> => {
    await archiveExperimentActivityNudgeAutomation({
      experimentSlug: experiment.slug,
      vaultRoot: input.vault,
    })
  }

  if (experiment.status !== 'active' && experiment.status !== 'completed') {
    await archiveActivityNudge()
    return {
      kind: 'skip',
      reason: `experiment status is ${experiment.status}; final review not eligible`,
    }
  }

  const interventionEnd = experiment.runPlan?.interventionEnd
  if (!interventionEnd) {
    return { kind: 'skip', reason: 'experiment has no intervention end date' }
  }

  if (experiment.status === 'active') {
    const currentLocalDate = await currentExperimentLocalIsoDate({
      experiment,
      now: input.now,
      vaultRoot: input.vault,
    })
    if (currentLocalDate !== null && currentLocalDate <= interventionEnd) {
      return { kind: 'skip', reason: 'experiment is still running' }
    }
  }

  if (experiment.endedOn && experiment.endedOn < interventionEnd) {
    await archiveActivityNudge()
    return {
      kind: 'skip',
      reason: 'experiment was stopped before its intervention end',
    }
  }

  if (experiment.assistantSupport?.notificationStyle === 'skip_by_default') {
    await archiveActivityNudge()
    return {
      kind: 'skip',
      reason: 'assistant support opts out of scheduled summaries',
    }
  }

  await services.core.writeExperimentOutcome({
    vault: input.vault,
    lookup: experimentLookup,
    asOf: interventionEnd,
    requestId: null,
  })
  await archiveActivityNudge()

  return { kind: 'continue' }
}

async function currentExperimentLocalIsoDate(input: {
  experiment: ExperimentFrontmatter
  now: Date | string | undefined
  vaultRoot: string
}): Promise<string | null> {
  const date = currentInstant(input.now)
  const timeZone = await resolveExperimentPreconditionTimeZone(
    input.experiment,
    input.vaultRoot,
  )
  if (!timeZone) {
    return null
  }
  return formatTimeZoneDateTimeParts(date, timeZone).dayKey
}

async function resolveExperimentPreconditionTimeZone(
  experiment: ExperimentFrontmatter,
  vaultRoot: string,
): Promise<string | null> {
  const runTimeZone = experiment.runPlan?.schedule?.timeZone
  if (runTimeZone && isValidIanaTimeZone(runTimeZone)) {
    return runTimeZone
  }
  const vaultTimeZone = await resolveVaultTimeZoneOrNull(vaultRoot)
  if (!vaultTimeZone) {
    return null
  }
  return resolveExperimentTimeZone(experiment, vaultTimeZone)
}

function currentInstant(now: Date | string | undefined): Date {
  const date = now instanceof Date ? now : new Date(now ?? Date.now())
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Experiment lifecycle precondition received an invalid current date.')
  }
  return date
}

async function archiveExperimentActivityNudgeAutomation(input: {
  experimentSlug: string
  vaultRoot: string
}): Promise<void> {
  try {
    await patchAutomation({
      lookup: `${ACTIVITY_NUDGE_AUTOMATION_SLUG_PREFIX}${input.experimentSlug}`,
      status: 'archived',
      vaultRoot: input.vaultRoot,
    })
  } catch (error) {
    if (isVaultError(error) && error.code === 'VAULT_AUTOMATION_MISSING') {
      return
    }
    // Deliberate best-effort cleanup: final-results delivery outranks nudge
    // cleanup, and the prompt plus nudge self-archive remain later backstops.
    void error
  }
}

function isExperimentFinalResultsAutomation(tags: readonly string[]): boolean {
  return tags.includes('experiment') && tags.includes('final-results')
}

function experimentLookupForFinalResultsAutomationId(
  automationId: string,
): string | null {
  if (!automationId.startsWith(AUTOMATION_ID_PREFIX)) {
    return null
  }
  const body = automationId.slice(AUTOMATION_ID_PREFIX.length)
  if (body.length === 0) {
    return null
  }
  return `${EXPERIMENT_ID_PREFIX}${body}`
}

function experimentProgressAutomationId(experimentId: string): string {
  const body = createHash('sha256')
    .update(`experiment-progress-day-${FIRST_PROGRESS_DAY}:${experimentId}`)
    .digest('hex')
    .slice(0, 26)
    .toUpperCase()
  return `automation_${body}`
}

/**
 * Preserve the original final-results automation id for existing runs.
 *
 * The mapping is invertible: stripping `automation_` and prepending `exp_`
 * recovers the original experiment id. The precondition relies on that
 * invariant, so the two prefixes must stay paired (see
 * experimentLookupForFinalResultsAutomationId).
 */
function experimentFinalResultsAutomationId(experimentId: string): string {
  return `${AUTOMATION_ID_PREFIX}${experimentId.replace(/^exp_/u, '')}`
}

function lifecycleFireTimestamp(localDate: string, timeZone: string): string {
  return resolveLocalMorningInstant(
    localDate,
    LIFECYCLE_FIRE_HOUR_LOCAL,
    timeZone,
  )
}

/**
 * Resolve the UTC instant that displays as `${date} ${hour}:00:00` in the
 * supplied IANA time zone. Iterates against the existing time-zone formatter
 * so DST transitions and non-hour-aligned offsets converge without bespoke
 * offset math.
 */
function resolveLocalMorningInstant(
  date: string,
  hour: number,
  timeZone: string,
): string {
  const desiredYear = Number(date.slice(0, 4))
  const desiredMonth = Number(date.slice(5, 7))
  const desiredDay = Number(date.slice(8, 10))
  const desiredEpoch = Date.UTC(desiredYear, desiredMonth - 1, desiredDay, hour, 0, 0, 0)
  let candidate = new Date(desiredEpoch)
  // Two passes resolve any stable offset; four absorb a DST transition window.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatTimeZoneDateTimeParts(candidate, timeZone)
    if (parts.dayKey === date && parts.hour === hour && parts.minute === 0) {
      return candidate.toISOString()
    }
    const observedEpoch = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    )
    candidate = new Date(candidate.getTime() + (desiredEpoch - observedEpoch))
  }
  return candidate.toISOString()
}

function addDaysToIsoDate(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00.000Z`)
  stamp.setUTCDate(stamp.getUTCDate() + days)
  return stamp.toISOString().slice(0, 10)
}
