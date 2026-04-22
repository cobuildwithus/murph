import {
  EXPERIMENT_STATUSES,
  VAULT_LAYOUT,
  eventSourceSchema,
  experimentOutcomeSchema,
  experimentFrontmatterSchema,
  safeParseContract,
} from '@murphai/contracts'
import { stringifyFrontmatterDocument } from '@murphai/core'
import { z } from 'zod'
import {
  loadQueryRuntime,
  type QueryCanonicalEntity,
  type QueryRuntimeModule,
} from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  localDateSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  asListEnvelope,
  readJsonPayload,
  toListEntity,
} from './shared.js'
import {
  compactObject,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  toVaultCliError,
  toVaultMetadataCliError,
  stringArray,
  uniqueStrings,
} from './vault-usecase-helpers.js'
import { upsertEventRecord } from './provider-event.js'
import type { JsonObject } from '../health-cli-method-types.js'

type EntityFamily = 'experiment' | 'journal'
type JournalLinkKind = 'eventIds' | 'sampleStreams'
type JournalLinkOperation = 'link' | 'unlink'
type JournalLinkRuntimeInput = {
  vaultRoot: string
  date: string
  values: string[]
}
type JournalLinkRuntimeResult = {
  relativePath: string
  created: boolean
  changed: number
  eventIds: string[]
  sampleStreams: string[]
}
type JournalLinkRuntimeAction =
  | 'linkJournalEventIds'
  | 'unlinkJournalEventIds'
  | 'linkJournalStreams'
  | 'unlinkJournalStreams'

interface ExperimentJournalVaultCoreRuntime {
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: ExperimentStatusValue
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  updateExperiment(input: {
    vaultRoot: string
    relativePath: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: ExperimentStatusValue
    body?: string
    tags?: string[]
    protocolRef?: z.infer<typeof experimentFrontmatterSchema>['protocolRef'] | null
    runPlan?: z.infer<typeof experimentFrontmatterSchema>['runPlan'] | null
    analysisPlan?: z.infer<typeof experimentFrontmatterSchema>['analysisPlan'] | null
    onboarding?: z.infer<typeof experimentFrontmatterSchema>['onboarding'] | null
    assistantSupport?: z.infer<typeof experimentFrontmatterSchema>['assistantSupport'] | null
    outcome?: z.infer<typeof experimentFrontmatterSchema>['outcome'] | null
    outcomeRef?: z.infer<typeof experimentFrontmatterSchema>['outcomeRef'] | null
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    updated: true
  }>
  checkpointExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    eventId: string
    ledgerFile: string
    updated: true
  }>
  stopExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: ExperimentStatusValue
    eventId: string
    ledgerFile: string
    updated: true
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date?: string
  }): Promise<{
    created: boolean
    relativePath: string
  }>
  appendJournal(input: {
    vaultRoot: string
    date: string
    text: string
  }): Promise<{
    relativePath: string
    created: boolean
    updated: true
  }>
  linkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  linkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  updateVaultSummary(input: {
    vaultRoot: string
    title?: string
    timezone?: string
  }): Promise<{
    metadataFile: string
    corePath: string
    title: string
    timezone: string
    updatedAt: string
    updated: true
  }>
  applyCanonicalWriteBatch(input: {
    vaultRoot: string
    operationType: string
    summary: string
    occurredAt?: string
    audit: {
      action: string
      commandName: string
      summary: string
      targetIds?: string[]
    }
    textWrites?: Array<{
      relativePath: string
      content: string
      overwrite?: boolean
      allowExistingMatch?: boolean
    }>
  }): Promise<{
    textWrites: string[]
  }>
}

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
type ExperimentStatusValue = z.infer<typeof experimentStatusSchema>
const experimentSelectorPayloadSchema = z
  .object({
    lookup: z.string().min(1).optional(),
    experimentId: z.string().min(1).optional(),
    slug: slugSchema.optional(),
  })
  .refine(
    (value) =>
      typeof value.lookup === 'string' ||
      typeof value.experimentId === 'string' ||
      typeof value.slug === 'string',
    'Expected one of lookup, experimentId, or slug.',
  )
