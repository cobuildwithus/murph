import type { EventSource } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inferDurationMinutes,
  validateDurationMinutes,
} from './text-duration.js'
import {
  deleteEventRecord,
  editEventRecord,
} from './event-record-mutations.js'
import {
  applyExperimentLinkToPayload,
  type InterventionExperimentLinkTarget,
  replaceExperimentLink,
  resolveInterventionExperimentLink,
} from './intervention-experiment-link.js'
import {
  showEventRecord,
  upsertEventRecord,
} from './provider-event.js'
import { normalizeOptionalText } from './vault-usecase-helpers.js'

interface InterventionDescriptor {
  interventionType: string
  label: string
  patterns: readonly RegExp[]
}

const knownInterventions = [
  {
    interventionType: 'red-light-sauna',
    label: 'red light sauna',
    patterns: [
      /\bred\s*-?\s*light\s+sauna\b/iu,
      /\binfrared\s+sauna\b/iu,
    ],
  },
  {
    interventionType: 'red-light-therapy',
    label: 'red light therapy',
    patterns: [
      /\bred\s*-?\s*light\s+therapy\b/iu,
      /\bphotobiomodulation\b/iu,
      /\bpbm\b/iu,
    ],
  },
  {
    interventionType: 'hbot',
    label: 'HBOT',
    patterns: [
      /\bhbot\b/iu,
      /\bhyperbaric\s+oxygen(?:\s+therapy)?\b/iu,
    ],
  },
  {
    interventionType: 'cold-plunge',
    label: 'cold plunge',
    patterns: [
      /\bcold\s+plunge\b/iu,
      /\bice\s+bath\b/iu,
      /\bcold\s+immersion\b/iu,
    ],
  },
  {
    interventionType: 'shock-therapy',
    label: 'shock therapy',
    patterns: [
      /\bshock(?:wave)?\s+therapy\b/iu,
      /\bshockwave\b/iu,
      /\beswt\b/iu,
    ],
  },
  {
    interventionType: 'skin-laser-therapy',
    label: 'skin laser therapy',
    patterns: [
      /\bskin\s+laser(?:\s+therapy)?\b/iu,
      /\blaser\s+resurfacing\b/iu,
      /\bfraxel\b/iu,
    ],
  },
  {
    interventionType: 'bemer-electromagnetic-therapy',
    label: 'BEMER electromagnetic therapy',
    patterns: [
      /\bbemer\b/iu,
      /\bbemr\b/iu,
      /\belectromagnetic\s+therapy\b/iu,
    ],
  },
  {
    interventionType: 'sauna',
    label: 'sauna',
    patterns: [/\bsauna\b/iu],
  },
] as const satisfies readonly InterventionDescriptor[]

export interface AddInterventionRecordInput {
  vault: string
  text: string
  occurredAt?: string
  source?: EventSource
  durationMinutes?: number
  interventionType?: string
  regimenId?: string
  experiment?: string
  noExperiment?: boolean
  allowOutOfWindow?: boolean
}

export async function addInterventionRecord(
  input: AddInterventionRecordInput,
) {
  const note = normalizeOptionalText(input.text)
  if (!note) {
    throw new VaultCliError('contract_invalid', 'Intervention text is required.')
  }

  const intervention = resolveInterventionDescriptor(note, input.interventionType)
  const durationMinutes = resolveDurationMinutes(note, input.durationMinutes)
  const regimenId = normalizeOptionalText(input.regimenId)
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const experimentLink = await resolveInterventionExperimentLink({
    vault: input.vault,
    interventionType: intervention.interventionType,
    occurredAt,
    experiment: input.experiment,
    noExperiment: input.noExperiment,
    allowOutOfWindow: input.allowOutOfWindow,
  })
  const basePayload = {
    kind: 'intervention_session',
    occurredAt,
    source: input.source ?? 'manual',
    title: buildInterventionTitle(intervention.label, durationMinutes),
    interventionType: intervention.interventionType,
    ...(typeof durationMinutes === 'number' ? { durationMinutes } : {}),
    ...(regimenId
      ? {
          regimenId,
          links: [
            {
              type: 'related_to',
              targetId: regimenId,
            },
          ],
        }
      : {}),
    ...(experimentLink ? { sessionStatus: 'completed' } : {}),
    note,
  }
  const payload = applyExperimentLinkToPayload(basePayload, experimentLink)

  const result = await upsertEventRecord({
    vault: input.vault,
    payload,
  })

  return {
    ...result,
    occurredAt,
    kind: 'intervention_session' as const,
    title: String(payload.title),
    interventionType: String(payload.interventionType),
    durationMinutes: durationMinutes ?? null,
    regimenId: regimenId ?? null,
    experimentId: experimentLink?.experimentId ?? null,
    experimentSlug: experimentLink?.experimentSlug ?? null,
    experimentLinkMode: experimentLink?.mode ?? null,
    note,
  }
}

