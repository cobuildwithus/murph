import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TYPE_RESULT_ANALYTE,
  BLOOD_TYPE_RESULT_SLUG,
  EVENT_SOURCES,
  parseBloodType,
} from '@murphai/contracts'
import { appendBloodTest, withCanonicalWriteLock } from '@murphai/core'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  occurredAtOptionSchema,
  pathSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { readCurrentBloodType, type CurrentBloodTypeRecord } from '@murphai/query'
import { Cli, z } from 'incur'

const rawVaultPathSchema = z
  .string()
  .regex(/^raw\/[A-Za-z0-9._/-]+$/u, 'Expected a vault-relative raw/... path.')
  .refine(
    (value) => value.split('/').every((segment) => segment !== '.' && segment !== '..'),
    'raw/... paths cannot contain . or .. segments.',
  )

const bloodTypeSchema = z.object({
  value: z.string(),
  abo: z.enum(['A', 'B', 'AB', 'O']),
  rh: z.enum(['positive', 'negative']),
  eventId: z.string(),
  occurredAt: z.string(),
  recordedAt: z.string().nullable(),
  source: z.string().nullable(),
})

export const profileShowResultSchema = z.object({
  vault: pathSchema,
  bloodType: bloodTypeSchema.nullable(),
})

export const profileSetResultSchema = z.object({
  vault: pathSchema,
  outcome: z.enum(['saved', 'unchanged']),
  bloodType: bloodTypeSchema,
})

interface ProfileSetInput {
  bloodType: string
  note?: string
  occurredAt?: string
  rawRef?: string[]
  source?: (typeof EVENT_SOURCES)[number]
  vault: string
}

function bloodTypePayload(record: CurrentBloodTypeRecord): z.infer<typeof bloodTypeSchema> {
  return {
    value: record.value,
    abo: record.abo,
    rh: record.rh,
    eventId: record.eventId,
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    source: record.source,
  }
}

function sameOccurrence(supplied: string, current: CurrentBloodTypeRecord): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(supplied)
    ? supplied === (current.dayKey ?? current.occurredAt.slice(0, 10))
    : Date.parse(supplied) === Date.parse(current.occurredAt)
}

/**
 * An exact retry repeats the current value and adds nothing the current event
 * lacks. Anything new is another observation and is saved, so supplied
 * evidence is never discarded.
 */
function isExactRetry(
  input: ProfileSetInput,
  value: string,
  current: CurrentBloodTypeRecord | null,
): current is CurrentBloodTypeRecord {
  return (
    current !== null &&
    current.value === value &&
    (input.occurredAt === undefined || sameOccurrence(input.occurredAt, current)) &&
    (input.source === undefined || input.source === current.source) &&
    (input.note === undefined || input.note === current.note) &&
    (input.rawRef ?? []).every((ref) => current.rawRefs.includes(ref))
  )
}

export async function setProfileBloodType(input: ProfileSetInput) {
  const bloodType = parseBloodType(input.bloodType)
  if (!bloodType) {
    throw new VaultCliError(
      'invalid_input',
      'Expected a blood type with an ABO group and Rh factor, such as AB+, O negative or B pos.',
    )
  }

  return withCanonicalWriteLock(input.vault, async () => {
    const current = await readCurrentBloodType(input.vault)
    if (isExactRetry(input, bloodType.value, current)) {
      return { outcome: 'unchanged' as const, record: current }
    }

    const now = new Date()
    await appendBloodTest({
      vaultRoot: input.vault,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
      source: input.source,
      title: 'Blood type',
      note: input.note,
      rawRefs: input.rawRef,
      testName: BLOOD_TYPE_RESULT_ANALYTE,
      specimenType: BLOOD_TEST_CATEGORY,
      results: [{
        analyte: BLOOD_TYPE_RESULT_ANALYTE,
        slug: BLOOD_TYPE_RESULT_SLUG,
        textValue: bloodType.value,
      }],
    })
    const saved = await readCurrentBloodType(input.vault)
    if (!saved || saved.value !== bloodType.value) {
      throw new VaultCliError('internal_error', 'The blood type was written but did not read back as current.')
    }
    return { outcome: 'saved' as const, record: saved }
  })
}

export function registerProfileCommands(cli: Cli.Cli) {
  const profile = Cli.create('profile', {
    description:
      'Stable personal health facts that have no other record family. Blood type is saved as a blood-test result.',
  })

  profile.command('show', {
    description:
      'Show the saved blood type. Null means no recognizable blood type is saved in blood-test history.',
    args: z.object({}),
    options: withBaseOptions(),
    output: profileShowResultSchema,
    async run({ options }) {
      const current = await readCurrentBloodType(options.vault)
      return {
        vault: options.vault,
        bloodType: current ? bloodTypePayload(current) : null,
      }
    },
  })

  profile.command('set', {
    description:
      'Save the member\'s blood type as one blood-test result. Returns unchanged only for an exact retry.',
    args: z.object({}),
    examples: [
      {
        description: 'Save a blood type read from a lab result image.',
        options: {
          bloodType: 'O negative',
          occurredAt: '2026-03-03',
          source: 'import',
          rawRef: ['raw/inbox/2026/11/cap_example/attachments/1/lab.webp'],
          vault: './vault',
        },
      },
    ],
    options: withBaseOptions({
      bloodType: z
        .string()
        .min(1)
        .max(40)
        .describe('Blood type such as AB+, O negative or B pos. Needs both ABO group and Rh factor.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional lab collection date or timestamp. Defaults to now.'),
      source: z.enum(EVENT_SOURCES).optional().describe('Optional event source, such as manual or import.'),
      note: z.string().min(1).max(4000).optional().describe('Optional note on where the value came from.'),
      rawRef: z
        .array(rawVaultPathSchema)
        .optional()
        .describe('Optional vault-relative raw/... evidence path. Repeat --raw-ref for multiple values.'),
    }),
    output: profileSetResultSchema,
    async run({ options }) {
      const result = await setProfileBloodType({
        bloodType: options.bloodType,
        note: options.note,
        occurredAt: options.occurredAt,
        rawRef: options.rawRef,
        source: options.source,
        vault: options.vault,
      })
      return {
        vault: options.vault,
        outcome: result.outcome,
        bloodType: bloodTypePayload(result.record),
      }
    },
  })

  cli.command(profile)
}