const experimentUpdatePayloadSchema = experimentSelectorPayloadSchema.extend({
  title: z.string().min(1).optional(),
  hypothesis: z.string().min(1).optional(),
  startedOn: localDateSchema.optional(),
  status: experimentStatusSchema.optional(),
  body: z.string().optional(),
  tags: z.array(slugSchema).optional(),
  protocolRef: experimentFrontmatterSchema.shape.protocolRef.nullable().optional(),
  runPlan: experimentFrontmatterSchema.shape.runPlan.nullable().optional(),
  analysisPlan: experimentFrontmatterSchema.shape.analysisPlan.nullable().optional(),
  onboarding: experimentFrontmatterSchema.shape.onboarding.nullable().optional(),
  assistantSupport: experimentFrontmatterSchema.shape.assistantSupport.nullable().optional(),
  outcome: experimentFrontmatterSchema.shape.outcome.nullable().optional(),
  outcomeRef: experimentFrontmatterSchema.shape.outcomeRef.nullable().optional(),
})
const experimentCheckpointPayloadSchema = experimentSelectorPayloadSchema.extend({
  occurredAt: isoTimestampSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
})
const experimentSessionPayloadSchema = z.object({
  occurredAt: isoTimestampSchema.optional(),
  source: eventSourceSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().optional(),
  interventionType: z.string().min(1).optional(),
  status: z.enum(['completed', 'partial', 'missed', 'skipped']).optional(),
  sessionStatus: z.enum(['completed', 'partial', 'missed', 'skipped']).optional(),
  durationMinutes: z.number().int().positive().optional(),
  protocolId: z.string().min(1).optional(),
  timing: z.string().min(1).max(120).optional(),
  temperatureC: z.number().min(0).max(200).optional(),
  afterExercise: z.boolean().optional(),
  symptoms: z.array(z.string().min(1).max(160)).max(25).optional(),
  confounders: z.union([
    z.array(z.string().min(1)),
    z.record(z.string(), z.union([z.string().min(1), z.number(), z.boolean(), z.null()])),
  ]).optional(),
})
const experimentSimpleContextPayloadSchema = z.object({
  occurredAt: isoTimestampSchema.optional(),
  source: eventSourceSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().optional(),
  contextType: z.string().min(1),
  severity: z.enum(['info', 'potential_confounder', 'safety', 'blocking']).optional(),
  tags: z.array(slugSchema).optional(),
})
const experimentContextPayloadSchema = z.union([
  experimentSimpleContextPayloadSchema,
  z.object({
    kind: z.literal('experiment_context'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    contextType: z.string().min(1),
    severity: z.enum(['info', 'potential_confounder', 'safety', 'blocking']).optional(),
    tags: z.array(slugSchema).optional(),
  }),
  z.object({
    kind: z.literal('note'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().min(1),
    tags: z.array(slugSchema).optional(),
  }),
  z.object({
    kind: z.literal('supplement_intake'),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    supplementName: z.string().min(1),
    dose: z.number().nonnegative(),
    unit: z.string().min(1),
    tags: z.array(slugSchema).optional(),
  }),
])
const JOURNAL_LINK_RUNTIME_ACTIONS: Record<
  JournalLinkKind,
  Record<JournalLinkOperation, JournalLinkRuntimeAction>
> = {
  eventIds: {
    link: 'linkJournalEventIds',
    unlink: 'unlinkJournalEventIds',
  },
  sampleStreams: {
    link: 'linkJournalStreams',
    unlink: 'unlinkJournalStreams',
  },
}

export async function createExperimentRecord(input: {
  vault: string
  slug: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: ExperimentStatusValue
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.createExperiment({
    vaultRoot: input.vault,
    slug: input.slug,
    title: normalizeOptionalText(input.title) ?? input.slug,
    hypothesis: normalizeOptionalText(input.hypothesis) ?? undefined,
    startedOn: input.startedOn,
    status: input.status ?? 'active',
  })

  return {
    vault: input.vault,
    experimentId: result.experiment.id,
    lookupId: result.experiment.id,
    slug: result.experiment.slug,
    experimentPath: result.experiment.relativePath,
    created: result.created ?? true,
  }
}

export async function updateExperimentRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = experimentUpdatePayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment payload'),
  )

  return updateExperimentRecord({
    vault: input.vault,
    lookup: experimentLookupFromPayload(payload),
    title: payload.title,
    hypothesis: payload.hypothesis,
    startedOn: payload.startedOn,
    status: payload.status,
    body: payload.body,
    tags: payload.tags,
    protocolRef: payload.protocolRef,
    runPlan: payload.runPlan,
    analysisPlan: payload.analysisPlan,
    onboarding: payload.onboarding,
    assistantSupport: payload.assistantSupport,
    outcome: payload.outcome,
    outcomeRef: payload.outcomeRef,
  })
}

export async function updateExperimentRecord(input: {
  vault: string
  lookup: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: ExperimentStatusValue
  body?: string
  tags?: string[]
  protocolRef?: z.infer<typeof experimentFrontmatterSchema>['protocolRef'] | null
  runPlan?: z.infer<typeof experimentFrontmatterSchema>['runPlan'] | null
  analysisPlan?: z.infer<typeof experimentFrontmatterSchema>['analysisPlan'] | null
  onboarding?: z.infer<typeof experimentFrontmatterSchema>['onboarding'] | null
  assistantSupport?: z.infer<typeof experimentFrontmatterSchema>['assistantSupport'] | null
  outcome?: z.infer<typeof experimentFrontmatterSchema>['outcome'] | null
  outcomeRef?: z.infer<typeof experimentFrontmatterSchema>['outcomeRef'] | null
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  try {
    const result = await core.updateExperiment({
      vaultRoot: input.vault,
      relativePath: entity.path,
      title: input.title,
      hypothesis: input.hypothesis,
      startedOn: input.startedOn,
      status: input.status,
      body: input.body,
      tags: input.tags,
      protocolRef: input.protocolRef,
      runPlan: input.runPlan,
      analysisPlan: input.analysisPlan,
      onboarding: input.onboarding,
      assistantSupport: input.assistantSupport,
      outcome: input.outcome,
      outcomeRef: input.outcomeRef,
    })

    return {
      vault: input.vault,
      experimentId: result.experimentId,
      lookupId: result.experimentId,
      slug: result.slug,
      experimentPath: result.relativePath,
      status: result.status,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error)
  }
}

export async function checkpointExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  title?: string
  note?: string
}) {
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    mode: 'checkpoint',
    occurredAt: input.occurredAt,
    title: input.title ?? 'Checkpoint',
    note: input.note,
  })
}

