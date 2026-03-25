import { VaultCliError } from '../vault-cli-errors.js'
import {
  inferDurationMinutes,
  validateDurationMinutes,
} from './text-duration.js'
import { upsertEventRecord } from './provider-event.js'
import {
  compactObject,
  normalizeOptionalText,
} from './vault-usecase-helpers.js'

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
  source?: 'manual' | 'import' | 'device' | 'derived'
  durationMinutes?: number
  interventionType?: string
  regimenId?: string
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
  const payload = compactObject({
    kind: 'intervention_session',
    occurredAt,
    source: input.source ?? 'manual',
    title: buildInterventionTitle(intervention.label, durationMinutes),
    interventionType: intervention.interventionType,
    durationMinutes: durationMinutes ?? undefined,
    regimenId: regimenId ?? undefined,
    relatedIds: regimenId ? [regimenId] : undefined,
    note,
  })

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
    note,
  }
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
