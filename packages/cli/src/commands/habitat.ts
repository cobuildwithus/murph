import { Cli, z } from 'incur'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  computeHabitatCoverage,
  getHabitatAspectDefinition,
  getHabitatIndicatorDefinition,
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  HABITAT_DOMAIN_IDS,
  type HabitatCoverageCounts,
  type HabitatDomainCoverage,
  type HabitatIndicatorDefinition,
  type HabitatIndicatorValue,
  validateHabitatIndicatorValue,
} from '@murphai/contracts'
import {
  listHabitatAspects,
  readHabitatAspect,
  upsertHabitatAspect,
} from '@murphai/core'

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe('Vault root.'),
})

const habitatAspectArgSchema = z
  .string()
  .min(1)
  .describe(
    `Habitat aspect id from the catalog: ${HABITAT_CATALOG.aspects
      .map((aspect) => aspect.id)
      .join(', ')}.`,
  )

const habitatDomainOptionSchema = z
  .enum(HABITAT_DOMAIN_IDS)
  .optional()
  .describe('Optional domain filter: environment, workspace, or exercise.')

const habitatRecordSchema = z.object({
  habitatId: z.string().min(1),
  aspect: z.string().min(1),
  title: z.string().min(1),
  domain: z.string().min(1),
  status: z.string().min(1),
  indicators: z.record(z.string(), z.unknown()),
  indicatorNotes: z.record(z.string(), z.string()).nullable(),
  indicatorRecordedAt: z.record(z.string(), z.string()).nullable(),
  note: z.string().nullable(),
  body: z.string(),
  path: z.string().min(1),
})

const habitatSaveResultSchema = z.object({
  vault: z.string().min(1),
  habitatId: z.string().min(1),
  aspect: z.string().min(1),
  path: z.string().min(1),
  created: z.boolean(),
  indicators: z.record(z.string(), z.unknown()),
})

const habitatShowResultSchema = z.object({
  vault: z.string().min(1),
  record: habitatRecordSchema,
})

const habitatListResultSchema = z.object({
  vault: z.string().min(1),
  items: z.array(
    z.object({
      habitatId: z.string().min(1),
      aspect: z.string().min(1),
      title: z.string().min(1),
      domain: z.string().min(1),
      knownIndicators: z.number().int().nonnegative(),
    }),
  ),
  count: z.number().int().nonnegative(),
})

const habitatCoverageResultSchema = z.object({
  vault: z.string().min(1),
  catalogVersion: z.string().min(1),
  counts: z.record(z.string(), z.number()),
  domains: z.array(z.record(z.string(), z.unknown())),
})

const habitatCatalogResultSchema = z.object({
  version: z.string().min(1),
  aspects: z.array(z.record(z.string(), z.unknown())),
})

function countKnownHabitatIndicators(
  indicators: Readonly<Record<string, HabitatIndicatorValue>>,
): number {
  return Object.values(indicators).filter((value) =>
    value !== null && value !== HABITAT_DECLINED_VALUE
  ).length
}

function sumHabitatCoverageCounts(
  domains: readonly Pick<HabitatDomainCoverage, 'counts'>[],
): HabitatCoverageCounts {
  const counts: HabitatCoverageCounts = {
    known: 0,
    stale: 0,
    declined: 0,
    unknown: 0,
    total: 0,
  }

  for (const domain of domains) {
    counts.known += domain.counts.known
    counts.stale += domain.counts.stale
    counts.declined += domain.counts.declined
    counts.unknown += domain.counts.unknown
    counts.total += domain.counts.total
  }

  return counts
}

function validatedCliIndicatorValue(
  definition: HabitatIndicatorDefinition,
  indicatorId: string,
  value: HabitatIndicatorValue,
): HabitatIndicatorValue {
  const issue = validateHabitatIndicatorValue(definition, value)
  if (issue) {
    throw new VaultCliError(
      'contract_invalid',
      `Indicator "${indicatorId}" ${issue}`,
    )
  }

  return value
}