export async function checkpointExperimentRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = experimentCheckpointPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment payload'),
  )

  return checkpointExperimentRecord({
    vault: input.vault,
    lookup: experimentLookupFromPayload(payload),
    occurredAt: payload.occurredAt,
    title: payload.title,
    note: payload.note,
  })
}

export async function stopExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  note?: string
}) {
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    mode: 'stop',
    occurredAt: input.occurredAt,
    title: 'Stopped',
    note: input.note,
  })
}

function experimentLookupFromPayload(
  payload: z.infer<typeof experimentSelectorPayloadSchema>,
) {
  return payload.lookup ?? payload.experimentId ?? payload.slug ?? ''
}

export async function showExperimentRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'experiment')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listExperimentRecords(input: {
  vault: string
  status?: ExperimentStatusValue
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['experiment'],
      statuses: input.status ? [input.status] : undefined,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return asListEnvelope(input.vault, {
    status: input.status ?? null,
    limit: input.limit,
  }, items)
}

export async function logExperimentSessionRecordFromInput(input: {
  vault: string
  lookup: string
  inputFile: string
}) {
  const payload = experimentSessionPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment session payload'),
  )

  return logExperimentSessionRecord({
    vault: input.vault,
    lookup: input.lookup,
    ...payload,
  })
}

