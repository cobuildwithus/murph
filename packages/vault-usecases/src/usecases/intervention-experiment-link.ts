import {
  experimentFrontmatterSchema,
  safeParseContract,
  toLocalDayKey,
  type ExperimentFrontmatter,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { JsonObject } from '../health-cli-method-types.js'
import {
  loadQueryRuntime,
  type QueryCanonicalEntity,
  type QueryVaultReadModel,
} from '../query-runtime.js'
import { editEventRecord } from './event-record-mutations.js'
import { showEventRecord } from './provider-event.js'
import { normalizeOptionalText } from './vault-usecase-helpers.js'

export interface InterventionExperimentLinkTarget {
  experimentId: string
  experimentSlug: string
}

export interface InterventionExperimentLinkResult
  extends InterventionExperimentLinkTarget {
  mode: 'auto' | 'explicit'
}

export interface ExperimentCandidate extends InterventionExperimentLinkTarget {
  entity: QueryCanonicalEntity
  frontmatter: ExperimentFrontmatter
}

type CanonicalLink = JsonObject & {
  type: string
  targetId: string
}

interface ResolveInterventionExperimentLinkInput {
  vault: string
  interventionType: string
  occurredAt: string
  experiment?: string
  noExperiment?: boolean
  allowOutOfWindow?: boolean
}

export async function resolveInterventionExperimentLink(
  input: ResolveInterventionExperimentLinkInput,
): Promise<InterventionExperimentLinkResult | null> {
  if (input.noExperiment === true) {
    if (input.experiment !== undefined) {
      throw new VaultCliError(
        'invalid_option',
        'Use either --experiment or --skip-experiment-link, not both.',
      )
    }

    if (input.allowOutOfWindow === true) {
      throw new VaultCliError(
        'invalid_option',
        'Use either --allow-out-of-window or --skip-experiment-link, not both.',
      )
    }

    return null
  }

  if (input.allowOutOfWindow === true && input.experiment === undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--allow-out-of-window only applies with --experiment <slug-or-id>.',
    )
  }

  const query = await loadQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const localDate = resolveEventLocalDate(readModel, input.occurredAt)

  if (input.experiment !== undefined) {
    const experiment = requireExperimentCandidateByLookup(
      readModel,
      input.experiment,
    )
    assertExperimentCanBeLinked({
      experiment,
      localDate,
      requireActive: false,
      allowOutOfWindow: input.allowOutOfWindow === true,
    })
    assertExperimentMatchesIntervention({
      experiment,
      interventionType: input.interventionType,
    })

    return {
      experimentId: experiment.experimentId,
      experimentSlug: experiment.experimentSlug,
      mode: 'explicit',
    }
  }

  const candidates = readModel.experiments
    .map(toExperimentCandidate)
    .filter((candidate): candidate is ExperimentCandidate => candidate !== null)
    .filter((candidate) => candidate.frontmatter.status === 'active')
    .filter((candidate) => isInInterventionWindow(candidate.frontmatter, localDate))
    .filter((candidate) =>
      experimentMatchesIntervention(candidate.frontmatter, input.interventionType),
    )

  if (candidates.length === 0) {
    return null
  }

  if (candidates.length > 1) {
    const slugs = candidates.map((candidate) => candidate.experimentSlug).join(', ')
    throw new VaultCliError(
      'invalid_option',
      `Multiple active experiments match "${input.interventionType}": ${slugs}. Pass --experiment <slug-or-id> or --skip-experiment-link.`,
      {
        candidates: candidates.map((candidate) => candidate.experimentSlug),
        interventionType: input.interventionType,
      },
    )
  }

  const [candidate] = candidates
  return {
    experimentId: candidate.experimentId,
    experimentSlug: candidate.experimentSlug,
    mode: 'auto',
  }
}

export function applyExperimentLinkToPayload<TPayload extends JsonObject>(
  payload: TPayload,
  link: InterventionExperimentLinkTarget | null,
): TPayload {
  if (link === null) {
    return payload
  }

  return {
    ...payload,
    experimentId: link.experimentId,
    experimentSlug: link.experimentSlug,
    links: replaceExperimentLink(payload['links'], link),
  }
}

