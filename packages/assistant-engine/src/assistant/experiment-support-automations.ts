import type { ExperimentFrontmatter } from '@murphai/contracts'

import { listAssistantExperimentFrontmatter } from './active-experiment-context.js'
import type { MurphManagedAutomationSeed } from './managed-automations.js'

/**
 * Per-experiment managed-automation seeds.
 *
 * The standard weekly progress digest rides the global `weekly-health-digest`
 * managed automation, so the only experiment-specific automation we seed is the
 * one-shot final-results review fired just after a run's intervention ends.
 * These are generated deterministically from active experiment records and fed
 * through the same idempotent managed-automation installer as the global seeds,
 * so the runtime sets them up with no assistant tool calls.
 */

export interface BuildExperimentFinalResultsSeedsInput {
  vaultRoot: string
  now?: Date
}

const FINAL_RESULTS_TAGS = ['experiment', 'final-results'] as const

export async function buildExperimentFinalResultsSeeds(
  input: BuildExperimentFinalResultsSeedsInput,
): Promise<MurphManagedAutomationSeed[]> {
  let experiments: ExperimentFrontmatter[]
  try {
    experiments = await listAssistantExperimentFrontmatter(input.vaultRoot)
  } catch {
    // Best-effort: a vault read problem must not block the global managed
    // automations from being seeded.
    return []
  }

  const seeds: MurphManagedAutomationSeed[] = []
  for (const experiment of experiments) {
    const seed = buildFinalResultsSeed(experiment)
    if (seed) {
      seeds.push(seed)
    }
  }
  return seeds
}

function buildFinalResultsSeed(
  experiment: ExperimentFrontmatter,
): MurphManagedAutomationSeed | null {
  if (experiment.status !== 'active') {
    return null
  }
  const interventionEnd = experiment.runPlan?.interventionEnd
  if (!interventionEnd) {
    return null
  }

  return {
    automationId: experimentFinalResultsAutomationId(experiment.experimentId),
    slug: `experiment-final-results-${experiment.slug}`,
    title: `Final results · ${experiment.title}`,
    summary: 'A one-time results review when the experiment finishes.',
    schedule: { kind: 'at', at: finalResultsFireTimestamp(interventionEnd) },
    continuityPolicy: 'fresh',
    tags: [...FINAL_RESULTS_TAGS],
    instructions: buildFinalResultsInstructions(experiment),
  }
}

function buildFinalResultsInstructions(experiment: ExperimentFrontmatter): string {
  const slug = experiment.slug
  return [
    `This is the scheduled final-results review for the experiment "${experiment.title}" (${slug}), due just after its intervention window ends.`,
    `Read \`vault-cli experiment show ${slug} --format json\` and \`vault-cli experiment outcome analyze ${slug} --format json\` first.`,
    'Skip if the run is inactive, was stopped early, or its final results were already shared.',
    'Otherwise send one concise results summary in early-signal / associated-with language (not causal certainty),',
    `attach the results image with \`vault-cli experiment progress-card ${slug} --format json\`,`,
    `and offer to save the outcome with \`vault-cli experiment outcome write ${slug} --format json\` if the user wants it kept.`,
  ].join(' ')
}

/**
 * Deterministic automation id derived from the experiment id so re-seeding the
 * same experiment updates one record instead of creating duplicates. The
 * experiment id is `exp_<ULID>`; reuse its ULID body under the automation
 * prefix (one final-results automation per experiment).
 */
function experimentFinalResultsAutomationId(experimentId: string): string {
  return `automation_${experimentId.replace(/^exp_/u, '')}`
}

/** interventionEnd (YYYY-MM-DD) → the morning after, so the last day's data has synced. */
function finalResultsFireTimestamp(interventionEnd: string): string {
  const fireAt = new Date(`${interventionEnd}T00:00:00.000Z`)
  fireAt.setUTCDate(fireAt.getUTCDate() + 1)
  fireAt.setUTCHours(15, 0, 0, 0)
  return fireAt.toISOString()
}