export async function editInterventionRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
  dayKeyPolicy?: 'keep' | 'recompute'
}) {
  await assertExperimentLinkedEditIsSafe(input)
  const normalizedPatch = await preserveInterventionRelationLinks(input)
  const result = await editEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'intervention',
    inputFile: input.inputFile,
    set: normalizedPatch.set,
    clear: normalizedPatch.clear,
    dayKeyPolicy: input.dayKeyPolicy,
    expectedKinds: ['intervention_session'],
  })

  return showEventRecord(input.vault, result.lookupId)
}

async function assertExperimentLinkedEditIsSafe(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
}) {
  if (!patchMayChangeExperimentRouting(input)) {
    return
  }

  const shown = await showEventRecord(input.vault, input.lookup)
  const data = shown.entity.data as Record<string, unknown>
  const currentLinks = Array.isArray(data.links) ? data.links : []
  if (!hasExperimentState(data, currentLinks)) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    'Detach the session with `vault-cli experiment session detach <eventId>` or reattach it with `vault-cli experiment session attach <experiment> <eventId> --replace` before editing intervention type or session date fields.',
  )
}

async function preserveInterventionRelationLinks(input: {
  vault: string
  lookup: string
  set?: string[]
  clear?: string[]
}) {
  const nextSet = [...(input.set ?? [])]
  const nextClear = [...(input.clear ?? [])]
  const regimenId = readPatchString(nextSet, 'regimenId')
  const clearRegimenId = nextClear.includes('regimenId')

  if (regimenId === undefined && !clearRegimenId) {
    return {
      set: input.set,
      clear: input.clear,
    }
  }

  const shown = await showEventRecord(input.vault, input.lookup)
  const data = shown.entity.data as Record<string, unknown>
  const currentLinks = Array.isArray(data.links) ? data.links : []
  const currentRegimenId =
    typeof data.regimenId === 'string' ? data.regimenId : undefined
  const links = replaceExperimentLink(
    currentLinks,
    readExperimentTarget(data, currentLinks),
  )
  const regimenLinkIds = links
    .map((link) => link.targetId)
    .filter((targetId) => targetId.startsWith('reg_'))
  const ownedRegimenId = currentRegimenId ??
    (regimenLinkIds.length === 1 ? regimenLinkIds[0] : undefined)
  if (ownedRegimenId === undefined && regimenLinkIds.length > 1) {
    throw new VaultCliError(
      'invalid_payload',
      'Intervention session has multiple regimen links but no regimenId owner. Repair the links before editing regimen state.',
    )
  }

  const regimenLinkToRemove = new Set(
    ownedRegimenId === undefined ? [] : [ownedRegimenId],
  )

  if (regimenId !== undefined) {
    regimenLinkToRemove.add(regimenId)
  }

  if (clearRegimenId && currentRegimenId !== undefined) {
    regimenLinkToRemove.add(currentRegimenId)
  }

  const nextLinks = links
    .filter((link) => {
      if (regimenLinkToRemove.has(link.targetId)) {
        return false
      }

      return true
    })

  if (regimenId !== undefined) {
    nextLinks.push({
      type: 'related_to',
      targetId: regimenId,
    })
  }

  removePatchPath(nextSet, 'links')
  removePatchPath(nextClear, 'links')
  if (nextLinks.length > 0) {
    nextSet.push(`links=${JSON.stringify(nextLinks)}`)
  } else {
    nextClear.push('links')
  }

  return {
    set: nextSet.length > 0 ? nextSet : undefined,
    clear: nextClear.length > 0 ? nextClear : undefined,
  }
}

function patchMayChangeExperimentRouting(input: {
  inputFile?: string
  set?: string[]
  clear?: string[]
}): boolean {
  if (input.inputFile !== undefined) {
    return true
  }

  return ['interventionType', 'occurredAt', 'timeZone', 'dayKey'].some((path) =>
    patchHasPath(input.set ?? [], path) ||
    patchHasPath(input.clear ?? [], path),
  )
}

function patchHasPath(values: readonly string[], path: string): boolean {
  const prefix = `${path}=`
  return values.some((value) => value === path || value.startsWith(prefix))
}

function hasExperimentState(
  data: Record<string, unknown>,
  links: readonly unknown[],
): boolean {
  return readExperimentTarget(data, links) !== null ||
    typeof data.experimentSlug === 'string'
}