export async function logExperimentSessionRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  source?: z.infer<typeof eventSourceSchema>
  title?: string
  note?: string
  interventionType?: string
  status?: 'completed' | 'partial' | 'missed' | 'skipped'
  sessionStatus?: 'completed' | 'partial' | 'missed' | 'skipped'
  durationMinutes?: number
  protocolId?: string
  timing?: string
  temperatureC?: number
  afterExercise?: boolean
  symptoms?: string[]
  confounders?: string[] | Record<string, string | number | boolean | null>
}) {
  const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const frontmatter = requireExperimentFrontmatter(experiment)
  const interventionType =
    slugifyExperimentValue(input.interventionType) ??
    slugifyExperimentValue(frontmatter.runPlan?.modality) ??
    inferExperimentInterventionType(frontmatter.protocolRef?.key)

  if (!interventionType) {
    throw new VaultCliError(
      'invalid_payload',
      'Experiment session logging requires interventionType or runPlan.modality.',
    )
  }

  const title = normalizeOptionalText(input.title) ?? buildExperimentSessionTitle({
    durationMinutes: input.durationMinutes,
    interventionType,
  })
  const event = await upsertEventRecord({
    vault: input.vault,
    payload: compactObject({
      kind: 'intervention_session',
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      source: input.source ?? 'manual',
      title,
      note: normalizeOptionalText(input.note) ?? undefined,
      experimentId: frontmatter.experimentId,
      experimentSlug: frontmatter.slug,
      links: [{ type: 'related_to', targetId: frontmatter.experimentId }],
      interventionType,
      durationMinutes: input.durationMinutes,
      protocolId: normalizeOptionalText(input.protocolId) ?? undefined,
      sessionStatus: input.sessionStatus ?? input.status ?? 'completed',
      timing: normalizeOptionalText(input.timing) ?? undefined,
      temperatureC: input.temperatureC,
      afterExercise: input.afterExercise,
      symptoms: normalizeExperimentFreeTextList(input.symptoms, 160),
      confounders: normalizeExperimentConfounders(input.confounders),
    }) as JsonObject,
  })

  return {
    vault: input.vault,
    experimentId: frontmatter.experimentId,
    lookupId: frontmatter.experimentId,
    slug: frontmatter.slug,
    eventId: event.eventId,
    ledgerFile: event.ledgerFile,
    created: event.created,
    kind: 'intervention_session' as const,
  }
}

export async function logExperimentContextRecordFromInput(input: {
  vault: string
  lookup: string
  inputFile: string
}) {
  const payload = experimentContextPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment context payload'),
  )

  return logExperimentContextRecord({
    vault: input.vault,
    lookup: input.lookup,
    payload,
  })
}

