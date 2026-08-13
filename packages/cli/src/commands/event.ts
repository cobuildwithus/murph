import { Cli, z } from 'incur'
import {
  ADVERSE_EFFECT_SEVERITIES,
  eventSourceSchema,
  publicEventImportJsonlRowPayloadSchemasByKind,
  publicEventWriteKindSchema,
  type EventSource,
} from '@murphai/contracts'
import {
  appendHistoryEvent,
  PROCEDURE_STATUSES,
} from '@murphai/core'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  listItemSchema,
  localDateSchema,
  occurredAtOptionSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeRepeatableFlagOption,
  type JsonObject,
} from '@murphai/vault-usecases'
import {
  dedupeDeviceImportEventRecords,
  deleteEventRecord,
  editEventRecord,
  importEventRecordsFromJsonl,
  upsertEventRecord,
} from '@murphai/vault-usecases/records'
import {
  eventScaffoldKindSchema,
  showEventRecord,
} from '@murphai/vault-usecases/records'
import type { VaultServices } from '@murphai/vault-usecases'
import { createLedgerEventEntityGroup } from './entity-command-groups.js'
import {
  appendTypedSet,
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
  emptyToUndefined,
  stringOption,
} from './record-mutation-command-helpers.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'
import {
  createPayloadSchemaCommand,
  registerFactoryCommand,
} from './command-factory-primitives.js'

const eventIdSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical event id in evt_* form.')

const eventScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('event'),
  kind: eventScaffoldKindSchema,
  payload: z.record(z.string(), z.unknown()),
})

const eventUpsertResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
})

const eventImportJsonlResultSchema = z.object({
  vault: pathSchema,
  applied: z.boolean(),
  receivedCount: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  skippedExistingCount: z.number().int().nonnegative(),
  supersededCount: z.number().int().nonnegative(),
  eventShardPaths: z.array(pathSchema),
  auditPath: pathSchema.nullable(),
})

const eventDedupeDeviceImportsResultSchema = z.object({
  vault: pathSchema,
  applied: z.boolean(),
  scannedLiveDeviceEventCount: z.number().int().nonnegative(),
  duplicateGroupCount: z.number().int().nonnegative(),
  tombstonedEventCount: z.number().int().nonnegative(),
  tombstonedByKind: z.record(z.string(), z.number().int().nonnegative()),
  skippedRevisedElsewhereCount: z.number().int().nonnegative(),
  shardPaths: z.array(pathSchema),
  auditPath: pathSchema.nullable(),
})

const eventListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    kind: z.string().min(1).nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    tag: z.array(z.string().min(1)),
    experiment: slugSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

const eventTitleOptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .optional()
  .describe('Optional event title. If omitted, the command derives a short title.')
const eventNoteOptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .optional()
  .describe('Optional freeform event note.')
const eventTagOptionSchema = z
  .array(slugSchema)
  .optional()
  .describe('Optional event tags. Repeat --tag for multiple values.')
const eventUnitSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._/%-]+$/u,
    'Expected a compact unit such as mg, bpm, ms, count, or %.',
  )
  .describe('Compact unit such as mg, bpm, ms, count, or %.')

const typedEventBaseResultSchema = eventUpsertResultSchema.extend({
  kind: z.enum([
    'adverse_effect',
    'encounter',
    'exposure',
    'note',
    'medication_intake',
    'observation',
    'procedure',
    'supplement_intake',
    'symptom',
  ]),
})

const eventNoteAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('note'),
})

const eventSymptomAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('symptom'),
})

const eventObservationAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('observation'),
})

const eventMedicationIntakeAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('medication_intake'),
})

const eventSupplementIntakeAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('supplement_intake'),
})

const eventEncounterAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('encounter'),
})

const eventProcedureAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('procedure'),
})

const eventAdverseEffectAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('adverse_effect'),
})

const eventExposureAddResultSchema = typedEventBaseResultSchema.extend({
  kind: z.literal('exposure'),
})

const procedureStatusSchema = z
  .enum(PROCEDURE_STATUSES)
  .optional()
  .describe('Optional procedure status: ordered, planned, completed, or cancelled.')
const adverseEffectSeveritySchema = z
  .enum(ADVERSE_EFFECT_SEVERITIES)
  .optional()
  .describe('Optional adverse-effect severity: mild, moderate, or severe.')

