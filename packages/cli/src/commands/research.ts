import { Cli, z } from 'incur'
import { isStrictIsoDate, isStrictIsoDateTime } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/vault-usecases'
import {
  fetchExaResearchScoutCandidates,
  researchScoutProfileSchema,
  researchScoutResultSchema,
  type ResearchScoutProfile,
} from '../research-scout.js'
import { registerPayloadSchemaCommand } from './payload-schema-command.js'

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

export function registerResearchCommands(cli: Cli.Cli) {
  const research = Cli.create('research', {
    description:
      'Run bounded external research-provider lookups without persisting vault data.',
  })

  registerPayloadSchemaCommand(research, {
    command: 'research scout --input',
    description:
      'Emit the exact compact profile JSON body schema for research scout --input.',
    schema: researchScoutProfileSchema,
    schemaName: 'ResearchScoutProfile',
    examples: [RESEARCH_SCOUT_PROFILE_EXAMPLE],
  })

  research.command('scout', {
    description:
      'Search Exa for bounded recent health research candidates from a compact non-identifying profile without writing vault records.',
    args: z.object({}),
    options: z.object({
      input: inputFileOptionSchema.describe(
        'Compact tag-profile JSON in @file.json form or - for stdin. Use bucket fields: topics, biomarkers, behaviors, supplements, conditionsOrConcerns, goals, activeExperiments. Do not include raw labs, names, dates of birth, full notes, or medical records.',
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
        .max(12)
        .default(12)
        .describe('Maximum research candidates to request from Exa.'),
    }),
    examples: [
      {
        description: 'Search for recent research candidates from a compact profile.',
        options: {
          input: '@research-profile.json',
          since: '2026-04-25',
          until: '2026-06-24T12:00:00.000Z',
          maxCandidates: 12,
        },
      },
    ],
    hint:
      'Requires EXA_API_KEY. Pass a compact tag profile only; use research payload-schema --format json for the exact file-body contract. The stdin body is the profile object, for example {"topics":["sleep","recovery"],"behaviors":["exercise"]}. Do not use a generic tags field or include raw labs, names, dates of birth, full notes, or medical records. The tool returns the provider response; local vault relevance and final medical framing remain the assistant job.',
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
        'Put only the compact profile in --input. Pass since, until, and maxCandidates as CLI options.',
      )
    }
    const wrappedProfile = researchScoutProfileSchema.safeParse(rawInput.profile)
    if (wrappedProfile.success) {
      return wrappedProfile.data
    }
  }

  throw invalidResearchScoutProfileError()
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
      `research scout --input expects a compact profile with bucket fields: ${fields}.`,
      'Use {"topics":["sleep","recovery"],"behaviors":["exercise"]}; do not use a generic tags field or raw notes.',
    ].filter(Boolean).join(' '),
  )
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