export async function logExperimentContextRecord(input: {
  vault: string
  lookup: string
  payload: z.infer<typeof experimentContextPayloadSchema>
}) {
  const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const frontmatter = requireExperimentFrontmatter(experiment)
  const payload = input.payload
  const occurredAt = payload.occurredAt ?? new Date().toISOString()
  const source = payload.source ?? 'manual'

  const base = {
    occurredAt,
    source,
    experimentId: frontmatter.experimentId,
    experimentSlug: frontmatter.slug,
    links: [{ type: 'related_to', targetId: frontmatter.experimentId }],
    note: normalizeOptionalText(payload.note) ?? undefined,
    tags: 'tags' in payload ? payload.tags : undefined,
  }

  const event = await upsertEventRecord({
    vault: input.vault,
    payload: (() => {
      if (!('kind' in payload) || payload.kind === 'experiment_context') {
        const contextType = slugifyExperimentValue(payload.contextType)
        if (!contextType) {
          throw new VaultCliError(
            'invalid_payload',
            'Experiment context logging requires a usable contextType.',
          )
        }

        return compactObject({
          kind: 'experiment_context',
          ...base,
          title:
            normalizeOptionalText(payload.title) ??
            `${contextType.replace(/-/gu, ' ')} context (${frontmatter.slug})`,
          contextType,
          severity: payload.severity ?? 'potential_confounder',
        })
      }

      switch (payload.kind) {
        case 'note':
          return compactObject({
            kind: 'note',
            ...base,
            title:
              normalizeOptionalText(payload.title) ??
              `Experiment context note (${frontmatter.slug})`,
            note: payload.note,
          })
        case 'supplement_intake':
          return compactObject({
            kind: 'supplement_intake',
            ...base,
            title:
              normalizeOptionalText(payload.title) ??
              `${payload.supplementName} logged for ${frontmatter.slug}`,
            supplementName: payload.supplementName,
            dose: payload.dose,
            unit: payload.unit,
          })
      }
    })() as JsonObject,
  })

  return {
    vault: input.vault,
    experimentId: frontmatter.experimentId,
    lookupId: frontmatter.experimentId,
    slug: frontmatter.slug,
    eventId: event.eventId,
    ledgerFile: event.ledgerFile,
    created: event.created,
    kind: 'kind' in payload ? payload.kind : 'experiment_context',
  }
}

export async function showExperimentProgress(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const entity = query.lookupEntityById(readModel, input.lookup)

  if (!entity || entity.family !== 'experiment') {
    throw new VaultCliError('not_found', `No experiment found for "${input.lookup}".`)
  }

  const slug = entity.experimentSlug ?? stringOrNull(entity.attributes.slug)
  if (!slug) {
    throw new VaultCliError('invalid_payload', 'Experiment progress requires a canonical slug.')
  }

  const progress = query.summarizeExperimentProgress(readModel, slug, {
    asOf: input.asOf,
  })

  return {
    vault: input.vault,
    experimentId: entity.entityId,
    lookupId: entity.entityId,
    slug,
    asOf: progress.asOf,
    progress,
  }
}

export async function analyzeExperimentOutcomeRecord(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const entity = query.lookupEntityById(readModel, input.lookup)

  if (!entity || entity.family !== 'experiment') {
    throw new VaultCliError('not_found', `No experiment found for "${input.lookup}".`)
  }

  const slug = entity.experimentSlug ?? stringOrNull(entity.attributes.slug)
  if (!slug) {
    throw new VaultCliError('invalid_payload', 'Experiment outcome analysis requires a canonical slug.')
  }

  const outcome = query.analyzeExperimentOutcome(readModel, slug, {
    asOf: input.asOf,
  })

  return {
    vault: input.vault,
    experimentId: entity.entityId,
    lookupId: entity.entityId,
    slug,
    asOf: outcome.asOf,
    outcome,
  }
}

