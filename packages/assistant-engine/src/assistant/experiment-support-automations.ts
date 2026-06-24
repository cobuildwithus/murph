import { createHash } from 'node:crypto'

import type { ExperimentFrontmatter } from '@murphai/contracts'

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
const LIFECYCLE_FIRE_HOUR_UTC = 15
const PROGRESS_MILESTONE_TAGS = ['experiment', 'progress-card', 'milestone'] as const
const FINAL_RESULTS_TAGS = ['experiment', 'final-results', 'progress-card'] as const

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

  return experiments.flatMap(buildExperimentSeeds)
}

/** Kept for the existing managed-automations call site. */
export function buildExperimentFinalResultsSeeds(
  input: BuildExperimentLifecycleSeedsInput,
): Promise<MurphManagedAutomationSeed[]> {
  return buildExperimentLifecycleSeeds(input)
}

function buildExperimentSeeds(
  experiment: ExperimentFrontmatter,
): MurphManagedAutomationSeed[] {
  if (experiment.status !== 'active') {
    return []
  }

  return [
    buildProgressMilestoneSeed(experiment),
    buildFinalResultsSeed(experiment),
  ].filter((seed): seed is MurphManagedAutomationSeed => seed !== null)
}

function buildProgressMilestoneSeed(
  experiment: ExperimentFrontmatter,
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
    schedule: { kind: 'at', at: lifecycleFireTimestamp(milestoneDate) },
    continuityPolicy: 'fresh',
    tags: [...PROGRESS_MILESTONE_TAGS],
    instructions: buildProgressMilestoneInstructions(experiment),
  }
}

function buildProgressMilestoneInstructions(experiment: ExperimentFrontmatter): string {
  const slug = experiment.slug
  return [
    `Goal: give the user an encouraging first progress moment for the experiment "${experiment.title}" (${slug}) after three completed intervention days.`,
    `Read \`vault-cli experiment show ${slug} --format json\` and \`vault-cli experiment progress ${slug} --format json\` first.`,
    'Skip only when the run is no longer active, intervention day four has not arrived, or this milestone was already shared.',
    `Otherwise build \`vault-cli experiment progress-card ${slug} --format json\` and attach its returned \`url\` with \`murph.attach_response_media\`.`,
    'Lead with what the user completed. Mention at most two metric changes as early signals, with plain uncertainty.',
    'Sparse or unchanged metric data is not a reason to skip: show the adherence card and say the trend needs more time.',
    'Keep it warm, brief, and grounded. Avoid causal claims, score worship, or compliance language.',
  ].join('\n')
}

function buildFinalResultsSeed(
  experiment: ExperimentFrontmatter,
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
      at: lifecycleFireTimestamp(addDaysToIsoDate(interventionEnd, 1)),
    },
    continuityPolicy: 'fresh',
    tags: [...FINAL_RESULTS_TAGS],
    instructions: buildFinalResultsInstructions(experiment),
  }
}

function buildFinalResultsInstructions(experiment: ExperimentFrontmatter): string {
  const slug = experiment.slug
  return [
    `Goal: make finishing the experiment "${experiment.title}" (${slug}) feel complete, useful, and worth celebrating.`,
    `Read \`vault-cli experiment show ${slug} --format json\` first. Skip only if the run ended early, is no longer eligible for review, or its final review was already shared.`,
    `Run \`vault-cli experiment outcome write ${slug} --format json\` to persist the deterministic outcome. If persistence cannot complete, use \`vault-cli experiment outcome analyze ${slug} --format json\` and still give an honest review.`,
    `Build \`vault-cli experiment progress-card ${slug} --format json\` and attach its returned \`url\` with \`murph.attach_response_media\`.`,
    'Open with direct congratulations for completing the experiment. Celebrate the follow-through, not whether a biomarker went up or down.',
    'Summarize adherence, the primary result, confidence and confounders in plain language, then ask one lightweight next-decision question: repeat it, adapt it, or leave it alone?',
    'An inconclusive or sparse result is still a result. Do not suppress the completion moment; explain what was learned and what remains uncertain.',
    'Use associated-with or early-signal language rather than causal certainty.',
    'The card plus warm text is the primary experience. If the card cannot be attached, a short celebratory voice memo may replace it when that tool is available; do not try to combine both media types.',
  ].join('\n')
}

function experimentProgressAutomationId(experimentId: string): string {
  const body = createHash('sha256')
    .update(`experiment-progress-day-${FIRST_PROGRESS_DAY}:${experimentId}`)
    .digest('hex')
    .slice(0, 26)
    .toUpperCase()
  return `automation_${body}`
}

/** Preserve the original final-results automation id for existing runs. */
function experimentFinalResultsAutomationId(experimentId: string): string {
  return `automation_${experimentId.replace(/^exp_/u, '')}`
}

function lifecycleFireTimestamp(date: string): string {
  const fireAt = new Date(`${date}T00:00:00.000Z`)
  fireAt.setUTCHours(LIFECYCLE_FIRE_HOUR_UTC, 0, 0, 0)
  return fireAt.toISOString()
}

function addDaysToIsoDate(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00.000Z`)
  stamp.setUTCDate(stamp.getUTCDate() + days)
  return stamp.toISOString().slice(0, 10)
}