export async function attachInterventionSessionToExperiment(input: {
  vault: string
  eventId: string
  experiment: string
  replace?: boolean
  allowOutOfWindow?: boolean
}) {
  const query = await loadQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const event = requireInterventionSessionEvent(readModel, input.eventId)
  const experiment = requireExperimentCandidateByLookup(readModel, input.experiment)
  const localDate = resolveExistingEventLocalDate(readModel, event)
  const interventionType = readInterventionType(event)

  assertExperimentCanBeLinked({
    experiment,
    localDate,
    requireActive: false,
    allowOutOfWindow: input.allowOutOfWindow === true,
  })
  assertExperimentMatchesIntervention({ experiment, interventionType })

  const current = readCurrentExperimentLink(event)
  if (current && !sameExperimentLink(current, experiment)) {
    if (input.replace !== true) {
      throw new VaultCliError(
        'invalid_option',
        `Intervention session ${input.eventId} is already linked to experiment ${current.experimentSlug ?? current.experimentId}. Pass --replace to relink it.`,
      )
    }
  }

  const links = replaceExperimentLink(event.links, experiment)
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.eventId,
    entityLabel: 'intervention',
    expectedKinds: ['intervention_session'],
    set: [
      `experimentId=${JSON.stringify(experiment.experimentId)}`,
      `experimentSlug=${JSON.stringify(experiment.experimentSlug)}`,
      `links=${JSON.stringify(links)}`,
    ],
  })

  return {
    ...(await showEventRecord(input.vault, result.lookupId)),
    eventId: result.eventId,
    lookupId: result.lookupId,
    experimentId: experiment.experimentId,
    experimentSlug: experiment.experimentSlug,
    linked: true as const,
  }
}

export async function detachInterventionSessionFromExperiment(input: {
  vault: string
  eventId: string
}) {
  const query = await loadQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const event = requireInterventionSessionEvent(readModel, input.eventId)
  const links = replaceExperimentLink(event.links, null)
  const hasExperimentState =
    readCurrentExperimentLink(event) !== null ||
    event.links.some((link) => link.targetId.startsWith('exp_'))

  if (!hasExperimentState) {
    return {
      ...(await showEventRecord(input.vault, input.eventId)),
      eventId: input.eventId,
      lookupId: input.eventId,
      experimentId: null,
      experimentSlug: null,
      linked: false as const,
    }
  }

  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.eventId,
    entityLabel: 'intervention',
    expectedKinds: ['intervention_session'],
    set: links.length > 0 ? [`links=${JSON.stringify(links)}`] : undefined,
    clear: links.length > 0
      ? ['experimentId', 'experimentSlug']
      : ['experimentId', 'experimentSlug', 'links'],
  })

  return {
    ...(await showEventRecord(input.vault, result.lookupId)),
    eventId: result.eventId,
    lookupId: result.lookupId,
    experimentId: null,
    experimentSlug: null,
    linked: false as const,
  }
}

export function replaceExperimentLink(
  value: unknown,
  target: InterventionExperimentLinkTarget | null,
): CanonicalLink[] {
  const links = normalizeLinks(value)
    .filter((link) => !link.targetId.startsWith('exp_'))

  if (target !== null) {
    links.push({
      type: 'related_to',
      targetId: target.experimentId,
    })
  }

  return dedupeLinks(links)
}

function requireInterventionSessionEvent(
  readModel: QueryVaultReadModel,
  eventId: string,
): QueryCanonicalEntity {
  const event = readModel.events.find((candidate) =>
    candidate.entityId === eventId ||
    candidate.primaryLookupId === eventId ||
    candidate.lookupIds.includes(eventId),
  )

  if (!event || event.kind !== 'intervention_session') {
    throw new VaultCliError(
      'not_found',
      `No intervention found for "${eventId}".`,
    )
  }

  return event
}

function readInterventionType(event: QueryCanonicalEntity): string {
  const interventionType = event.attributes.interventionType
  if (typeof interventionType === 'string' && interventionType.length > 0) {
    return interventionType
  }

  throw new VaultCliError(
    'invalid_payload',
    `Intervention session ${event.entityId} has no interventionType.`,
  )
}

function requireExperimentCandidateByLookup(
  readModel: QueryVaultReadModel,
  lookup: string,
): ExperimentCandidate {
  const experiment =
    readModel.experiments.find((candidate) => candidate.experimentSlug === lookup) ??
    readModel.experiments.find((candidate) =>
      candidate.entityId === lookup ||
      candidate.primaryLookupId === lookup ||
      candidate.lookupIds.includes(lookup),
    )
  const candidate = experiment ? toExperimentCandidate(experiment) : null

  if (!candidate) {
    throw new VaultCliError('not_found', `No experiment found for "${lookup}".`)
  }

  return candidate
}

function toExperimentCandidate(
  entity: QueryCanonicalEntity,
): ExperimentCandidate | null {
  const parsed = safeParseContract(experimentFrontmatterSchema, entity.attributes)
  if (!parsed.success) {
    return null
  }

  return {
    entity,
    frontmatter: parsed.data,
    experimentId: parsed.data.experimentId,
    experimentSlug: parsed.data.slug,
  }
}

function assertExperimentCanBeLinked(input: {
  experiment: ExperimentCandidate
  localDate: string
  requireActive: boolean
  allowOutOfWindow: boolean
}) {
  if (input.requireActive && input.experiment.frontmatter.status !== 'active') {
    throw new VaultCliError(
      'invalid_option',
      `Experiment "${input.experiment.experimentSlug}" is not active.`,
    )
  }

  if (
    !input.allowOutOfWindow &&
    !isInInterventionWindow(input.experiment.frontmatter, input.localDate)
  ) {
    throw new VaultCliError(
      'invalid_option',
      `Intervention session date ${input.localDate} is outside the intervention window for experiment "${input.experiment.experimentSlug}". Pass --allow-out-of-window to link it anyway.`,
    )
  }
}

