import { Cli, z } from 'incur'
import { isStrictIsoDate, isStrictIsoDateTime } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/vault-usecases'
import {
  fetchExaResearchScoutCandidates,
  fetchExaResearchScoutBatchCandidates,
  DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
  RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE,
  MAX_RESEARCH_SCOUT_BATCH_LANES,
  MAX_RESEARCH_SCOUT_CANDIDATES,
  researchScoutBatchPayloadSchema,
  researchScoutBatchResultSchema,
  researchScoutProfileSchema,
  researchScoutResultSchema,
  type ResearchScoutBatchPayload,
  type ResearchScoutProfile,
} from '../research-scout.js'
import {
  createPayloadSchemaResult,
  payloadSchemaResultSchema,
  registerPayloadSchemaCommand,
} from './payload-schema-command.js'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

const researchScoutTimestampOptionSchema = z.string().refine(
  (value) => normalizeResearchScoutTimestampOption(value, 'since') !== null,
  {
    message: 'Use YYYY-MM-DD or a full ISO timestamp with a timezone.',
  },
)

const RESEARCH_SCOUT_PROFILE_FIELDS = [
  'topics',
  'biomarkers',
  'behaviors',
  'supplements',
  'conditionsOrConcerns',
  'goals',
  'activeExperiments',
] as const

const RESEARCH_SCOUT_FOCUSED_EXAMPLE = {
  mode: 'focused',
  topics: ['cognition'],
  supplements: ['creatine'],
  conditionsOrConcerns: ['healthy adults'],
  goals: ['cognitive performance'],
} satisfies Partial<ResearchScoutProfile>

const RESEARCH_SCOUT_BATCH_EXAMPLE = {
  lanes: [
    {
      label: 'sleep',
      profile: {
        topics: ['sleep'],
        biomarkers: [],
        behaviors: ['morning light'],
        supplements: [],
        conditionsOrConcerns: [],
        goals: [],
        activeExperiments: ['screen curfew'],
      },
    },
    {
      label: 'training recovery',
      profile: {
        topics: ['recovery'],
        biomarkers: [],
        behaviors: ['resistance training'],
        supplements: [],
        conditionsOrConcerns: [],
        goals: ['better recovery'],
        activeExperiments: [],
      },
    },
  ],
} satisfies ResearchScoutBatchPayload