export async function writeExperimentOutcomeRecord(input: {
  vault: string
  lookup: string
  asOf?: string
}) {
  const analysis = await analyzeExperimentOutcomeRecord(input)
  const experiment = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const frontmatter = requireExperimentFrontmatter(experiment)
  const generatedAt = new Date().toISOString()
  const validatedOutcome = experimentOutcomeSchema.parse({
    ...analysis.outcome,
    generatedAt,
  })
  const outcomeId =
    validatedOutcome.outcomeId ??
    `${frontmatter.experimentId}-outcome-${analysis.asOf}`
  const outcomePath = `${VAULT_LAYOUT.experimentsDirectory}/outcomes/${frontmatter.slug}-${analysis.asOf}.json`
  const core = await loadExperimentJournalVaultCoreRuntime()
  const nextFrontmatter = experimentFrontmatterSchema.parse({
    ...frontmatter,
    outcome: {
      ...frontmatter.outcome,
      latestOutcomeId: outcomeId,
      readyForReviewAt:
        frontmatter.outcome?.readyForReviewAt ??
        generatedAt,
      finalAnalysisStatus: 'generated' as const,
    },
    outcomeRef: {
      outcomeId,
      generatedAt,
      relativePath: outcomePath,
    },
  })
  const serializedFrontmatterAttributes = JSON.parse(
    JSON.stringify(nextFrontmatter),
  ) as NonNullable<Parameters<typeof stringifyFrontmatterDocument>[0]>['attributes']
  const nextExperimentMarkdown = stringifyFrontmatterDocument({
    attributes: serializedFrontmatterAttributes,
    body: experiment.body ?? '',
  })

  try {
    await core.applyCanonicalWriteBatch({
      vaultRoot: input.vault,
      operationType: 'experiment_outcome_write',
      summary: `Write experiment outcome ${validatedOutcome.outcomeId ?? `${frontmatter.experimentId}-outcome-${analysis.asOf}`}`,
      occurredAt: validatedOutcome.generatedAt,
      audit: {
        action: 'experiment_update',
        commandName: 'vault-cli experiment outcome write',
        summary: `Wrote outcome analysis for experiment ${frontmatter.experimentId}.`,
        targetIds: [frontmatter.experimentId],
      },
      textWrites: [
        {
          relativePath: outcomePath,
          content: `${JSON.stringify(validatedOutcome, null, 2)}\n`,
          overwrite: true,
        },
        {
          relativePath: experiment.path,
          content: nextExperimentMarkdown,
          overwrite: true,
        },
      ],
    })
  } catch (error) {
    throw toVaultCliError(error)
  }

  return {
    ...analysis,
    outcome: {
      ...validatedOutcome,
      outcomeId,
      schema: validatedOutcome.schema ?? validatedOutcome.schemaVersion,
    },
    outcomePath,
    updatedExperiment: true,
  }
}

export async function ensureJournalRecord(input: {
  vault: string
  date: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.ensureJournalDay({
    vaultRoot: input.vault,
    date: input.date,
  })

  return {
    vault: input.vault,
    lookupId: `journal:${input.date}`,
    created: result.created,
    journalPath: result.relativePath,
  }
}

export async function appendJournalText(input: {
  vault: string
  date: string
  text: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const result = await core.appendJournal({
      vaultRoot: input.vault,
      date: input.date,
      text: input.text,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
  }
}

export async function linkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'eventIds',
    values: input.eventIds,
    operation: 'link',
  })
}

export async function unlinkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'eventIds',
    values: input.eventIds,
    operation: 'unlink',
  })
}

export async function linkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'link',
  })
}

export async function unlinkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    kind: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'unlink',
  })
}

export async function showJournalRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'journal')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listJournalRecords(input: {
  vault: string
  from?: string
  to?: string
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['journal'],
      from: input.from,
      to: input.to,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return asListEnvelope(input.vault, {
    kind: 'journal_day',
    from: input.from,
    to: input.to,
    limit: input.limit,
  }, items)
}

export async function showVaultSummary(vault: string) {
  const readModel = await readExperimentJournalVault(vault)
  const metadata = readModel.metadata

  return {
    vault,
    formatVersion: resolveVaultFormatVersion(metadata),
    vaultId: stringOrNull(metadata?.vaultId),
    title: stringOrNull(metadata?.title),
    timezone: stringOrNull(metadata?.timezone),
    createdAt: normalizeIsoTimestamp(stringOrNull(metadata?.createdAt)),
    corePath: readModel.coreDocument?.path ?? null,
    coreTitle: readModel.coreDocument?.title ?? null,
    coreUpdatedAt: normalizeIsoTimestamp(readModel.coreDocument?.occurredAt),
  }
}

function resolveVaultFormatVersion(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return null
  }

  return typeof metadata.formatVersion === 'number' && Number.isInteger(metadata.formatVersion)
    ? metadata.formatVersion
    : null
}

