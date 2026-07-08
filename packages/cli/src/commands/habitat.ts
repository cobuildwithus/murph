import { Cli, z } from 'incur'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  computeHabitatCoverage,
  getHabitatAspectDefinition,
  HABITAT_CATALOG,
  HABITAT_DOMAIN_IDS,
  type HabitatIndicatorValue,
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

function parseIndicatorValue(raw: string): HabitatIndicatorValue {
  if (raw === 'null') {
    return null
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true'
  }
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    return Number(raw)
  }
  return raw
}

function parseIndicatorAssignments(
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
    indicators[assignment.slice(0, separator).trim()] = parseIndicatorValue(
      assignment.slice(separator + 1).trim(),
    )
  }

  return indicators
}

function habitatRecordPayload(record: Awaited<ReturnType<typeof readHabitatAspect>>) {
  return {
    habitatId: record.habitatId,
    aspect: record.aspect,
    title: record.title,
    domain: record.domain,
    status: record.status,
    indicators: record.indicators,
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
      recordedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional()
        .describe('ISO date stamped on the saved indicators. Defaults to today.'),
      note: z.string().min(1).max(4000).optional().describe('Replace the aspect note.'),
      body: z.string().optional().describe('Optional Markdown body with prose nuance.'),
      status: z.string().min(1).max(64).optional().describe('Aspect status: active or archived.'),
    }),
    output: habitatSaveResultSchema,
    async run({ args, options }) {
      const result = await upsertHabitatAspect({
        vaultRoot: options.vault,
        aspect: args.aspect,
        indicators: parseIndicatorAssignments(options.indicator),
        recordedAt: options.recordedAt ?? new Date().toISOString().slice(0, 10),
        note: options.note,
        body: options.body,
        status: options.status,
      })
      const record = await readHabitatAspect({
        vaultRoot: options.vault,
        habitatId: result.habitatId,
      })

      return {
        vault: options.vault,
        habitatId: result.habitatId,
        aspect: result.aspect,
        path: result.relativePath,
        created: result.created,
        indicators: record.indicators,
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
          knownIndicators: Object.keys(record.indicators).length,
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
        counts: { ...coverage.counts },
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
