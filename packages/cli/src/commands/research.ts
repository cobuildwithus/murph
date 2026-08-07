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

const RESEARCH_SCOUT_PROFILE_EXAMPLE = {
  topics: ['sleep', 'recovery'],
  behaviors: ['exercise'],
  biomarkers: [],
  supplements: [],
  conditionsOrConcerns: [],
  goals: [],
  activeExperiments: [],
} satisfies ResearchScoutProfile

const RESEARCH_SCOUT_QUESTION_EXAMPLE = {
  question:
    'What do recent randomized trials and systematic reviews show about creatine and cognitive performance in healthy adults?',
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
      'Emit the exact focused-question or compact tag-profile JSON body schema for research scout --input.',
    schema: researchScoutProfileSchema,
    schemaName: 'ResearchScoutProfile',
    examples: [RESEARCH_SCOUT_PROFILE_EXAMPLE, RESEARCH_SCOUT_QUESTION_EXAMPLE],
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
      'Search Exa for bounded human-research candidates from one focused public question or a compact non-identifying tag profile without writing vault records.',
    args: z.object({}),
    options: z.object({
      input: inputFileOptionSchema.describe(
        'Focused public question JSON such as {"question":"..."}, or compact tag-profile JSON using topics, biomarkers, behaviors, supplements, conditionsOrConcerns, goals, and activeExperiments. Pass @file.json or - for stdin. Do not include private notes, contacts, identifiers, credentials, exact personal measurements, or medical records.',
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
    examples: [
      {
        description: 'Research one focused public question.',
        options: {
          input: '@research-question.json',
          since: '2021-01-01',
          until: '2026-06-24T12:00:00.000Z',
          maxCandidates: 8,
        },
      },
      {
        description: 'Discover recent research candidates from a compact profile.',
        options: {
          input: '@research-profile.json',
          since: '2026-04-25',
          until: '2026-06-24T12:00:00.000Z',
          maxCandidates: 12,
        },
      },
    ],
    hint:
      'Requires EXA_API_KEY. Pass exactly one focused English, person-name-free public question as {"question":"..."}, or one compact non-identifying tag profile; use research payload-schema --format json for the exact file-body contract. Use --input @file.json or --input - for stdin, not inline JSON. Do not include private notes, names or personal framing, contacts, member or patient identifiers, credentials, dates of birth, exact personal labs or measurements, appointments, or medical records. Preserve institutions, person-name-free study titles, publication years, and scientific terms when they materially focus the search. The tool returns the provider response; source evaluation, local relevance, and final medical framing remain the assistant job.',
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
        'Compact lane JSON in @file.json form or - for stdin. Use {"lanes":[{"label":"sleep","profile":{"topics":["sleep"]}}]}. Lane profiles accept compact bucket fields only and must not include focused questions, raw labs, names, dates of birth, full notes, or medical records.',
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
      `Requires EXA_API_KEY. Pass up to ${MAX_RESEARCH_SCOUT_BATCH_LANES} compact non-identifying tag-profile lanes only; use research scout-batch-payload-schema for the exact file-body contract. The tool runs the existing research scout request once per lane and returns lane-tagged provider responses. Local vault relevance, deduping, final ranking, and medical framing remain the assistant job.`,
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
        'Put only the focused question or compact profile in --input. Pass since, until, and maxCandidates as CLI options.',
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
      'research scout --input expects either {"question":"..."} for one focused public question or a compact profile with bucket fields: '
        + `${fields}.`,
      'Do not mix the question and bucket shapes. Do not use a generic tags field or include private notes, contacts, identifiers, credentials, raw labs, exact personal measurements, appointments, or medical records.',
    ].filter(Boolean).join(' '),
  )
}

function invalidResearchScoutBatchPayloadError(extraDetail?: string): VaultCliError {
  return new VaultCliError(
    'research_scout_invalid_batch_payload',
    [
      extraDetail,
      `research scout-batch --input expects {"lanes":[...]} with 1-${MAX_RESEARCH_SCOUT_BATCH_LANES} compact lane profiles.`,
      'Use {"lanes":[{"label":"sleep","profile":{"topics":["sleep"],"behaviors":["morning light"]}}]}; do not use focused questions, generic tags, raw notes, raw labs, or full request fields.',
    ].filter(Boolean).join(' '),
  )
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