export async function updateVaultSummary(input: {
  vault: string
  title?: string
  timezone?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const result = await core.updateVaultSummary({
      vaultRoot: input.vault,
      title: input.title,
      timezone: input.timezone,
    })

    return {
      vault: input.vault,
      metadataFile: result.metadataFile,
      corePath: result.corePath,
      title: result.title,
      timezone: result.timezone,
      updatedAt: result.updatedAt,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error)
  }
}

export async function showVaultStats(vault: string) {
  const readModel = await readExperimentJournalVault(vault)

  return {
    vault,
    counts: {
      totalRecords: readModel.entities.length,
      experiments: readModel.experiments.length,
      journalEntries: readModel.journalEntries.length,
      events: readModel.events.length,
      samples: readModel.samples.length,
      audits: readModel.audits.length,
      assessments: readModel.assessments.length,
      goals: readModel.goals.length,
      conditions: readModel.conditions.length,
      allergies: readModel.allergies.length,
      protocols: readModel.protocols.length,
      familyMembers: readModel.familyMembers.length,
      geneticVariants: readModel.geneticVariants.length,
    },
    latest: {
      eventOccurredAt: latestIsoTimestamp(readModel.events),
      sampleOccurredAt: latestIsoTimestamp(readModel.samples),
      journalDate: latestDate(readModel.journalEntries),
      experimentTitle: readModel.experiments.at(-1)?.title ?? null,
    },
  }
}

async function appendExperimentLifecycleEvent(input: {
  vault: string
  lookup: string
  occurredAt?: string
  title: string
  note?: string
  mode: 'checkpoint' | 'stop'
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')

  try {
    const result =
      input.mode === 'checkpoint'
        ? await core.checkpointExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })
        : await core.stopExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })

    return {
      vault: input.vault,
      experimentId: result.experimentId,
      lookupId: result.experimentId,
      slug: result.slug,
      experimentPath: result.relativePath,
      status: result.status,
      eventId: result.eventId,
      ledgerFile: result.ledgerFile,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      INVALID_TIMESTAMP: {
        code: 'invalid_timestamp',
      },
    })
  }
}

async function mutateJournalLinks(input: {
  vault: string
  date: string
  kind: JournalLinkKind
  values: string[]
  operation: JournalLinkOperation
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const action = JOURNAL_LINK_RUNTIME_ACTIONS[input.kind][input.operation]
    const result = await core[action]({
      vaultRoot: input.vault,
      date: input.date,
      values: input.values,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      changed: result.changed,
      eventIds: result.eventIds,
      sampleStreams: result.sampleStreams,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
  }
}

async function requireEntityFamily(
  vault: string,
  lookup: string,
  family: EntityFamily,
) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await readExperimentJournalVault(vault)
  const entity = query.lookupEntityById(readModel, lookup)

  if (!entity || entity.family !== family) {
    throw new VaultCliError('not_found', `No ${family} found for "${lookup}".`, {
      family,
      lookup,
    })
  }

  return entity
}

function toShowEntity(entity: QueryCanonicalEntity) {
  return {
    id: entity.entityId,
    kind: entity.kind,
    title: entity.title ?? null,
    occurredAt: normalizeIsoTimestamp(entity.occurredAt),
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: buildEntityData(entity),
    links: buildEntityLinks(entity),
  }
}

function toListItem(entity: QueryCanonicalEntity) {
  return toListEntity({
    id: entity.entityId,
    kind: entity.kind,
    title: entity.title ?? null,
    occurredAt: normalizeIsoTimestamp(entity.occurredAt),
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: buildEntityData(entity),
    links: buildEntityLinks(entity),
  })
}

function buildEntityData(entity: QueryCanonicalEntity) {
  return compactObject({
    ...entity.attributes,
    status:
      typeof entity.attributes.status === 'string'
        ? entity.attributes.status
        : entity.status,
    experimentSlug:
      typeof entity.attributes.experimentSlug === 'string'
        ? undefined
        : entity.experimentSlug,
    relatedIds:
      Array.isArray(entity.attributes.relatedIds) &&
      entity.attributes.relatedIds.length > 0
        ? undefined
        : entity.relatedIds,
  })
}

function buildEntityLinks(entity: QueryCanonicalEntity) {
  const links = uniqueStrings([
    ...entity.relatedIds,
    ...stringArray(entity.attributes.eventIds),
  ])

  return links.map((id) => ({
    id,
    kind: inferVaultLinkKind(id),
    queryable: isVaultQueryableRecordId(id),
  }))
}

async function loadExperimentJournalVaultQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadQueryRuntime()
}