function parseIndicatorValue(
  aspectId: string,
  indicatorId: string,
  raw: string,
): HabitatIndicatorValue {
  const definition = getHabitatIndicatorDefinition(aspectId, indicatorId)
  if (!definition) {
    throw new VaultCliError(
      'contract_invalid',
      `Indicator "${indicatorId}" is not part of habitat aspect "${aspectId}". Run \`habitat catalog ${aspectId}\` for valid indicator ids.`,
    )
  }

  if (raw === 'null') {
    return null
  }
  if (raw === HABITAT_DECLINED_VALUE) {
    return HABITAT_DECLINED_VALUE
  }

  switch (definition.valueType.kind) {
    case 'number': {
      const value = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(value)) {
        throw new VaultCliError(
          'contract_invalid',
          `Indicator "${indicatorId}" expects a number, got "${raw}".`,
        )
      }

      return validatedCliIndicatorValue(definition, indicatorId, value)
    }
    case 'boolean': {
      if (raw !== 'true' && raw !== 'false') {
        throw new VaultCliError(
          'contract_invalid',
          `Indicator "${indicatorId}" expects true or false, got "${raw}".`,
        )
      }
      return validatedCliIndicatorValue(definition, indicatorId, raw === 'true')
    }
    case 'enum':
    case 'text':
      return validatedCliIndicatorValue(definition, indicatorId, raw)
  }
}

function parseIndicatorAssignments(
  aspectId: string,
  assignments: readonly string[] | undefined,
): Record<string, HabitatIndicatorValue> | undefined {
  if (!assignments || assignments.length === 0) {
    return undefined
  }

  const indicators: Record<string, HabitatIndicatorValue> = {}
  for (const assignment of assignments) {
    const separator = assignment.indexOf('=')
    if (separator <= 0) {
      throw new VaultCliError(
        'contract_invalid',
        `Indicator "${assignment}" must use the form indicator_id=value.`,
      )
    }
    const indicatorId = assignment.slice(0, separator).trim()
    indicators[indicatorId] = parseIndicatorValue(
      aspectId,
      indicatorId,
      assignment.slice(separator + 1).trim(),
    )
  }

  return indicators
}

function parseIndicatorNoteAssignments(
  aspectId: string,
  assignments: string[] | undefined,
): Record<string, string | null> | undefined {
  if (!assignments || assignments.length === 0) {
    return undefined
  }

  const notes: Record<string, string | null> = {}
  for (const assignment of assignments) {
    const separator = assignment.indexOf('=')
    if (separator <= 0) {
      throw new VaultCliError(
        'contract_invalid',
        `Indicator note "${assignment}" must use the form indicator_id=text.`,
      )
    }
    const indicatorId = assignment.slice(0, separator).trim()
    if (!getHabitatIndicatorDefinition(aspectId, indicatorId)) {
      throw new VaultCliError(
        'contract_invalid',
        `Indicator "${indicatorId}" is not part of habitat aspect "${aspectId}".`,
      )
    }
    const rawNote = assignment.slice(separator + 1).trim()
    if (rawNote === 'null') {
      notes[indicatorId] = null
      continue
    }
    if (rawNote.length === 0 || rawNote.length > 400) {
      throw new VaultCliError(
        'contract_invalid',
        `Indicator note "${indicatorId}" must contain 1-400 characters.`,
      )
    }
    notes[indicatorId] = rawNote
  }

  return notes
}

function habitatRecordPayload(record: Awaited<ReturnType<typeof readHabitatAspect>>) {
  return {
    habitatId: record.habitatId,
    aspect: record.aspect,
    title: record.title,
    domain: record.domain,
    status: record.status,
    indicators: record.indicators,
    indicatorNotes: record.indicatorNotes ?? null,
    indicatorRecordedAt: record.indicatorRecordedAt ?? null,
    note: record.note ?? null,
    body: record.body,
    path: record.relativePath,
  }
}