const optionalEventStringSchema = (max: number, description: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .optional()
    .describe(description)

type GenericTypedEventKind =
  | 'note'
  | 'symptom'
  | 'observation'
  | 'medication_intake'
  | 'supplement_intake'

type HistoryTypedEventKind =
  | 'encounter'
  | 'procedure'
  | 'adverse_effect'
  | 'exposure'

type CommonTypedEventPayload = JsonObject & {
  kind: GenericTypedEventKind
  occurredAt: string
  source: EventSource
  title: string
  note?: string
  tags?: string[]
}

type CommonHistoryEventInput = {
  occurredAt: string
  source: EventSource
  title: string
  note?: string
  tags?: string[]
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function deriveEventTitle(explicitTitle: string | undefined, fallback: string): string {
  const explicit = normalizeOptionalText(explicitTitle)
  if (explicit) {
    return explicit
  }

  const normalizedFallback = fallback.trim().replace(/\s+/gu, ' ')
  return normalizedFallback.length <= 160
    ? normalizedFallback
    : `${normalizedFallback.slice(0, 157)}...`
}

function normalizeEventTags(value: readonly string[] | undefined): string[] {
  return normalizeRepeatableFlagOption(value, 'tag') ?? []
}

async function buildCommonTypedEventPayload(input: {
  kind: GenericTypedEventKind
  vault: string
  occurredAt?: string
  source?: EventSource
  title: string
  note?: string
  tag?: readonly string[]
}): Promise<CommonTypedEventPayload> {
  const occurredAt =
    (await normalizeOccurredAtOption({
      vault: input.vault,
      occurredAt: input.occurredAt,
    })) ?? new Date().toISOString()
  const source = input.source ?? 'manual'
  const note = normalizeOptionalText(input.note)
  const tags = normalizeEventTags(input.tag)

  return {
    kind: input.kind,
    occurredAt,
    source,
    title: input.title,
    ...(note ? { note } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }
}

async function buildCommonHistoryEventInput(input: {
  vault: string
  occurredAt: string
  source?: EventSource
  title: string
  note?: string
  tag?: readonly string[]
}): Promise<CommonHistoryEventInput> {
  const occurredAt = await normalizeOccurredAtOption({
    vault: input.vault,
    occurredAt: input.occurredAt,
  })

  if (typeof occurredAt !== 'string') {
    throw new Error('Expected --occurred-at to be present after option validation.')
  }

  const source = input.source ?? 'manual'
  const note = normalizeOptionalText(input.note)
  const tags = normalizeEventTags(input.tag)

  return {
    occurredAt,
    source,
    title: input.title,
    ...(note ? { note } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }
}

function mapHistoryAddResult<TKind extends HistoryTypedEventKind>(input: {
  vault: string
  kind: TKind
  result: Awaited<ReturnType<typeof appendHistoryEvent>>
}) {
  return {
    vault: input.vault,
    eventId: input.result.record.id,
    lookupId: input.result.record.id,
    ledgerFile: input.result.relativePath,
    created: true,
    kind: input.kind,
  }
}

export function registerEventCommands(cli: Cli.Cli, services: VaultServices) {
  const event = createLedgerEventEntityGroup({
    commandName: 'event',
    description: 'Generic canonical event commands for event kinds without specialized nouns.',
    scaffold: {
      description: 'Emit an event payload template for one canonical event kind.',
      kindOption: eventScaffoldKindSchema.describe('Canonical event kind to scaffold.'),
      output: eventScaffoldResultSchema,
      async run(input) {
        return services.core.scaffoldEvent({
          kind: input.kind,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    importJson: {
      description: 'Append one canonical event from a JSON payload file or stdin.',
      output: eventUpsertResultSchema,
      async run(input) {
        return services.core.upsertEvent({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one canonical event by event id.',
      argName: 'id',
      argSchema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showEvent({
          eventId: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List canonical events with optional kind, date, tag, and experiment filters.',
      examples: [
        {
          description: 'List tagged test events in one date window.',
          options: {
            from: '2026-03-01',
            kind: 'test',
            tag: ['follow-up'],
            to: '2026-03-31',
            vault: './vault',
          },
        },
      ],
      hint:
        'Combine --kind, repeatable --tag, --experiment <slug>, and --from/--to to narrow the event read model.',
      kindOption: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional canonical event kind filter such as encounter, procedure, test, adverse_effect, or exposure.',
        ),
      tagOption: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Optional tag filter. Repeat --tag to match any listed tag.',
        ),
      experimentOption: slugSchema
        .optional()
        .describe('Optional experiment slug filter for events linked to one experiment.'),
      output: eventListResultSchema,
      async run(input) {
        return services.query.listEvents({
          vault: input.vault,
          requestId: input.requestId,
          kind: input.kind,
          from: input.from,
          to: input.to,
          tag: Array.isArray(input.tag) ? input.tag : undefined,
          experiment: input.experiment,
          limit: input.limit ?? 10,
        })
      },
    },
    additionalCommands: [
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
        },
        description:
          'Edit one canonical event from typed fields.',
        async run(input) {
          const result = await editEventRecord({
            vault: input.vault,
            lookup: input.lookup,
            entityLabel: 'event',
            set: input.set,
            clear: input.clear,
            dayKeyPolicy: input.dayKeyPolicy,
          })

          return showEventRecord(input.vault, result.lookupId)
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
        },
        description: 'Delete one canonical event by event id.',
        run(input) {
          return deleteEventRecord({
            vault: input.vault,
            lookup: input.lookup,
            entityLabel: 'event',
          })
        },
      }),
    ],
  })

  const note = Cli.create('note', {
    description: 'Typed note event write commands.',
  })

  note.command('add', {
    description: 'Append one canonical note event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      note: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .describe('Freeform note text to store on the event.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventNoteAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, options.note)
      const payload = await buildCommonTypedEventPayload({
        kind: 'note',
        vault: options.vault,
        occurredAt: options.occurredAt,
        source: options.source,
        title,
        note: options.note,
        tag: options.tag,
      })
      const result = await upsertEventRecord({
        vault: options.vault,
        payload,
      })

      return {
        ...result,
        kind: 'note' as const,
      }
    },
  })

  const symptom = Cli.create('symptom', {
    description: 'Typed symptom event write commands.',
  })

  symptom.command('add', {
    description: 'Append one canonical symptom event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      symptom: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('Symptom name, such as headache or nausea.'),
      severity: z
        .number()
        .int()
        .min(0)
        .max(10)
        .describe('Symptom severity on a 0-10 scale.'),
      bodyRegion: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Optional affected body region.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventSymptomAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Symptom: ${options.symptom}`)
      const bodyRegion = normalizeOptionalText(options.bodyRegion)
      const payload = {
        ...(await buildCommonTypedEventPayload({
          kind: 'symptom',
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        symptom: options.symptom,
        intensity: options.severity,
        ...(bodyRegion ? { bodySite: bodyRegion } : {}),
      }
      const result = await upsertEventRecord({
        vault: options.vault,
        payload,
      })

      return {
        ...result,
        kind: 'symptom' as const,
      }
    },
  })

  const observation = Cli.create('observation', {
    description: 'Typed observation event write commands.',
  })

  observation.command('add', {
    description: 'Append one canonical observation event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      metric: slugSchema.describe('Observation metric slug, such as resting-heart-rate.'),
      value: z.number().describe('Observed numeric value.'),
      unit: eventUnitSchema,
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventObservationAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Observation: ${options.metric}`)
      const commonPayload = await buildCommonTypedEventPayload({
        kind: 'observation',
        vault: options.vault,
        occurredAt: options.occurredAt,
        source: options.source,
        title,
        note: options.note,
        tag: options.tag,
      })
      const payload: JsonObject = {
        ...commonPayload,
        metric: options.metric,
        value: options.value,
        unit: options.unit,
      }

      if (commonPayload.source === 'manual') {
        payload.queryVisibility = 'default'
        payload.visibility = 'display'
      }
      const result = await upsertEventRecord({
        vault: options.vault,
        payload,
      })

      return {
        ...result,
        kind: 'observation' as const,
      }
    },
  })

  const supplementIntake = Cli.create('supplement-intake', {
    description: 'Typed supplement intake event write commands.',
  })

  supplementIntake.command('add', {
    description: 'Append one canonical supplement intake event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      supplementName: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Supplement name, such as magnesium glycinate.'),
      dose: z.number().nonnegative().describe('Supplement dose amount.'),
      unit: eventUnitSchema,
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventSupplementIntakeAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Supplement: ${options.supplementName}`)
      const payload = {
        ...(await buildCommonTypedEventPayload({
          kind: 'supplement_intake',
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        supplementName: options.supplementName,
        dose: options.dose,
        unit: options.unit,
      }
      const result = await upsertEventRecord({
        vault: options.vault,
        payload,
      })

      return {
        ...result,
        kind: 'supplement_intake' as const,
      }
    },
  })

  const medicationIntake = Cli.create('medication-intake', {
    description: 'Typed medication intake event write commands.',
  })

  medicationIntake.command('add', {
    description: 'Append one canonical medication intake event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      medicationName: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Medication name, such as metformin.'),
      dose: z.number().nonnegative().describe('Medication dose amount.'),
      unit: eventUnitSchema,
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventMedicationIntakeAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Medication: ${options.medicationName}`)
      const payload = {
        ...(await buildCommonTypedEventPayload({
          kind: 'medication_intake',
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        medicationName: options.medicationName,
        dose: options.dose,
        unit: options.unit,
      }
      const result = await upsertEventRecord({
        vault: options.vault,
        payload,
      })

      return {
        ...result,
        kind: 'medication_intake' as const,
      }
    },
  })

  const encounter = Cli.create('encounter', {
    description: 'Typed encounter history event write commands.',
  })

  encounter.command('add', {
    description: 'Append one canonical encounter history event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      encounterType: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Encounter type, such as office_visit, specialist_follow_up, or urgent-care.'),
      location: optionalEventStringSchema(160, 'Optional encounter location.'),
      providerId: z
        .string()
        .regex(/^prov_[0-9A-Za-z]+$/u, 'Expected a canonical provider id in prov_* form.')
        .optional()
        .describe('Optional canonical provider id such as prov_<ULID>.'),
      occurredAt: occurredAtOptionSchema
        .describe('Occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventEncounterAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Encounter: ${options.encounterType}`)
      const result = await appendHistoryEvent({
        ...(await buildCommonHistoryEventInput({
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        vaultRoot: options.vault,
        kind: 'encounter',
        encounterType: options.encounterType,
        ...(options.location ? { location: options.location } : {}),
        ...(options.providerId ? { providerId: options.providerId } : {}),
      })

      return mapHistoryAddResult({
        vault: options.vault,
        kind: 'encounter',
        result,
      })
    },
  })

  const procedure = Cli.create('procedure', {
    description: 'Typed procedure history event write commands.',
  })

  procedure.command('add', {
    description: 'Append one canonical procedure history event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      procedure: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Procedure name or slug, such as right-knee-arthroscopy.'),
      status: procedureStatusSchema,
      occurredAt: occurredAtOptionSchema
        .describe('Occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventProcedureAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Procedure: ${options.procedure}`)
      const result = await appendHistoryEvent({
        ...(await buildCommonHistoryEventInput({
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        vaultRoot: options.vault,
        kind: 'procedure',
        procedure: options.procedure,
        ...(options.status ? { status: options.status } : {}),
      })

      return mapHistoryAddResult({
        vault: options.vault,
        kind: 'procedure',
        result,
      })
    },
  })

  const adverseEffect = Cli.create('adverse-effect', {
    description: 'Typed adverse-effect history event write commands.',
  })

  adverseEffect.command('add', {
    description: 'Append one canonical adverse-effect history event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      substance: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Substance associated with the adverse effect.'),
      effect: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Observed adverse effect, such as nausea or rash.'),
      severity: adverseEffectSeveritySchema,
      occurredAt: occurredAtOptionSchema
        .describe('Occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventAdverseEffectAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `${options.effect} after ${options.substance}`)
      const result = await appendHistoryEvent({
        ...(await buildCommonHistoryEventInput({
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        vaultRoot: options.vault,
        kind: 'adverse_effect',
        substance: options.substance,
        effect: options.effect,
        ...(options.severity ? { severity: options.severity } : {}),
      })

      return mapHistoryAddResult({
        vault: options.vault,
        kind: 'adverse_effect',
        result,
      })
    },
  })

  const exposure = Cli.create('exposure', {
    description: 'Typed exposure history event write commands.',
  })

  exposure.command('add', {
    description: 'Append one canonical exposure history event from typed fields.',
    args: z.object({}),
    options: withBaseOptions({
      exposureType: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Exposure type, such as environmental, food, or medication.'),
      substance: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .describe('Substance or agent involved in the exposure.'),
      duration: optionalEventStringSchema(120, 'Optional exposure duration string, such as 45 minutes.'),
      occurredAt: occurredAtOptionSchema
        .describe('Occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      title: eventTitleOptionSchema,
      note: eventNoteOptionSchema,
      tag: eventTagOptionSchema,
    }),
    output: eventExposureAddResultSchema,
    async run({ options }) {
      const title = deriveEventTitle(options.title, `Exposure: ${options.substance}`)
      const result = await appendHistoryEvent({
        ...(await buildCommonHistoryEventInput({
          vault: options.vault,
          occurredAt: options.occurredAt,
          source: options.source,
          title,
          note: options.note,
          tag: options.tag,
        })),
        vaultRoot: options.vault,
        kind: 'exposure',
        exposureType: options.exposureType,
        substance: options.substance,
        ...(options.duration ? { duration: options.duration } : {}),
      })

      return mapHistoryAddResult({
        vault: options.vault,
        kind: 'exposure',
        result,
      })
    },
  })

  event.command('import-jsonl', {
    description:
      'Import many canonical events from JSON Lines input in one transactional batch.',
    hint:
      'Each line is one canonical event payload in the same shape as import-json, except payloads must not carry explicit id or eventId fields. Run event payload-schema --for import-jsonl --kind <kind> --format json for the exact per-line contract. Runs as a dry-run count report by default; re-run with --apply to write. Rows with externalRef dedupe by system + resourceType + resourceId + facet; use --conflict-policy reject when identical replay may skip but changed content must not update an existing event. Rows without externalRef are append-only and create fresh events on each apply. Any invalid or rejected-conflict line rejects the whole batch.',
    args: z.object({}),
    options: withBaseOptions({
      input: inputFileOptionSchema.describe('JSON Lines input in @file.jsonl form or - for stdin.'),
      apply: z
        .boolean()
        .default(false)
        .describe('Apply the import. Without this flag the command only reports what it would create, skip, or update.'),
      conflictPolicy: z
        .enum(['supersede', 'reject'])
        .default('supersede')
        .describe('How changed content for an existing externalRef is handled. `supersede` updates in place; `reject` fails the whole batch while identical replays still skip.'),
    }),
    output: eventImportJsonlResultSchema,
    async run({ options }) {
      return importEventRecordsFromJsonl({
        vault: options.vault,
        inputFile: options.input,
        conflictPolicy: options.conflictPolicy,
        apply: options.apply,
      })
    },
  })

  registerFactoryCommand(
    event,
    createPayloadSchemaCommand({
      description: 'Emit an exact event payload schema for a supported file-backed import surface.',
      hint:
        'Use --for import-jsonl --kind <kind> to get the exact JSON object schema for one JSONL row. Each JSONL row must omit id and eventId. Include externalRef when the row should be retry-safe instead of append-only.',
      examples: [
        {
          description: 'Emit the per-line schema for symptom JSONL imports.',
          args: {},
          options: {
            for: 'import-jsonl',
            kind: 'symptom',
          },
        },
      ],
      options: {
        for: z
          .literal('import-jsonl')
          .default('import-jsonl')
          .describe('Import surface to describe. Currently only import-jsonl row payloads are supported.'),
        kind: publicEventWriteKindSchema.describe('Public writable event kind for one JSONL row.'),
      },
      resolve({ options }) {
        const schema = publicEventImportJsonlRowPayloadSchemasByKind[options.kind]

        return {
          command: 'event import-jsonl',
          lineSchemaName: `event-import-jsonl-row-${options.kind}`,
          mediaType: 'application/jsonl',
          schema,
        }
      },
    }),
  )

  event.command('dedupe-device-imports', {
    description:
      'Report duplicate device-imported events that share one provider record identity, and optionally tombstone all but the latest copy.',
    hint:
      'Runs as a dry-run report by default. Re-run with --apply to tombstone the duplicates; the latest copy of each record is kept.',
    args: z.object({}),
    options: withBaseOptions({
      apply: z
        .boolean()
        .default(false)
        .describe('Apply the cleanup. Without this flag the command only reports what it would tombstone.'),
    }),
    output: eventDedupeDeviceImportsResultSchema,
    async run({ options }) {
      return dedupeDeviceImportEventRecords({
        vault: options.vault,
        apply: options.apply,
      })
    },
  })

  event.command(encounter)
  event.command(procedure)
  event.command(adverseEffect)
  event.command(exposure)
  event.command(note)
  event.command(symptom)
  event.command(observation)
  event.command(medicationIntake)
  event.command(supplementIntake)

  cli.command(event)
}