async function readExperimentJournalVault(vault: string) {
  const query = await loadExperimentJournalVaultQueryRuntime()

  try {
    return await query.readVault(vault)
  } catch (error) {
    throw toVaultMetadataCliError(error)
  }
}

async function loadExperimentJournalVaultCoreRuntime(): Promise<ExperimentJournalVaultCoreRuntime> {
  return loadRuntimeModule<ExperimentJournalVaultCoreRuntime>('@murphai/core')
}

function latestIsoTimestamp(records: readonly QueryCanonicalEntity[]) {
  const latest = [...records]
    .map((record) => normalizeIsoTimestamp(record.occurredAt))
    .filter((value): value is string => value !== null)
    .at(-1)

  return latest ?? null
}

function latestDate(records: readonly QueryCanonicalEntity[]) {
  const latest = [...records]
    .map((record) => record.date)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .at(-1)

  return latest ?? null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireExperimentFrontmatter(entity: QueryCanonicalEntity) {
  const result = safeParseContract(experimentFrontmatterSchema, entity.attributes)

  if (!result.success) {
    throw new VaultCliError(
      'invalid_payload',
      `Experiment "${entity.entityId}" has invalid frontmatter for rich experiment operations.`,
    )
  }

  return result.data
}

function slugifyExperimentValue(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value ?? undefined)
  if (!normalized) {
    return null
  }

  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return slug.length > 0 ? slug : null
}

function slugifyExperimentValueList(values: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = values
    .map((value) => slugifyExperimentValue(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined
}

function normalizeExperimentFreeTextList(
  values: readonly string[] | undefined,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = uniqueStrings(values
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.slice(0, maxLength)))

  return normalized.length > 0 ? normalized : undefined
}

function normalizeExperimentConfounders(
  value: string[] | Record<string, string | number | boolean | null> | undefined,
) {
  if (Array.isArray(value)) {
    return slugifyExperimentValueList(value)
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const normalized: Record<string, string | number | boolean | null> = {}

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeOptionalText(key)
    if (!normalizedKey) {
      continue
    }

    if (typeof entry === 'string') {
      const normalizedValue = normalizeOptionalText(entry)
      if (normalizedValue) {
        normalized[normalizedKey] = normalizedValue
      }
      continue
    }

    if (
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      normalized[normalizedKey] = entry
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function inferExperimentInterventionType(protocolKey: string | undefined): string | null {
  const normalized = normalizeOptionalText(protocolKey)?.toLowerCase() ?? null
  if (!normalized) {
    return null
  }

  if (normalized.includes('sauna')) {
    return 'sauna'
  }

  if (normalized.includes('magnesium')) {
    return 'magnesium'
  }

  const tail = normalized.split('/').at(-1) ?? normalized
  return slugifyExperimentValue(tail)
}

function buildExperimentSessionTitle(input: {
  durationMinutes?: number
  interventionType: string
}) {
  const label = input.interventionType.replace(/-/gu, ' ')
  if (typeof input.durationMinutes === 'number') {
    return `${input.durationMinutes}-minute ${label}`
  }

  return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} session`
}