export function assertExperimentMatchesIntervention(input: {
  experiment: ExperimentCandidate
  interventionType: string
}) {
  if (
    experimentMatchesIntervention(
      input.experiment.frontmatter,
      input.interventionType,
    )
  ) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    `Intervention type "${input.interventionType}" does not match experiment "${input.experiment.experimentSlug}". For a new capture, pass --type with a matching intervention type or choose a different experiment. For an existing session, edit the session type after detaching the experiment link, or attach a matching experiment.`,
  )
}

function sameExperimentLink(
  current: InterventionExperimentLinkTarget,
  target: InterventionExperimentLinkTarget,
): boolean {
  if (
    current.experimentId.length > 0 &&
    current.experimentId !== target.experimentId
  ) {
    return false
  }

  if (
    current.experimentSlug.length > 0 &&
    current.experimentSlug !== target.experimentSlug
  ) {
    return false
  }

  return current.experimentId === target.experimentId ||
    current.experimentSlug === target.experimentSlug
}

function isInInterventionWindow(
  frontmatter: ExperimentFrontmatter,
  localDate: string,
): boolean {
  const start = frontmatter.runPlan?.interventionStart
  const end = frontmatter.runPlan?.interventionEnd

  return typeof start === 'string' &&
    typeof end === 'string' &&
    localDate >= start &&
    localDate <= end
}

function experimentMatchesIntervention(
  frontmatter: ExperimentFrontmatter,
  interventionType: string,
): boolean {
  const interventionKeys = expandInterventionAliases(interventionType)
  const experimentKeys = [
    frontmatter.runPlan?.modality,
    frontmatter.effectiveProtocolSnapshot?.modality,
    frontmatter.commonsProtocolRef?.key,
  ].flatMap((value) =>
    typeof value === 'string' ? [...expandInterventionAliases(value)] : [],
  )

  return experimentKeys.some((key) => interventionKeys.has(key))
}

function expandInterventionAliases(value: string | null | undefined): Set<string> {
  const slug = slugifyInterventionValue(value)
  return slug ? new Set([slug]) : new Set()
}

function slugifyInterventionValue(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value ?? undefined)
  if (!normalized) {
    return null
  }

  const unprefixed = normalized.split('/').at(-1)?.split(':').at(-1) ?? normalized
  const slug = unprefixed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return slug.length > 0 ? slug : null
}

function resolveExistingEventLocalDate(
  readModel: QueryVaultReadModel,
  event: QueryCanonicalEntity,
): string {
  const date =
    typeof event.attributes.sessionLocalDate === 'string'
      ? event.attributes.sessionLocalDate
      : event.date
  if (date) {
    return date
  }

  if (!event.occurredAt) {
    throw new VaultCliError(
      'invalid_payload',
      `Intervention session ${event.entityId} has no occurredAt timestamp.`,
    )
  }

  return resolveEventLocalDate(readModel, event.occurredAt)
}

function resolveEventLocalDate(
  readModel: QueryVaultReadModel,
  occurredAt: string,
): string {
  const timeZone = typeof readModel.metadata?.timezone === 'string'
    ? readModel.metadata.timezone
    : 'UTC'

  return toLocalDayKey(occurredAt, timeZone)
}

function readCurrentExperimentLink(
  event: QueryCanonicalEntity,
): InterventionExperimentLinkTarget | null {
  const experimentLink = event.links.find((link) => link.targetId.startsWith('exp_'))
  const experimentId =
    typeof event.attributes.experimentId === 'string'
      ? event.attributes.experimentId
      : experimentLink?.targetId ?? null
  const experimentSlug =
    typeof event.attributes.experimentSlug === 'string'
      ? event.attributes.experimentSlug
      : null

  if (!experimentId && !experimentSlug) {
    return null
  }

  return {
    experimentId: experimentId ?? '',
    experimentSlug: experimentSlug ?? experimentId ?? '',
  }
}

function normalizeLinks(value: unknown): CanonicalLink[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry): CanonicalLink | null => {
      if (typeof entry !== 'object' || entry === null) {
        return null
      }

      const record = entry as Record<string, unknown>
      if (typeof record.type !== 'string' || typeof record.targetId !== 'string') {
        return null
      }

      return {
        type: record.type,
        targetId: record.targetId,
      }
    })
    .filter((entry): entry is CanonicalLink => entry !== null)
}

function dedupeLinks(links: CanonicalLink[]): CanonicalLink[] {
  const seen = new Set<string>()
  const deduped: CanonicalLink[] = []

  for (const link of links) {
    const key = `${link.type}:${link.targetId}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(link)
  }

  return deduped
}