export function registerHabitatCommands(cli: Cli.Cli) {
  const habitat = Cli.create('habitat', {
    description:
      'Habitat life-context commands for bank/habitat aspect records (environment, workspace, exercise).',
  })

  habitat.command('save', {
    description:
      'Merge indicator values into one habitat aspect record; value "declined" records a respected refusal, "null" clears back to unknown.',
    args: z.object({
      aspect: habitatAspectArgSchema,
    }),
    options: vaultOptionSchema.extend({
      indicator: z
        .array(z.string().min(3))
        .optional()
        .describe(
          'Indicator assignment like night_temp_c=19 or co2_meter=declined. Repeat --indicator for multiple values.',
        ),
      indicatorNote: z
        .array(z.string().min(3))
        .optional()
        .describe(
          'Concise context like sauna_type=Dry home sauna, up to 100°C, Harvia heater. Repeat --indicator-note for multiple values; use null to clear.',
        ),
      recordedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional()
        .describe('ISO date stamped on the saved indicators. Defaults to today.'),
      note: z.string().min(1).max(4000).optional().describe('Replace the aspect note.'),
      body: z.string().optional().describe('Optional Markdown body with prose nuance.'),
    }),
    output: habitatSaveResultSchema,
    async run({ args, options }) {
      const result = await upsertHabitatAspect({
        vaultRoot: options.vault,
        aspect: args.aspect,
        indicators: parseIndicatorAssignments(args.aspect, options.indicator),
        indicatorNotes: parseIndicatorNoteAssignments(
          args.aspect,
          options.indicatorNote,
        ),
        recordedAt: options.recordedAt ?? new Date().toISOString().slice(0, 10),
        note: options.note,
        body: options.body,
      })

      return {
        vault: options.vault,
        habitatId: result.habitatId,
        aspect: result.aspect,
        path: result.relativePath,
        created: result.created,
        indicators: result.indicators,
      }
    },
  })

  habitat.command('show', {
    description: 'Show one habitat aspect record by canonical id or aspect slug.',
    args: z.object({
      lookup: z.string().min(1).describe('Habitat id (hab_...) or aspect slug to show.'),
    }),
    options: vaultOptionSchema,
    output: habitatShowResultSchema,
    async run({ args, options }) {
      const lookup = args.lookup.trim()
      const record = await readHabitatAspect(
        lookup.startsWith('hab_')
          ? { vaultRoot: options.vault, habitatId: lookup }
          : { vaultRoot: options.vault, slug: lookup },
      )

      return {
        vault: options.vault,
        record: habitatRecordPayload(record),
      }
    },
  })

  habitat.command('list', {
    description: 'List habitat aspect records with an optional domain filter.',
    args: z.object({}),
    options: vaultOptionSchema.extend({
      domain: habitatDomainOptionSchema,
    }),
    output: habitatListResultSchema,
    async run({ options }) {
      const records = (await listHabitatAspects(options.vault)).filter(
        (record) => !options.domain || record.domain === options.domain,
      )

      return {
        vault: options.vault,
        items: records.map((record) => ({
          habitatId: record.habitatId,
          aspect: record.aspect,
          title: record.title,
          domain: record.domain,
          knownIndicators: countKnownHabitatIndicators(record.indicators),
        })),
        count: records.length,
      }
    },
  })

  habitat.command('coverage', {
    description:
      'Compute habitat coverage against the domain catalog: known, declined, stale, and unknown indicators per aspect, with top gaps.',
    args: z.object({}),
    options: vaultOptionSchema.extend({
      domain: habitatDomainOptionSchema,
    }),
    output: habitatCoverageResultSchema,
    async run({ options }) {
      const records = await listHabitatAspects(options.vault)
      const coverage = computeHabitatCoverage(
        records.map((record) => ({
          aspect: record.aspect,
          indicators: record.indicators,
          indicatorRecordedAt: record.indicatorRecordedAt,
        })),
        { now: new Date().toISOString().slice(0, 10) },
      )
      const domains = coverage.domains.filter(
        (domain) => !options.domain || domain.domain === options.domain,
      )

      return {
        vault: options.vault,
        catalogVersion: coverage.catalogVersion,
        counts: { ...sumHabitatCoverageCounts(domains) },
        domains: domains.map((domain) => ({ ...domain })),
      }
    },
  })

  habitat.command('catalog', {
    description:
      'Emit the habitat domain catalog: aspects, indicators, priorities, example questions, and evidence targets.',
    args: z.object({
      aspect: habitatAspectArgSchema
        .optional()
        .describe('Optional aspect id to show; omit for the whole catalog.'),
    }),
    options: z.object({}),
    output: habitatCatalogResultSchema,
    async run({ args }) {
      if (args.aspect) {
        const aspect = getHabitatAspectDefinition(args.aspect)
        if (!aspect) {
          throw new VaultCliError(
            'contract_invalid',
            `Unknown habitat aspect "${args.aspect}".`,
          )
        }

        return {
          version: HABITAT_CATALOG.version,
          aspects: [{ ...aspect }],
        }
      }

      return {
        version: HABITAT_CATALOG.version,
        aspects: HABITAT_CATALOG.aspects.map((aspect) => ({ ...aspect })),
      }
    },
  })

  cli.command(habitat)
}