function readExperimentTarget(
  data: Record<string, unknown>,
  links: readonly unknown[],
): InterventionExperimentLinkTarget | null {
  const experimentLinkId = links
    .map((link) => {
      if (typeof link !== 'object' || link === null) {
        return null
      }

      const record = link as Record<string, unknown>
      return typeof record.targetId === 'string' &&
        record.targetId.startsWith('exp_')
        ? record.targetId
        : null
    })
    .find((targetId): targetId is string => typeof targetId === 'string')
  const experimentId =
    typeof data.experimentId === 'string' ? data.experimentId : null
  const experimentSlug =
    typeof data.experimentSlug === 'string' ? data.experimentSlug : null

  const resolvedExperimentId = experimentId ?? experimentLinkId
  if (!resolvedExperimentId) {
    return null
  }

  return {
    experimentId: resolvedExperimentId,
    experimentSlug: experimentSlug ?? resolvedExperimentId,
  }
}

function readPatchString(set: readonly string[], path: string): string | undefined {
  const prefix = `${path}=`
  const entry = set.find((value) => value.startsWith(prefix))
  if (!entry) {
    return undefined
  }

  const parsed: unknown = JSON.parse(entry.slice(prefix.length))
  return typeof parsed === 'string' ? parsed : undefined
}

function removePatchPath(values: string[], path: string) {
  const prefix = `${path}=`
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === path || values[index].startsWith(prefix)) {
      values.splice(index, 1)
    }
  }
}

export async function deleteInterventionRecord(input: {
  vault: string
  lookup: string
}) {
  return deleteEventRecord({
    vault: input.vault,
    lookup: input.lookup,
    entityLabel: 'intervention',
    expectedKinds: ['intervention_session'],
  })
}

function resolveInterventionDescriptor(
  text: string,
  requestedInterventionType: string | undefined,
): InterventionDescriptor {
  const requested = normalizeOptionalText(requestedInterventionType)

  if (requested) {
    const matched = inferKnownInterventionDescriptor(requested)
    if (matched && matched !== 'ambiguous') {
      return matched
    }

    const interventionType = slugifyInterventionType(requested)
    if (!interventionType) {
      throw new VaultCliError(
        'invalid_option',
        'Intervention type must include at least one letter or number.',
      )
    }

    return {
      interventionType,
      label: normalizeInterventionLabel(requested),
      patterns: [],
    }
  }

  const inferred = inferKnownInterventionDescriptor(text)
  if (inferred === 'ambiguous') {
    throw new VaultCliError(
      'invalid_option',
      'Intervention type is ambiguous in the note. Pass --type <type> to record it explicitly.',
    )
  }

  if (inferred) {
    return inferred
  }

  throw new VaultCliError(
    'invalid_option',
    'Could not infer an intervention type from the note. Pass --type <type> to record it explicitly.',
  )
}

function inferKnownInterventionDescriptor(
  text: string,
): InterventionDescriptor | 'ambiguous' | null {
  const matches = knownInterventions.filter((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(text)),
  )

  if (matches.length === 0) {
    return null
  }

  const hasRedLightSauna = matches.some(
    (candidate) => candidate.interventionType === 'red-light-sauna',
  )
  const filteredMatches = matches.filter(
    (candidate) =>
      candidate.interventionType !== 'sauna' || !hasRedLightSauna,
  )

  if (filteredMatches.length === 1) {
    return filteredMatches[0]
  }

  return 'ambiguous'
}

function resolveDurationMinutes(
  text: string,
  requestedDurationMinutes: number | undefined,
) {
  if (typeof requestedDurationMinutes === 'number') {
    return validateDurationMinutes(
      requestedDurationMinutes,
      'Intervention duration',
    )
  }

  const inferred = inferDurationMinutes(text)
  if (inferred === 'ambiguous') {
    throw new VaultCliError(
      'invalid_option',
      'Intervention duration is ambiguous in the note. Pass --duration <minutes> to record it explicitly.',
    )
  }

  return typeof inferred === 'number' ? inferred : null
}

function buildInterventionTitle(
  label: string,
  durationMinutes: number | null,
) {
  const normalizedLabel = normalizeInterventionLabel(label) || 'Intervention'
  const title =
    typeof durationMinutes === 'number'
      ? `${durationMinutes}-minute ${normalizedLabel}`
      : titleCaseInterventionLabel(normalizedLabel)

  return title.slice(0, 160)
}

function normalizeInterventionLabel(value: string) {
  return value.trim().replace(/\s+/gu, ' ')
}

function titleCaseInterventionLabel(value: string) {
  if (value.length === 0) {
    return 'Intervention'
  }

  return /^[a-z]/u.test(value) ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value
}

function slugifyInterventionType(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}