export function registerResearchCommands(cli: Cli.Cli) {
  const research = Cli.create('research', {
    description:
      'Run bounded external research-provider lookups without persisting vault data.',
  })

  registerPayloadSchemaCommand(research, {
    command: 'research scout --input',
    description:
      'Emit the exact finite focused-scope JSON body schema for research scout --input.',
    schema: researchScoutProfileSchema,
    schemaName: 'ResearchScoutProfile',
    examples: [RESEARCH_SCOUT_FOCUSED_EXAMPLE],
  })

  research.command('scout-batch-payload-schema', {
    description:
      'Emit the exact compact lane JSON body schema for research scout-batch --input.',
    args: z.object({}),
    options: z.object({}),
    output: payloadSchemaResultSchema,
    run() {
      return createPayloadSchemaResult({
        command: 'research scout-batch --input',
        description:
          'Emit the exact compact lane JSON body schema for research scout-batch --input.',
        schema: researchScoutBatchPayloadSchema,
        schemaName: 'ResearchScoutBatchPayload',
        examples: [RESEARCH_SCOUT_BATCH_EXAMPLE],
      })
    },
  })

  research.command('scout', {
    description:
      'Search Exa for bounded human-research candidates from one finite focused structured scope without writing vault records.',
    args: z.object({}),
    options: z.object({
      input: inputFileOptionSchema.describe(
        `Focused structured JSON using required {"mode":"focused"} plus exact server-owned public concepts. Pass @file.json or - for stdin. Focused concept values: ${RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE}. Never include arbitrary values, names, organizations, private notes, contacts, identifiers, credentials, exact personal measurements, or medical records.`,
      ),
      since: researchScoutTimestampOptionSchema.describe(
        'Inclusive lower publication date bound as YYYY-MM-DD or an ISO timestamp.',
      ),
      until: researchScoutTimestampOptionSchema.describe(
        'Inclusive upper publication date bound as YYYY-MM-DD or an ISO timestamp.',
      ),
      maxCandidates: z
        .number()
        .int()
        .min(1)
        .max(MAX_RESEARCH_SCOUT_CANDIDATES)
        .default(MAX_RESEARCH_SCOUT_CANDIDATES)
        .describe('Maximum research candidates to request from Exa.'),
    }),
    examples: [{
      description: 'Research one focused structured scope.',
      options: {
        input: '@research-focus.json',
        since: '2021-01-01',
        until: '2026-06-24T12:00:00.000Z',
        maxCandidates: 8,
      },
    }],
    hint:
      `Requires EXA_API_KEY and {"mode":"focused"}. Use only exact server-owned public concepts: ${RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE}. If the question cannot be represented exactly, make no Exa call. Use research scout-batch for broad discovery or automation. Use research payload-schema --format json for the file-body contract and --input @file.json or --input - for stdin, not inline JSON. Never include arbitrary values, private notes, names, organizations, personal framing, contacts, member or patient identifiers, credentials, dates of birth, exact personal labs or measurements, appointments, or medical records. Rely only on a candidate whose resultIndex maps to a returned source with a title, web URL, and enough publication metadata for the claim; otherwise report no usable current source without fabricating or repeating the lookup blindly.`,
    output: researchScoutResultSchema,
    async run({ options }) {
      const rawProfile = await loadJsonInputObject(
        options.input,
        'research scout profile',
      )
      const profile = parseResearchScoutCliProfileInput(rawProfile)
      const since = normalizeRequiredResearchScoutTimestampOption(
        options.since,
        'since',
      )
      const until = normalizeRequiredResearchScoutTimestampOption(
        options.until,
        'until',
      )
      assertResearchScoutWindow(since, until)

      return await fetchExaResearchScoutCandidates({
        profile,
        since,
        until,
        maxCandidates: options.maxCandidates,
      })
    },
  })

  research.command('scout-batch', {
    description:
      'Search Exa for bounded health research candidates from multiple compact non-identifying profile lanes without writing vault records.',
    args: z.object({}),
    options: z.object({
      input: inputFileOptionSchema.describe(
        'Finite public-concept lane JSON in @file.json form or - for stdin. Use {"lanes":[{"label":"sleep","profile":{"topics":["sleep"]}}]}. Lane profiles accept tag-only bucket fields with the same server-owned provider concepts and must not include focused mode, arbitrary values, raw labs, names, dates of birth, full notes, or medical records.',
      ),
      since: researchScoutTimestampOptionSchema.describe(
        'Inclusive lower publication date bound as YYYY-MM-DD or an ISO timestamp.',
      ),
      until: researchScoutTimestampOptionSchema.describe(
        'Inclusive upper publication date bound as YYYY-MM-DD or an ISO timestamp.',
      ),
      maxCandidatesPerLane: z
        .number()
        .int()
        .min(1)
        .max(MAX_RESEARCH_SCOUT_CANDIDATES)
        .default(DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE)
        .describe('Maximum research candidates to request from Exa for each lane.'),
    }),
    examples: [
      {
        description: 'Search across a few focused compact research lanes.',
        options: {
          input: '@research-lanes.json',
          since: '2024-06-24',
          until: '2026-06-24T12:00:00.000Z',
          maxCandidatesPerLane: DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
        },
      },
    ],
    hint:
      `Requires EXA_API_KEY. Pass up to ${MAX_RESEARCH_SCOUT_BATCH_LANES} tag-only lanes using the exact server-owned public concepts; use research scout-batch-payload-schema for the file-body contract. The tool runs the legacy research-scout query and prompt once per lane and returns lane-tagged provider responses. Local vault relevance, deduping, final ranking, and medical framing remain the managed automation owner's job.`,
    output: researchScoutBatchResultSchema,
    async run({ options }) {
      const rawPayload = await loadJsonInputObject(
        options.input,
        'research scout batch lanes',
      )
      const payload = parseResearchScoutBatchCliPayloadInput(rawPayload)
      const since = normalizeRequiredResearchScoutTimestampOption(
        options.since,
        'since',
      )
      const until = normalizeRequiredResearchScoutTimestampOption(
        options.until,
        'until',
      )
      assertResearchScoutWindow(since, until)

      return await fetchExaResearchScoutBatchCandidates({
        ...payload,
        since,
        until,
        maxCandidatesPerLane: options.maxCandidatesPerLane,
      })
    },
  })

  cli.command(research)
}

export function parseResearchScoutCliProfileInput(
  rawInput: unknown,
): ResearchScoutProfile {
  const directProfile = researchScoutProfileSchema.safeParse(rawInput)
  if (directProfile.success) {
    return directProfile.data
  }

  if (isJsonRecord(rawInput) && Object.hasOwn(rawInput, 'profile')) {
    const keys = Object.keys(rawInput)
    if (keys.length !== 1) {
      throw invalidResearchScoutProfileError(
        'Put only the focused profile in --input. Pass since, until, and maxCandidates as CLI options.',
      )
    }
    const wrappedProfile = researchScoutProfileSchema.safeParse(rawInput.profile)
    if (wrappedProfile.success) {
      return wrappedProfile.data
    }
  }

  throw invalidResearchScoutProfileError()
}

export function parseResearchScoutBatchCliPayloadInput(
  rawInput: unknown,
): ResearchScoutBatchPayload {
  const payload = researchScoutBatchPayloadSchema.safeParse(rawInput)
  if (payload.success) {
    return payload.data
  }

  if (isJsonRecord(rawInput) && Object.hasOwn(rawInput, 'lanes')) {
    const keys = Object.keys(rawInput)
    if (keys.some((key) =>
      key === 'since' || key === 'until' || key === 'maxCandidatesPerLane'
    )) {
      throw invalidResearchScoutBatchPayloadError(
        'Put only compact lanes in --input. Pass since, until, and maxCandidatesPerLane as CLI options.',
      )
    }
  }

  throw invalidResearchScoutBatchPayloadError()
}

export function normalizeResearchScoutTimestampOption(
  value: string,
  bound: 'since' | 'until',
  now: Date = new Date(),
): string | null {
  const trimmed = value.trim()
  if (trimmed !== value || trimmed.length === 0) {
    return null
  }

  if (isStrictIsoDate(trimmed)) {
    const match = ISO_DATE_PATTERN.exec(trimmed)
    if (!match) {
      return null
    }
    const year = Number(match[1])
    const monthIndex = Number(match[2]) - 1
    const day = Number(match[3])
    const startOfDayMs = Date.UTC(year, monthIndex, day, 0, 0, 0, 0)
    const timestampMs = bound === 'since'
      ? startOfDayMs
      : Math.min(startOfDayMs + 86_400_000 - 1, now.getTime())
    return new Date(timestampMs).toISOString()
  }

  if (!isStrictIsoDateTime(trimmed)) {
    return null
  }

  const timestampMs = Date.parse(trimmed)
  if (!Number.isFinite(timestampMs)) {
    return null
  }
  const boundedTimestampMs = bound === 'until'
    ? Math.min(timestampMs, now.getTime())
    : timestampMs
  return new Date(boundedTimestampMs).toISOString()
}

function normalizeRequiredResearchScoutTimestampOption(
  value: string,
  bound: 'since' | 'until',
): string {
  const normalized = normalizeResearchScoutTimestampOption(value, bound)
  if (normalized) {
    return normalized
  }
  throw new VaultCliError(
    'research_scout_invalid_window',
    `research scout --${bound} must be YYYY-MM-DD or a full ISO timestamp with a timezone.`,
  )
}

function assertResearchScoutWindow(since: string, until: string): void {
  if (Date.parse(since) < Date.parse(until)) {
    return
  }
  throw new VaultCliError(
    'research_scout_invalid_window',
    'research scout requires --since to be earlier than --until.',
  )
}

function invalidResearchScoutProfileError(extraDetail?: string): VaultCliError {
  const fields = RESEARCH_SCOUT_PROFILE_FIELDS.join(', ')
  return new VaultCliError(
    'research_scout_invalid_profile',
    [
      extraDetail,
      'research scout --input expects compact profile bucket fields: '
        + `${fields}. Include required {"mode":"focused"}; managed broad discovery uses research scout-batch.`,
      `Focused mode accepts only these exact server-owned public concepts: ${RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE}.`,
      'Do not use arbitrary question text or values, a generic tags field, names, organizations, private notes, contacts, identifiers, credentials, raw labs, exact personal measurements, appointments, or medical records.',
    ].filter(Boolean).join(' '),
  )
}

function invalidResearchScoutBatchPayloadError(extraDetail?: string): VaultCliError {
  return new VaultCliError(
    'research_scout_invalid_batch_payload',
    [
      extraDetail,
      `research scout-batch --input expects {"lanes":[...]} with 1-${MAX_RESEARCH_SCOUT_BATCH_LANES} compact lane profiles.`,
      `Use {"lanes":[{"label":"sleep","profile":{"topics":["sleep"],"behaviors":["morning light"]}}]}; lane values must use these exact server-owned public concepts: ${RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE}. Do not use focused mode, generic tags, raw notes, raw labs, or full request fields.`,
    ].filter(Boolean).join(' '),
  )
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
