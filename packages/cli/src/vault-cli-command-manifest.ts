import { Cli, z } from 'incur'
import {
  createHealthScaffoldResultSchema,
  hasHealthCommandDescriptor,
  healthEntityDescriptorByCommandName,
  healthListResultSchema,
  healthShowResultSchema,
  type HealthCommandDescriptorEntry,
} from '@murphai/vault-usecases'
import {
  exerciseFacetsResultSchema,
  exerciseListResultSchema,
  exerciseShowResultSchema,
  listResultSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases'
import type {
  CliVaultServices,
  DeviceSyncServices,
} from './device-services.js'
import { ensureCliVaultServices } from './device-services.js'
import { registerAssistantCommands } from '@murphai/assistant-cli/commands/assistant'
import { registerAuditCommands } from './commands/audit.js'
import { registerAutomationCommands } from './commands/automation.js'
import {
  batchRunResultSchema,
  registerBatchCommands,
} from './commands/batch.js'
import {
  captureCommandDescriptions,
  registerCaptureCommands,
} from './commands/capture.js'
import {
  payloadSchemaEnvelopeSchema,
} from './commands/command-factory-primitives.js'
import {
  commonsProtocolExploreResultSchema,
  commonsProtocolListResultSchema,
  commonsProtocolShowResultSchema,
  registerCommonsCommands,
} from './commands/commons.js'
import {
  assertionScaffoldResultSchema,
  clinicalImportResultSchema,
  clinicalNoteScaffoldResultSchema,
  diagnosticTestScaffoldResultSchema,
  registerAssertionCommands,
  registerClinicalNoteCommands,
  registerDiagnosticTestCommands,
  registerSocialHistoryCommands,
  registerVitalsCommands,
  socialHistoryScaffoldResultSchema,
  vitalsScaffoldResultSchema,
} from './commands/clinical-imports.js'
import { payloadSchemaResultSchema } from './commands/payload-schema-command.js'
import { registerDeviceCommands } from './commands/device.js'
import { registerDocumentCommands } from './commands/document.js'
import {
  encounterCommandDescriptions,
  encounterImportResultSchema,
  encounterScaffoldResultSchema,
  registerEncounterCommands,
} from './commands/encounter.js'
import { registerEventCommands } from './commands/event.js'
import { registerExerciseCommands } from './commands/exercise.js'
import { registerExperimentCommands } from './commands/experiment.js'
import { registerInterventionCommands } from './commands/intervention.js'
import { registerExportCommands } from './commands/export.js'
import {
  createHealthJsonImportResultSchema,
} from './commands/health-entity-command-registry.js'
import {
  allergySaveResultSchema,
  registerAllergyCommands,
} from './commands/health-allergy-save.js'
import {
  bloodTestSaveResultSchema,
  registerBloodTestCommands,
} from './commands/health-blood-test-save.js'
import {
  familySaveResultSchema,
  registerFamilyCommands,
} from './commands/health-family-save.js'
import {
  conditionSaveResultSchema,
  registerConditionCommands,
} from './commands/health-condition-save.js'
import {
  goalSaveResultSchema,
  registerGoalCommands,
} from './commands/health-goal-save.js'
import {
  geneticsSaveResultSchema,
  registerGeneticsCommands,
} from './commands/health-genetics-save.js'
import {
  immunizationSaveResultSchema,
  registerImmunizationCommands,
} from './commands/health-immunization-save.js'
import { registerHabitatCommands } from './commands/habitat.js'
import { registerIntakeCommands } from './commands/intake.js'
import { registerJournalCommands } from './commands/journal.js'
import { registerMemoryCommands } from './commands/memory.js'
import {
  medicationHistoryResultSchema,
  registerMedicationCommands,
} from './commands/medication.js'
import { registerMealCommands } from './commands/meal.js'
import {
  measurementCommandDescriptions,
  registerMeasurementCommands,
} from './commands/measurement.js'
import { registerRecipeCommands } from './commands/recipe.js'
import { registerProviderCommands } from './commands/provider.js'
import { registerFoodCommands } from './commands/food.js'
import {
  foodLabelBatchSearchResultSchema,
  foodLabelSearchResultSchema,
} from './food-labels.js'
import { registerResearchCommands } from './commands/research.js'
import {
  RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE,
  researchScoutResultSchema,
} from './research-scout.js'
import { registerRouteCommands } from './commands/route.js'
import {
  knowledgeChallengeScoreCommandDescription,
} from './commands/knowledge-challenge-score.js'
import { registerKnowledgeCommands } from './commands/knowledge.js'
import { registerModelCommands } from './commands/model.js'
import {
  murphAgeInputReadinessResultSchema,
  murphAgeModelCardStatusResultSchema,
  murphAgeReportResultSchema,
  murphAgeSubmittedPreviewPayloadSchema,
  registerMurphAgeCommands,
} from './commands/murph-age.js'
import { mapboxRouteEstimateResultSchema } from './mapbox-route.js'
import {
  supplementLabelBatchSearchResultSchema,
  supplementLabelSearchResultSchema,
} from './supplement-labels.js'
import {
  groupChallengeScoreResultSchema,
} from '@murphai/assistant-engine'
import {
  knowledgeGetResultSchema as knowledgeShowResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeLogTailResultSchema,
  knowledgeSearchResultSchema,
  knowledgeUpsertResultSchema,
} from '@murphai/query'
import { registerReadCommands } from './commands/read.js'
import { registerProtocolCommands } from './commands/protocol.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerSearchCommands } from './commands/search.js'
import {
  registerScheduledLogCommands,
  scheduledLogListResultSchema,
  scheduledLogScaffoldResultSchema,
  scheduledLogShowResultSchema,
  scheduledLogStatusResultSchema,
  scheduledLogWriteResultSchema,
} from './commands/scheduled-log.js'
import { registerSupplementCommands } from './commands/supplement.js'
import { registerVaultCommands } from './commands/vault.js'
import {
  registerWorkoutCommands,
} from './commands/workout.js'
import {
  registerWearablesCommands,
  wearablesActivityListResultSchema,
  wearablesBodyStateListResultSchema,
  wearablesDayResultSchema,
  wearablesDriftResultSchema,
  wearablesPersonalPatternsResultSchema,
  wearablesLatestResultSchema,
  wearablesMetricLatestResultSchema,
  wearablesMetricTrendResultSchema,
  wearablesRecoveryListResultSchema,
  wearablesSleepListResultSchema,
  wearablesSleepPatternResultSchema,
  wearablesSourcesListResultSchema,
} from './commands/wearables.js'

type VaultServiceGroups = {
  core: VaultServices['core']
  importers: VaultServices['importers']
  query: VaultServices['query']
  devices: DeviceSyncServices
}
type VaultServiceGroupName = Extract<keyof VaultServiceGroups, string>
type CommandExample = Readonly<Record<string, unknown>>
type DirectVaultServiceBindings = {
  [TGroupName in VaultServiceGroupName]?: ReadonlyArray<
    Extract<keyof VaultServiceGroups[TGroupName], string>
  >
}

export interface VaultCliLeafCommandDescriptor {
  path: readonly [string, ...string[]]
  description: string
  examples?: readonly CommandExample[]
  hint?: string
  output?: z.ZodType<unknown>
}

interface BaseVaultCliCommandDescriptor {
  id: string
  rootCommandNames: readonly [string, ...string[]]
  leafCommands?: readonly VaultCliLeafCommandDescriptor[]
  register(input: {
    cli: Cli.Cli
    services: CliVaultServices
    inboxServices: InboxServices
  }): void
}

interface DirectBindingCommandDescriptor extends BaseVaultCliCommandDescriptor {
  bindingMode: 'direct'
  directVaultServiceBindings?: DirectVaultServiceBindings
}

interface NonDirectBindingCommandDescriptor extends BaseVaultCliCommandDescriptor {
  bindingMode: 'indirect' | 'none'
}

export type VaultCliCommandDescriptor =
  | DirectBindingCommandDescriptor
  | NonDirectBindingCommandDescriptor

export interface CollectedVaultCliDirectServiceBindings {
  vault: {
    [TGroupName in VaultServiceGroupName]: ReadonlyArray<
      Extract<keyof VaultServiceGroups[TGroupName], string>
    >
  }
}

const genericHealthRootCommandNames = [
  'goal',
  'condition',
  'allergy',
  'blood-test',
  'immunization',
  'family',
  'genetics',
] as const
type GenericHealthRootCommandName = typeof genericHealthRootCommandNames[number]
function orderedUniqueStrings<TValue extends string>(
  values: readonly TValue[],
): TValue[] {
  const seen = new Set<string>()
  const uniqueValues: TValue[] = []

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      uniqueValues.push(value)
    }
  }

  return uniqueValues
}

function requireHealthCommandDescriptor(
  commandName: string,
): HealthCommandDescriptorEntry {
  const descriptor = healthEntityDescriptorByCommandName.get(commandName)

  if (!descriptor || !hasHealthCommandDescriptor(descriptor)) {
    throw new Error(`No health command descriptor exists for "${commandName}".`)
  }

  return descriptor
}

function createHealthLeafCommands(
  descriptor: HealthCommandDescriptorEntry,
): readonly VaultCliLeafCommandDescriptor[] {
  const leafCommands: VaultCliLeafCommandDescriptor[] = [
    {
      path: [descriptor.command.commandName, 'list'],
      description: descriptor.command.descriptions.list,
      examples: descriptor.command.examples?.list,
      hint: descriptor.command.hints?.list,
      output: healthListResultSchema,
    },
    {
      path: [descriptor.command.commandName, 'scaffold'],
      description: descriptor.command.descriptions.scaffold,
      examples: descriptor.command.examples?.scaffold,
      hint: descriptor.command.hints?.scaffold,
      output: createHealthScaffoldResultSchema(descriptor.core.scaffoldNoun),
    },
    {
      path: [descriptor.command.commandName, 'show'],
      description: descriptor.command.descriptions.show,
      examples: descriptor.command.examples?.show,
      hint: descriptor.command.hints?.show,
      output: healthShowResultSchema,
    },
  ]

  leafCommands.push({
    path: [descriptor.command.commandName, 'import-json'],
    description: `Import one ${descriptor.noun} from a JSON payload file or stdin.`,
    examples: [
      {
        description: `Import one ${descriptor.noun} from a JSON payload file.`,
        options: {
          input: `@${descriptor.command.payloadFile}`,
          vault: './vault',
        },
      },
    ],
    hint: descriptor.core.payloadSchema
      ? `Use --input @file.json or -. Run ${descriptor.command.commandName} payload-schema --format json for the exact file-body contract, or ${descriptor.command.commandName} scaffold for a representative starter payload.`
      : `Use --input @file.json or -. Run ${descriptor.command.commandName} scaffold for a representative starter payload.`,
    output: createHealthJsonImportResultSchema(descriptor),
  })

  if (descriptor.core.payloadSchema) {
    leafCommands.push({
      path: [descriptor.command.commandName, 'payload-schema'],
      description: `Emit the exact JSON payload schema for ${descriptor.command.commandName} import-json.`,
      hint: `Use this for the exact file-body contract; use ${descriptor.command.commandName} scaffold for a representative starter payload.`,
      output: payloadSchemaEnvelopeSchema,
    })
  }

  return leafCommands
}

function mergeDirectVaultServiceBindings(
  ...bindings: Array<DirectVaultServiceBindings | undefined>
): DirectVaultServiceBindings | undefined {
  const mergedBindings: Partial<Record<VaultServiceGroupName, string[]>> = {}

  for (const binding of bindings) {
    if (!binding) {
      continue
    }

    for (const [groupName, methodNames] of Object.entries(binding) as Array<
      [VaultServiceGroupName, readonly string[]]
    >) {
      const existingMethodNames = mergedBindings[groupName] ?? []
      mergedBindings[groupName] = orderedUniqueStrings([
        ...existingMethodNames,
        ...methodNames,
      ])
    }
  }

  if (Object.keys(mergedBindings).length === 0) {
    return undefined
  }

  return mergedBindings as DirectVaultServiceBindings
}

function assumeDirectVaultServiceBindings(
  bindings: Readonly<Record<string, readonly string[]>>,
): DirectVaultServiceBindings {
  return bindings as DirectVaultServiceBindings
}

function buildHealthCommandManifestDescriptor(input: {
  commandName: string
  register: DirectBindingCommandDescriptor['register']
  additionalVaultServiceBindings?: DirectVaultServiceBindings
  additionalLeafCommands?: readonly VaultCliLeafCommandDescriptor[]
}): DirectBindingCommandDescriptor {
  const descriptor = requireHealthCommandDescriptor(input.commandName)

  return {
    id: `health:${input.commandName}`,
    bindingMode: 'direct',
    rootCommandNames: [input.commandName],
    leafCommands: [
      ...createHealthLeafCommands(descriptor),
      ...(input.additionalLeafCommands ?? []),
    ],
    directVaultServiceBindings: mergeDirectVaultServiceBindings(
      {
        core: [
          descriptor.core.scaffoldServiceMethod,
          descriptor.core.upsertServiceMethod,
        ],
        query: [
          descriptor.query.showServiceMethod,
          descriptor.query.listServiceMethod,
        ],
      },
      input.additionalVaultServiceBindings,
    ),
    register: input.register,
  }
}

const typedHealthSaveCommands = {
  goal: {
    description: 'Create or update one goal from typed command fields.',
    output: goalSaveResultSchema,
    register: registerGoalCommands,
  },
  condition: {
    description: 'Create or update one condition from typed command fields.',
    output: conditionSaveResultSchema,
    register: registerConditionCommands,
  },
  allergy: {
    description: 'Create or update one allergy from typed command fields.',
    output: allergySaveResultSchema,
    register: registerAllergyCommands,
  },
  'blood-test': {
    description: 'Create or update one blood-test event from typed command fields.',
    output: bloodTestSaveResultSchema,
    register: registerBloodTestCommands,
  },
  immunization: {
    description: 'Create one immunization event from typed command fields.',
    output: immunizationSaveResultSchema,
    register: registerImmunizationCommands,
  },
  family: {
    description: 'Create or update one family member from typed command fields.',
    output: familySaveResultSchema,
    register: registerFamilyCommands,
  },
  genetics: {
    description: 'Create or update one genetic variant from typed command fields.',
    output: geneticsSaveResultSchema,
    register: registerGeneticsCommands,
  },
} satisfies Record<
  GenericHealthRootCommandName,
  {
    description: string
    output: z.ZodType<unknown>
    register(cli: Cli.Cli, services: VaultServices): void
  }
>

const genericHealthCommandDescriptors = genericHealthRootCommandNames.map(
  (commandName) =>
    buildHealthCommandManifestDescriptor({
      commandName,
      additionalLeafCommands: createTypedHealthSaveLeafCommands(commandName),
      register({ cli, services }) {
        registerHealthCommands(cli, services, commandName)
      },
    }),
)

function createTypedHealthSaveLeafCommands(
  commandName: GenericHealthRootCommandName,
): readonly VaultCliLeafCommandDescriptor[] | undefined {
  const command = typedHealthSaveCommands[commandName]
  return [
    {
      path: [commandName, 'save'],
      description: command.description,
      output: command.output,
    },
  ]
}

function registerHealthCommands(
  cli: Cli.Cli,
  services: VaultServices,
  commandName: GenericHealthRootCommandName,
) {
  typedHealthSaveCommands[commandName].register(cli, services)
}

function createClinicalImportLeafCommands(input: {
  root: string
  scaffoldOutput: z.ZodType<unknown>
  includeSave?: boolean
}): readonly VaultCliLeafCommandDescriptor[] {
  return [
    {
      path: [input.root, 'scaffold'],
      description: `Emit a representative ${input.root} import payload.`,
      output: input.scaffoldOutput,
    },
    ...(input.includeSave
      ? [{
          path: [input.root, 'save'] as const,
          description: `Save one ${input.root} record from typed command options.`,
          output: clinicalImportResultSchema,
        }]
      : []),
    {
      path: [input.root, 'import-json'],
      description: `Import ${input.root} data from a JSON payload file or stdin.`,
      hint: `Run ${input.root} payload-schema for the writable contract and ${input.root} scaffold for a representative example.`,
      output: clinicalImportResultSchema,
    },
    {
      path: [input.root, 'payload-schema'],
      description: `Emit the exact JSON payload schema for ${input.root} import-json.`,
      output: payloadSchemaResultSchema,
    },
  ]
}

export const vaultCliCommandDescriptors = [
  {
    id: 'vault',
    bindingMode: 'direct',
    rootCommandNames: ['init', 'validate', 'vault'],
    directVaultServiceBindings: {
      core: [
        'init',
        'validate',
        'updateVault',
        'repairVault',
        'repairExperimentMedia',
        'repairJunctionWorkoutHeartRateZones',
        'repairWearableStorage',
      ],
      query: ['showVault', 'showVaultStats'],
    },
    register({ cli, services, inboxServices }) {
      registerVaultCommands(cli, services, inboxServices)
    },
  },
  {
    id: 'assistant',
    bindingMode: 'indirect',
    rootCommandNames: ['assistant', 'chat', 'run', 'status', 'doctor', 'stop'],
    register({ cli, services, inboxServices }) {
      registerAssistantCommands(cli, inboxServices, services)
    },
  },
  {
    id: 'automation',
    bindingMode: 'none',
    rootCommandNames: ['automation'],
    register({ cli }) {
      registerAutomationCommands(cli)
    },
  },
  {
    id: 'batch',
    bindingMode: 'none',
    rootCommandNames: ['batch'],
    leafCommands: [
      {
        path: ['batch'],
        description:
          'Run multiple vault-cli argv arrays in one process and return structured per-command results.',
        examples: [
          {
            description: 'Read memory and goals in one process.',
            options: {
              command: ['["memory","show"]', '["goal","list"]'],
              vault: './vault',
            },
          },
        ],
        hint:
          'Repeat --command with one JSON argv array per child command. Do not include vault-cli in child argv.',
        output: batchRunResultSchema,
      },
    ],
    register({ cli }) {
      registerBatchCommands(cli)
    },
  },
  {
    id: 'assertion',
    bindingMode: 'none',
    rootCommandNames: ['assertion'],
    leafCommands: createClinicalImportLeafCommands({
      root: 'assertion',
      scaffoldOutput: assertionScaffoldResultSchema,
      includeSave: true,
    }),
    register({ cli }) {
      registerAssertionCommands(cli)
    },
  },
  {
    id: 'vitals',
    bindingMode: 'none',
    rootCommandNames: ['vitals'],
    leafCommands: createClinicalImportLeafCommands({
      root: 'vitals',
      scaffoldOutput: vitalsScaffoldResultSchema,
      includeSave: true,
    }),
    register({ cli }) {
      registerVitalsCommands(cli)
    },
  },
  {
    id: 'diagnostic-test',
    bindingMode: 'none',
    rootCommandNames: ['diagnostic-test'],
    leafCommands: createClinicalImportLeafCommands({
      root: 'diagnostic-test',
      scaffoldOutput: diagnosticTestScaffoldResultSchema,
      includeSave: true,
    }),
    register({ cli }) {
      registerDiagnosticTestCommands(cli)
    },
  },
  {
    id: 'clinical-note',
    bindingMode: 'none',
    rootCommandNames: ['clinical-note'],
    leafCommands: createClinicalImportLeafCommands({
      root: 'clinical-note',
      scaffoldOutput: clinicalNoteScaffoldResultSchema,
    }),
    register({ cli }) {
      registerClinicalNoteCommands(cli)
    },
  },
  {
    id: 'social-history',
    bindingMode: 'none',
    rootCommandNames: ['social-history'],
    leafCommands: createClinicalImportLeafCommands({
      root: 'social-history',
      scaffoldOutput: socialHistoryScaffoldResultSchema,
    }),
    register({ cli }) {
      registerSocialHistoryCommands(cli)
    },
  },
  {
    id: 'exercise',
    bindingMode: 'none',
    rootCommandNames: ['exercise'],
    leafCommands: [
      {
        path: ['exercise', 'list'],
        description: 'List public catalog movements with optional search and filter fields.',
        output: exerciseListResultSchema,
      },
      {
        path: ['exercise', 'show'],
        description: 'Show one public catalog movement by id, slug, or exact name.',
        output: exerciseShowResultSchema,
      },
      {
        path: ['exercise', 'facets'],
        description: 'List available public exercise catalog filters.',
        output: exerciseFacetsResultSchema,
      },
    ],
    register({ cli }) {
      registerExerciseCommands(cli)
    },
  },
  {
    id: 'scheduled-log',
    bindingMode: 'none',
    rootCommandNames: ['scheduled-log'],
    leafCommands: [
      {
        path: ['scheduled-log', 'scaffold'],
        description: 'Emit an advanced scheduled-log JSON payload template for import fallback use.',
        output: scheduledLogScaffoldResultSchema,
      },
      {
        path: ['scheduled-log', 'save'],
        description: 'Create or update one scheduled log from typed command fields.',
        output: scheduledLogWriteResultSchema,
      },
      {
        path: ['scheduled-log', 'show'],
        description: 'Show one scheduled log by id or slug.',
        output: scheduledLogShowResultSchema,
      },
      {
        path: ['scheduled-log', 'list'],
        description: 'List scheduled logs with optional filters.',
        output: scheduledLogListResultSchema,
      },
      {
        path: ['scheduled-log', 'import-json'],
        description: 'Import or bulk-edit one scheduled log from an advanced JSON payload.',
        hint: 'Prefer scheduled-log save for canonical typed create/update usage.',
        output: scheduledLogWriteResultSchema,
      },
      {
        path: ['scheduled-log', 'pause'],
        description: 'Pause a scheduled log.',
        output: scheduledLogStatusResultSchema,
      },
      {
        path: ['scheduled-log', 'resume'],
        description: 'Resume a scheduled log.',
        output: scheduledLogStatusResultSchema,
      },
      {
        path: ['scheduled-log', 'archive'],
        description: 'Archive a scheduled log.',
        output: scheduledLogStatusResultSchema,
      },
    ],
    register({ cli }) {
      registerScheduledLogCommands(cli)
    },
  },
  {
    id: 'audit',
    bindingMode: 'none',
    rootCommandNames: ['audit'],
    register({ cli, services }) {
      registerAuditCommands(cli, services)
    },
  },
  {
    id: 'capture',
    bindingMode: 'none',
    rootCommandNames: ['capture'],
    leafCommands: [
      {
        path: ['capture', 'add'],
        description: captureCommandDescriptions.add,
        hint: captureCommandDescriptions.addHint,
      },
      {
        path: ['capture', 'import-json'],
        description: captureCommandDescriptions.importJson,
        hint: captureCommandDescriptions.importJsonHint,
      },
      {
        path: ['capture', 'payload-schema'],
        description: captureCommandDescriptions.payloadSchema,
      },
      {
        path: ['capture', 'show'],
        description: captureCommandDescriptions.show,
      },
      {
        path: ['capture', 'list'],
        description: captureCommandDescriptions.list,
      },
      {
        path: ['capture', 'manifest'],
        description: captureCommandDescriptions.manifest,
      },
    ],
    register({ cli, services }) {
      registerCaptureCommands(cli, services)
    },
  },
  {
    id: 'commons',
    bindingMode: 'none',
    rootCommandNames: ['commons'],
    leafCommands: [
      {
        path: ['commons', 'protocol', 'list'],
        description:
          'List public Health Commons protocol variants with optional text, status, and category filters.',
        output: commonsProtocolListResultSchema,
      },
      {
        path: ['commons', 'protocol', 'show'],
        description:
          'Show one public Health Commons protocol variant by key, slug, or alias, including exact revision ids.',
        output: commonsProtocolShowResultSchema,
      },
      {
        path: ['commons', 'protocol', 'explore'],
        description:
          'Explore candidate public Health Commons protocol variants for a broad or fuzzy protocol request.',
        output: commonsProtocolExploreResultSchema,
      },
    ],
    register({ cli }) {
      registerCommonsCommands(cli)
    },
  },
  {
    id: 'document',
    bindingMode: 'direct',
    rootCommandNames: ['document'],
    leafCommands: [
      {
        path: ['document', 'import'],
        description: 'Import one document artifact as a canonical document event plus immutable raw artifacts.',
      },
      {
        path: ['document', 'show'],
        description: 'Show one imported document by document id or canonical event id.',
      },
      {
        path: ['document', 'list'],
        description: 'List imported document events within an optional date range.',
      },
      {
        path: ['document', 'manifest'],
        description: 'Show the immutable raw-import manifest for one imported document.',
      },
      {
        path: ['document', 'workout-import-status'],
        description:
          'Check whether workout history has ever been imported from one preserved raw source.',
      },
      {
        path: ['document', 'edit'],
        description: 'Edit one imported document event from typed fields.',
      },
      {
        path: ['document', 'delete'],
        description: 'Delete one imported document event while leaving immutable raw artifacts on disk.',
      },
    ],
    directVaultServiceBindings: {
      importers: ['importDocument'],
      query: [
        'showDocument',
        'listDocuments',
        'showDocumentManifest',
        'hasWorkoutHistoryForRawSource',
      ],
    },
    register({ cli, services }) {
      registerDocumentCommands(cli, services)
    },
  },
  {
    id: 'device',
    bindingMode: 'direct',
    rootCommandNames: ['device'],
    directVaultServiceBindings: {
      devices: [
        'listProviders',
        'connect',
        'listAccounts',
        'showAccount',
        'reconcileAccount',
        'disconnectAccount',
        'daemonStatus',
        'daemonStart',
        'daemonStop',
      ],
    },
    register({ cli, services }) {
      registerDeviceCommands(cli, services.devices)
    },
  },
  {
    id: 'habitat',
    bindingMode: 'none',
    rootCommandNames: ['habitat'],
    leafCommands: [
      {
        path: ['habitat', 'save'],
        description:
          'Merge indicator values into one habitat aspect record (declined and null are first-class values).',
      },
      {
        path: ['habitat', 'show'],
        description: 'Show one habitat aspect record by canonical id or aspect slug.',
      },
      {
        path: ['habitat', 'list'],
        description: 'List habitat aspect records with an optional domain filter.',
      },
      {
        path: ['habitat', 'coverage'],
        description:
          'Compute habitat coverage against the domain catalog, including top unanswered gaps.',
      },
      {
        path: ['habitat', 'catalog'],
        description:
          'Emit the habitat domain catalog with indicators, priorities, and example questions.',
      },
    ],
    register({ cli }) {
      registerHabitatCommands(cli)
    },
  },
  {
    id: 'memory',
    bindingMode: 'none',
    rootCommandNames: ['memory'],
    register({ cli }) {
      registerMemoryCommands(cli)
    },
  },
  {
    id: 'model',
    bindingMode: 'none',
    rootCommandNames: ['model'],
    register({ cli }) {
      registerModelCommands(cli)
    },
  },
  {
    id: 'murph-age',
    bindingMode: 'none',
    rootCommandNames: ['age'],
    leafCommands: [
      {
        path: ['age', 'inputs'],
        description:
          'Return metadata-only Murph Age input readiness for labs, body metrics, blood pressure, and wearable context in the selected vault.',
        hint:
          'This command reports input readiness only. It does not calculate an age, expose metric values, or make product claims.',
        output: murphAgeInputReadinessResultSchema,
      },
      {
        path: ['age', 'report'],
        description:
          'Return the public Murph Age calculator report for labs, body metrics, and wearable context already present in the selected vault.',
        hint:
          'Product mode is the default and may return abstain while Murph Age remains research-only. Research mode is for local model development, not user-facing product claims.',
        output: murphAgeReportResultSchema,
      },
      {
        path: ['age', 'scaffold'],
        description:
          'Emit the canonical research-preview JSON payload shape for submitted labs, body metrics, blood pressure, and wearable summaries.',
        hint:
          'Edit the emitted payload, save it as JSON, then run age preview --input @payload.json. Wearable values are accepted as context but do not affect the score yet.',
        output: murphAgeSubmittedPreviewPayloadSchema,
      },
      {
        path: ['age', 'preview'],
        description:
          'Return a research-only Murph Age preview from a submitted JSON payload of labs, body metrics, blood pressure, and wearable summaries.',
        hint:
          'This command is research-only. It is for local model development and demos, not product claims or medical recommendations.',
        output: murphAgeReportResultSchema,
      },
      {
        path: ['age', 'model-cards'],
        description:
          'Return metadata-only readiness status for local Murph Age model-card artifacts and current policy blockers.',
        hint:
          'This command reports policy and artifact presence only. It does not expose model internals, row values, predictions, or product claims.',
        output: murphAgeModelCardStatusResultSchema,
      },
    ],
    register({ cli, services }) {
      registerMurphAgeCommands(cli, services)
    },
  },
  {
    id: 'route',
    bindingMode: 'none',
    rootCommandNames: ['route'],
    leafCommands: [
      {
        path: ['route', 'estimate'],
        description:
          'Estimate route distance, duration, and optional approximate elevation between two points through temporary Mapbox lookups without persisting route data in Murph state.',
        hint:
          'Requires MAPBOX_ACCESS_TOKEN. Geometry is omitted by default; elevation is approximate; text lookups stay temporary.',
        output: mapboxRouteEstimateResultSchema,
      },
    ],
    register({ cli }) {
      registerRouteCommands(cli)
    },
  },
  {
    id: 'research',
    bindingMode: 'none',
    rootCommandNames: ['research'],
    leafCommands: [
      {
        path: ['research', 'payload-schema'],
        description:
          'Emit the exact finite focused-scope JSON body schema for research scout --input.',
        hint:
          'Use this before research scout when constructing the stdin or @file JSON body.',
        output: payloadSchemaResultSchema,
      },
      {
        path: ['research', 'scout'],
        description:
          'Search Exa for bounded human-research candidates from one finite focused structured scope without writing vault records.',
        hint:
          `Requires EXA_API_KEY and {"mode":"focused"}. Use only exact server-owned public concepts: ${RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE}. If the question cannot be represented exactly, make no Exa call. Managed broad discovery and automation use research scout-batch. Never include arbitrary values, names, organizations, private notes, or personal data. Trust only candidates whose resultIndex maps to a returned source with a title, web URL, and enough publication metadata for the claim; otherwise report no usable current source without fabricating or repeating the lookup blindly.`,
        output: researchScoutResultSchema,
      },
    ],
    register({ cli }) {
      registerResearchCommands(cli)
    },
  },
  {
    id: 'meal',
    bindingMode: 'none',
    rootCommandNames: ['meal'],
    leafCommands: [
      {
        path: ['meal', 'add'],
        description:
          'Record one meal from typed media, ingredient, nutrition, and text fields.',
      },
      {
        path: ['meal', 'import-json'],
        description:
          'Import one meal from a structured JSON payload file or stdin, preserving nested ingredients and nutrition provenance fields.',
        hint:
          'JSON escape hatch for advanced imports; typed flags may override imported scalar fields.',
      },
      {
        path: ['meal', 'show'],
        description: 'Show one meal by meal id or canonical event id.',
      },
      {
        path: ['meal', 'list'],
        description: 'List meal events within an optional date range.',
      },
      {
        path: ['meal', 'totals'],
        description: 'Show calorie and macro totals from meal nutrition over an optional date range.',
      },
      {
        path: ['meal', 'nutrients'],
        description: 'Show water, vitamin, and mineral totals with per-nutrient meal coverage over an optional date range.',
      },
      {
        path: ['meal', 'manifest'],
        description: 'Show the immutable raw-import manifest for one recorded meal.',
      },
      {
        path: ['meal', 'edit'],
        description: 'Edit one meal event from typed fields.',
      },
      {
        path: ['meal', 'delete'],
        description: 'Delete one meal event while leaving immutable raw artifacts on disk.',
      },
    ],
    register({ cli, services }) {
      registerMealCommands(cli, services)
    },
  },
  {
    id: 'measurement',
    bindingMode: 'none',
    rootCommandNames: ['measurement'],
    leafCommands: [
      {
        path: ['measurement', 'add'],
        description: measurementCommandDescriptions.add,
      },
      {
        path: ['measurement', 'import-json'],
        description: measurementCommandDescriptions.importJson,
        hint:
          'JSON escape hatch for nested links, external refs, rawRefs, media metadata, and other fields outside typed add.',
      },
      {
        path: ['measurement', 'show'],
        description: measurementCommandDescriptions.show,
      },
      {
        path: ['measurement', 'list'],
        description: measurementCommandDescriptions.list,
      },
      {
        path: ['measurement', 'entry', 'list'],
        description: measurementCommandDescriptions.entryList,
      },
      {
        path: ['measurement', 'manifest'],
        description: measurementCommandDescriptions.manifest,
      },
    ],
    register({ cli }) {
      registerMeasurementCommands(cli)
    },
  },
  {
    id: 'encounter',
    bindingMode: 'none',
    rootCommandNames: ['encounter'],
    leafCommands: [
      {
        path: ['encounter', 'scaffold'],
        description: encounterCommandDescriptions.scaffold,
        hint: encounterCommandDescriptions.scaffoldHint,
        output: encounterScaffoldResultSchema,
      },
      {
        path: ['encounter', 'payload-schema'],
        description: encounterCommandDescriptions.payloadSchema,
        hint: encounterCommandDescriptions.payloadSchemaHint,
        output: payloadSchemaEnvelopeSchema,
      },
      {
        path: ['encounter', 'import-json'],
        description: encounterCommandDescriptions.importJson,
        hint: encounterCommandDescriptions.importJsonHint,
        output: encounterImportResultSchema,
      },
    ],
    register({ cli }) {
      registerEncounterCommands(cli)
    },
  },
  {
    id: 'workout',
    bindingMode: 'none',
    rootCommandNames: ['workout'],
    leafCommands: [
      {
        path: ['workout', 'add'],
        description:
          'Record one workout from typed session fields or freeform text.',
      },
      {
        path: ['workout', 'import-json'],
        description:
          'Import one workout from an advanced structured JSON payload file or stdin.',
        hint:
          'Generate the file body from workout payload-schema. Use strengthExercises for compact repeated strength sets.',
      },
      {
        path: ['workout', 'payload-schema'],
        description:
          'Emit the JSON payload schema for workout import-json file bodies.',
        hint:
          'Use strengthExercises for compact repeated strength sets. Pipe a matching JSON object into workout import-json --input -.',
        output: payloadSchemaEnvelopeSchema,
      },
      {
        path: ['workout', 'show'],
        description: 'Show one workout session by canonical event id.',
      },
      {
        path: ['workout', 'list'],
        description: 'List workout sessions with optional date bounds.',
      },
      {
        path: ['workout', 'manifest'],
        description: 'Show the immutable raw import manifest for an imported workout event.',
      },
      {
        path: ['workout', 'edit'],
        description:
          'Edit one saved workout activity event from typed fields.',
      },
      {
        path: ['workout', 'delete'],
        description: 'Delete one workout activity event.',
      },
      {
        path: ['workout', 'units', 'show'],
        description: 'Show the saved workout unit preferences from the canonical preferences document.',
      },
      {
        path: ['workout', 'units', 'set'],
        description: 'Set one or more workout unit preferences on the canonical preferences document.',
      },
      {
        path: ['workout', 'import', 'inspect'],
        description: 'Inspect one workout CSV file without writing anything, including timezone and unit requirements.',
      },
      {
        path: ['workout', 'import', 'csv'],
        description:
          'Validate one complete workout CSV and bulk-commit replay-safe activity_session events with bounded output.',
      },
      {
        path: ['workout', 'format', 'save'],
        description:
          'Save or update one reusable workout format from typed routine-template fields or freeform text.',
      },
      {
        path: ['workout', 'format', 'import-json'],
        description:
          'Import one reusable workout format from a structured JSON payload file or stdin.',
        hint:
          'JSON escape hatch for routine exercises, planned sets, grouping, tags, and notes outside typed save.',
      },
      {
        path: ['workout', 'format', 'show'],
        description: 'Show one saved workout format by name, slug, or id.',
      },
      {
        path: ['workout', 'format', 'list'],
        description: 'List saved workout formats.',
      },
      {
        path: ['workout', 'format', 'log'],
        description:
          'Log one dated workout from a saved workout format through the canonical activity_session path.',
      },
    ],
    register({ cli, services }) {
      registerWorkoutCommands(cli, services)
    },
  },
  {
    id: 'intervention',
    bindingMode: 'none',
    rootCommandNames: ['intervention'],
    leafCommands: [
      {
        path: ['intervention', 'add'],
        description:
          'Record one intervention session from a freeform note, with automatic single-match experiment linking.',
      },
      {
        path: ['intervention', 'edit'],
        description:
          'Edit one saved intervention session event from typed fields.',
      },
      {
        path: ['intervention', 'delete'],
        description: 'Delete one intervention_session event.',
      },
    ],
    register({ cli, services }) {
      registerInterventionCommands(cli, services)
    },
  },
  {
    id: 'provider',
    bindingMode: 'direct',
    rootCommandNames: ['provider'],
    leafCommands: [
      {
        path: ['provider', 'scaffold'],
        description: 'Emit an advanced provider JSON payload template for import fallback use.',
      },
      {
        path: ['provider', 'save'],
        description: 'Create or update one provider from typed command fields.',
      },
      {
        path: ['provider', 'show'],
        description: 'Show one provider by canonical id or slug.',
      },
      {
        path: ['provider', 'list'],
        description: 'List provider records with an optional status filter.',
      },
      {
        path: ['provider', 'import-json'],
        description: 'Import or bulk-edit one provider Markdown record from a JSON payload file or stdin.',
        hint: 'Prefer provider save for canonical typed create/update usage.',
      },
      {
        path: ['provider', 'edit'],
        description: 'Edit one provider from typed fields.',
      },
      {
        path: ['provider', 'delete'],
        description: 'Delete one provider Markdown record.',
      },
    ],
    directVaultServiceBindings: {
      core: ['scaffoldProvider', 'upsertProvider'],
      query: ['showProvider', 'listProviders'],
    },
    register({ cli, services }) {
      registerProviderCommands(cli, services)
    },
  },
  {
    id: 'recipe',
    bindingMode: 'direct',
    rootCommandNames: ['recipe'],
    leafCommands: [
      {
        path: ['recipe', 'scaffold'],
        description: 'Emit an advanced recipe JSON payload template for import fallback use.',
      },
      {
        path: ['recipe', 'save'],
        description: 'Create or update one recipe from typed command fields.',
      },
      {
        path: ['recipe', 'show'],
        description: 'Show one recipe by canonical id or slug.',
      },
      {
        path: ['recipe', 'list'],
        description: 'List recipe records with an optional status filter.',
      },
      {
        path: ['recipe', 'import-json'],
        description: 'Import or bulk-edit one recipe Markdown record from a JSON payload file or stdin.',
        hint: 'Prefer recipe save for canonical typed create/update usage.',
      },
      {
        path: ['recipe', 'edit'],
        description: 'Edit one recipe from typed fields.',
      },
      {
        path: ['recipe', 'delete'],
        description: 'Delete one recipe Markdown record.',
      },
    ],
    directVaultServiceBindings: {
      core: ['scaffoldRecipe', 'upsertRecipe'],
      query: ['showRecipe', 'listRecipes'],
    },
    register({ cli, services }) {
      registerRecipeCommands(cli, services)
    },
  },
  {
    id: 'food',
    bindingMode: 'direct',
    rootCommandNames: ['food'],
    leafCommands: [
      {
        path: ['food', 'list'],
        description: 'List food records with an optional status filter.',
      },
      {
        path: ['food', 'scaffold'],
        description: 'Emit an advanced food JSON payload template for import fallback use.',
      },
      {
        path: ['food', 'save'],
        description: 'Create or update one food from typed command fields.',
      },
      {
        path: ['food', 'show'],
        description: 'Show one food by canonical id or slug.',
      },
      {
        path: ['food', 'search-labels'],
        description: 'Search the hosted food label database from hosted assistant runtime without writing records.',
        output: foodLabelSearchResultSchema,
      },
      {
        path: ['food', 'search-labels-batch'],
        description: 'Search multiple hosted food label queries from hosted assistant runtime without writing records.',
        output: foodLabelBatchSearchResultSchema,
      },
      {
        path: ['food', 'import-json'],
        description: 'Import or bulk-edit one food Markdown record from a JSON payload file or stdin.',
        hint: 'Prefer food save for canonical typed create/update usage.',
      },
      {
        path: ['food', 'edit'],
        description: 'Edit one food from typed fields.',
      },
      {
        path: ['food', 'delete'],
        description: 'Delete one remembered food Markdown record.',
      },
      {
        path: ['food', 'schedule'],
        description: 'Schedule one remembered food for daily auto-log meal creation.',
      },
      {
        path: ['food', 'unschedule'],
        description: 'Unschedule one remembered food from daily auto-log meal creation.',
      },
    ],
    directVaultServiceBindings: {
      core: ['scaffoldFood', 'upsertFood', 'addDailyFood'],
      query: ['showFood', 'listFoods'],
    },
    register({ cli, services }) {
      registerFoodCommands(cli, services)
    },
  },
  {
    id: 'event',
    bindingMode: 'direct',
    rootCommandNames: ['event'],
    leafCommands: [
      {
        path: ['event', 'list'],
        description: 'List canonical event records with optional date, tag, and experiment filters.',
      },
      {
        path: ['event', 'scaffold'],
        description: 'Emit an event payload template for one supported canonical event kind.',
      },
      {
        path: ['event', 'show'],
        description: 'Show one canonical event by event id.',
      },
      {
        path: ['event', 'import-json'],
        description: 'Import one canonical event from an explicit JSON payload file or stdin.',
      },
      {
        path: ['event', 'import-jsonl'],
        description:
          'Import many canonical events from JSON Lines input in one transactional batch.',
        examples: [
          {
            description: 'Dry-run a bulk import to see created/skipped/updated counts.',
            options: {
              input: '@events.jsonl',
              sourceRawRefOnce: 'raw/documents/workout-export.csv',
              vault: './vault',
            },
          },
          {
            description: 'Apply the same bulk import after the dry-run counts look right.',
            options: {
              apply: true,
              input: '@events.jsonl',
              sourceRawRefOnce: 'raw/documents/workout-export.csv',
              vault: './vault',
            },
          },
        ],
        hint:
          'Use for backfills with many events instead of repeated import-json calls. Run event payload-schema --for import-jsonl --kind <kind> --format json for the exact per-line contract. Each line must omit id and eventId. For a preserved workout CSV, --source-raw-ref-once requires every row to be an externalRef-free activity_session referencing that raw source and rejects the whole batch once any historical workout has referenced it. Other imports with externalRef use ordinary retry-safe dedupe; rows without externalRef are append-only. Dry-run by default; --apply writes.',
      },
      {
        path: ['event', 'payload-schema'],
        description: 'Emit an exact event payload schema for a supported file-backed import surface.',
        hint:
          'Use --for import-jsonl --kind <kind> to get the exact JSON object schema for one JSONL row. Include externalRef for retry-safe dedupe; omit it only for append-only imports.',
        output: payloadSchemaEnvelopeSchema,
      },
      {
        path: ['event', 'note', 'add'],
        description: 'Append one canonical note event from typed fields.',
      },
      {
        path: ['event', 'symptom', 'add'],
        description: 'Append one canonical symptom event from typed fields.',
      },
      {
        path: ['event', 'observation', 'add'],
        description: 'Append one canonical observation event from typed fields.',
      },
      {
        path: ['event', 'medication-intake', 'add'],
        description: 'Append one canonical medication intake event from typed fields.',
      },
      {
        path: ['event', 'supplement-intake', 'add'],
        description: 'Append one canonical supplement intake event from typed fields.',
      },
      {
        path: ['event', 'encounter', 'add'],
        description: 'Append one canonical encounter history event from typed fields.',
      },
      {
        path: ['event', 'procedure', 'add'],
        description: 'Append one canonical procedure history event from typed fields.',
      },
      {
        path: ['event', 'adverse-effect', 'add'],
        description: 'Append one canonical adverse-effect history event from typed fields.',
      },
      {
        path: ['event', 'exposure', 'add'],
        description: 'Append one canonical exposure history event from typed fields.',
      },
      {
        path: ['event', 'edit'],
        description: 'Edit one canonical event from typed fields.',
      },
      {
        path: ['event', 'delete'],
        description: 'Delete one canonical event by event id.',
      },
    ],
    directVaultServiceBindings: {
      core: ['scaffoldEvent', 'upsertEvent'],
      query: ['showEvent', 'listEvents'],
    },
    register({ cli, services }) {
      registerEventCommands(cli, services)
    },
  },
  {
    id: 'samples',
    bindingMode: 'direct',
    rootCommandNames: ['samples'],
    directVaultServiceBindings: {
      core: ['addSamples'],
    },
    register({ cli, services }) {
      registerSamplesCommands(cli, services)
    },
  },
  {
    id: 'wearables',
    bindingMode: 'direct',
    rootCommandNames: ['wearables'],
    leafCommands: [
      {
        path: ['wearables', 'latest'],
        description: 'Show the compact latest normalized wearable bundle across sleep, recovery, activity, body-state, and source freshness.',
        output: wearablesLatestResultSchema,
      },
      {
        path: ['wearables', 'day'],
        description: 'Show one semantic wearable day mirror with deduped sleep, activity, body-state, recovery, and source-confidence notes.',
        output: wearablesDayResultSchema,
      },
      {
        path: ['wearables', 'metric', 'latest'],
        description: 'Show the latest normalized value for one wearable metric key or alias.',
        output: wearablesMetricLatestResultSchema,
      },
      {
        path: ['wearables', 'metric', 'trend'],
        description: 'Show a compact normalized trend window for one wearable metric key or alias.',
        output: wearablesMetricTrendResultSchema,
      },
      {
        path: ['wearables', 'sleep', 'list'],
        description: 'List semantic daily sleep summaries with selected-provider reasoning and confidence details.',
        output: wearablesSleepListResultSchema,
      },
      {
        path: ['wearables', 'sleep', 'pattern'],
        description: 'Summarize longitudinal sleep regularity, timing, missingness, provider mix, and sleep-source freshness with explicit caveats.',
        output: wearablesSleepPatternResultSchema,
      },
      {
        path: ['wearables', 'activity', 'list'],
        description: 'List semantic daily activity summaries with deduped workouts, steps, and distance details.',
        output: wearablesActivityListResultSchema,
      },
      {
        path: ['wearables', 'body', 'list'],
        description: 'List semantic daily body-state and body-composition summaries with source-confidence details.',
        output: wearablesBodyStateListResultSchema,
      },
      {
        path: ['wearables', 'recovery', 'list'],
        description: 'List semantic daily recovery summaries with readiness, HRV, respiratory, and temperature details.',
        output: wearablesRecoveryListResultSchema,
      },
      {
        path: ['wearables', 'sources', 'list'],
        description: 'List wearable source health, coverage, freshness, and evidence counts by provider.',
        output: wearablesSourcesListResultSchema,
      },
      {
        path: ['wearables', 'drift'],
        description: 'Explain the biggest normalized wearable drift Murph sees across the current wearable surfaces.',
        output: wearablesDriftResultSchema,
      },
      {
        path: ['wearables', 'patterns'],
        description: 'Compare repeated activity and intervention days with next-day sleep and recovery outcomes.',
        output: wearablesPersonalPatternsResultSchema,
      },
    ],
    directVaultServiceBindings: assumeDirectVaultServiceBindings({
      query: [
        'showWearableLatest',
        'showWearableDay',
        'showWearableMetricLatest',
        'showWearableMetricTrend',
        'listWearableSleep',
        'showWearableSleepPattern',
        'listWearableActivity',
        'listWearableBodyState',
        'listWearableRecovery',
        'listWearableSources',
        'showWearableDrift',
        'showPersonalPatterns',
      ],
    }),
    register({ cli, services }) {
      registerWearablesCommands(cli, services)
    },
  },
  {
    id: 'experiment',
    bindingMode: 'direct',
    rootCommandNames: ['experiment'],
    leafCommands: [
      {
        path: ['experiment', 'start'],
        description:
          'Start a typed experiment run from a Health Commons protocol; custom runs require explicit no-public-protocol fallback.',
      },
      {
        path: ['experiment', 'show'],
        description: 'Show one experiment by canonical id or slug.',
      },
      {
        path: ['experiment', 'list'],
        description: 'List experiments through the query read model.',
      },
      {
        path: ['experiment', 'edit'],
        description: 'Edit scalar fields and structured experiment setup fields using typed options.',
      },
      {
        path: ['experiment', 'checkpoint'],
        description: 'Append one experiment checkpoint event using typed fields.',
      },
      {
        path: ['experiment', 'stop'],
        description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
      },
      {
        path: ['experiment', 'progress'],
        description: 'Read the deterministic progress summary for one experiment.',
      },
      {
        path: ['experiment', 'progress-card'],
        description:
          'Render one experiment progress card into a private vault image attachment.',
      },
      {
        path: ['experiment', 'session', 'log'],
        description: 'Log one structured intervention session for an experiment using typed fields.',
      },
      {
        path: ['experiment', 'session', 'attach'],
        description: 'Attach an existing intervention_session event to one experiment.',
      },
      {
        path: ['experiment', 'session', 'detach'],
        description: 'Detach an existing intervention_session event from its experiment.',
      },
      {
        path: ['experiment', 'context', 'log'],
        description: 'Log one experiment-linked context, note, or supplement-intake record using typed fields.',
      },
      {
        path: ['experiment', 'outcome', 'analyze'],
        description: 'Run the deterministic final analysis for one experiment.',
      },
      {
        path: ['experiment', 'outcome', 'write'],
        description: 'Run the deterministic final analysis for one experiment and persist the outcome record.',
      },
      {
        path: ['experiment', 'followup', 'due'],
        description:
          'Evaluate deterministic missed-log or weekly-digest follow-up due logic for one experiment.',
      },
    ],
    directVaultServiceBindings: {
      core: [
        'planExperiment',
        'startExperiment',
        'updateExperiment',
        'applyExperimentOnboarding',
        'checkpointExperiment',
        'stopExperiment',
        'logExperimentSession',
        'attachExperimentSession',
        'detachExperimentSession',
        'logExperimentContext',
        'writeExperimentOutcome',
      ],
      query: [
        'showExperiment',
        'listExperiments',
        'showExperimentProgress',
        'showExperimentFollowupDue',
        'analyzeExperimentOutcome',
      ],
    },
    register({ cli, services }) {
      registerExperimentCommands(cli, services)
    },
  },
  {
    id: 'journal',
    bindingMode: 'direct',
    rootCommandNames: ['journal'],
    directVaultServiceBindings: {
      core: [
        'ensureJournal',
        'appendJournal',
        'linkJournalEvents',
        'unlinkJournalEvents',
        'linkJournalStreams',
        'unlinkJournalStreams',
      ],
      query: ['showJournal', 'listJournals'],
    },
    register({ cli, services }) {
      registerJournalCommands(cli, services)
    },
  },
  {
    id: 'read',
    bindingMode: 'direct',
    rootCommandNames: ['show', 'list'],
    leafCommands: [
      {
        path: ['show'],
        description:
          'Read one canonical vault record through the query layer when you already know the exact canonical read id. Generic `show` accepts canonical family ids such as `meal_*` and `doc_*`; use family-specific manifest commands for import provenance reads.',
        output: showResultSchema,
      },
      {
        path: ['list'],
        description:
          'List canonical vault records through the query layer when you need structured filtering by family, kind, status, stream, tag, or date range.',
        output: listResultSchema,
      },
    ],
    directVaultServiceBindings: {
      query: ['show', 'list'],
    },
    register({ cli, services }) {
      registerReadCommands(cli, services)
    },
  },
  {
    id: 'search',
    bindingMode: 'none',
    rootCommandNames: ['search', 'query', 'timeline'],
    leafCommands: [
      {
        path: ['search', 'query'],
        description:
          'Search the shared local query projection by fuzzy text when the target is remembered by phrase rather than exact id. Prefer this over broad raw-file reads.',
      },
      {
        path: ['query', 'projection', 'status'],
        description:
          'Inspect the shared local query projection that powers canonical reads and lexical search.',
      },
      {
        path: ['query', 'projection', 'rebuild'],
        description:
          'Rebuild the shared local query projection from canonical vault data.',
      },
      {
        path: ['timeline'],
        description:
          'Build a descending cross-record timeline when the question is about what changed, what happened over a window, or what stood out over time.',
      },
    ],
    register({ cli }) {
      registerSearchCommands(cli)
    },
  },
  {
    id: 'knowledge',
    bindingMode: 'none',
    rootCommandNames: ['knowledge'],
    leafCommands: [
      {
        path: ['knowledge', 'score-challenge'],
        description: knowledgeChallengeScoreCommandDescription,
        hint:
          'Pass --input @file.json or -. The body contains only the frozen format, additive scorecard, and explicit normalized participant-component observations.',
        output: groupChallengeScoreResultSchema,
      },
      {
        path: ['knowledge', 'upsert'],
        description:
          'Persist one assistant-authored derived knowledge page from local vault context. Writes under derived/knowledge/pages/**, rebuilds the derived knowledge index, and rejects derived/runtime source inputs such as derived/** and .runtime/**.',
        output: knowledgeUpsertResultSchema,
      },
      {
        path: ['knowledge', 'append-section'],
        description:
          'Append or prepend one assistant-authored markdown section to a derived knowledge page, creating the page if needed, rejecting duplicate section headings, and rebuilding the derived knowledge index.',
        output: knowledgeUpsertResultSchema,
      },
      {
        path: ['knowledge', 'list'],
        description: 'List derived knowledge pages currently compiled under derived/knowledge/pages/**.',
        output: knowledgeListResultSchema,
      },
      {
        path: ['knowledge', 'search'],
        description:
          'Search derived knowledge pages by lexical match across titles, summaries, body text, related slugs, and source paths.',
        output: knowledgeSearchResultSchema,
      },
      {
        path: ['knowledge', 'show'],
        description: 'Show one derived knowledge page by slug.',
        output: knowledgeShowResultSchema,
      },
      {
        path: ['knowledge', 'lint'],
        description:
          'Run deterministic health checks over derived knowledge pages, including parse failures, duplicate slugs, missing sources, invalid sources, missing related pages, and invalid bank/library links.',
        output: knowledgeLintResultSchema,
      },
      {
        path: ['knowledge', 'log', 'tail'],
        description:
          'Show the latest append-only derived knowledge write-log entries from derived/knowledge/log.md.',
        output: knowledgeLogTailResultSchema,
      },
      {
        path: ['knowledge', 'index', 'rebuild'],
        description: 'Rebuild derived/knowledge/index.md from the current knowledge pages.',
        output: knowledgeIndexRebuildResultSchema,
      },
    ],
    register({ cli }) {
      registerKnowledgeCommands(cli)
    },
  },
  {
    id: 'export',
    bindingMode: 'direct',
    rootCommandNames: ['export'],
    directVaultServiceBindings: {
      query: ['exportPack'],
    },
    register({ cli, services }) {
      registerExportCommands(cli, services)
    },
  },
  {
    id: 'intake',
    bindingMode: 'direct',
    rootCommandNames: ['intake'],
    directVaultServiceBindings: {
      core: ['projectAssessment'],
      query: ['show', 'list'],
    },
    register({ cli, services }) {
      registerIntakeCommands(cli, services)
    },
  },
  ...genericHealthCommandDescriptors,
  {
    id: 'medication',
    bindingMode: 'direct',
    rootCommandNames: ['medication'],
    leafCommands: [
      {
        path: ['medication', 'history', 'add'],
        description: 'Save an old medication course as a completed regimen record.',
        hint: 'This writes a completed medication regimen, not a point-in-time intake event.',
        output: medicationHistoryResultSchema,
      },
    ],
    directVaultServiceBindings: {
      core: ['saveRegimen'],
    },
    register({ cli, services }) {
      registerMedicationCommands(cli, services)
    },
  },
  {
    id: 'supplement',
    bindingMode: 'direct',
    rootCommandNames: ['supplement'],
    leafCommands: [
      {
        path: ['supplement', 'list'],
        description: 'List supplements through the health read model.',
        output: healthListResultSchema,
      },
      {
        path: ['supplement', 'show'],
        description: 'Show one supplement by canonical id or slug.',
        output: healthShowResultSchema,
      },
      {
        path: ['supplement', 'search-labels'],
        description: 'Search the hosted supplement label database from hosted assistant runtime without writing records.',
        output: supplementLabelSearchResultSchema,
      },
      {
        path: ['supplement', 'search-labels-batch'],
        description: 'Search multiple hosted supplement label queries from hosted assistant runtime without writing records.',
        output: supplementLabelBatchSearchResultSchema,
      },
      {
        path: ['supplement', 'save'],
        description: 'Create or update one supplement from typed command fields.',
        hint:
          'Repeat --ingredient with one shell-quoted JSON object: compound required; label, amount, unit, active, note optional. Do not pass ingredient text or arrays. Label units such as "mcg DFE", "mg NE", and "billion CFU" are normalized before saving.',
      },
      {
        path: ['supplement', 'stop'],
        description: 'Stop one supplement while preserving its canonical id.',
      },
      {
        path: ['supplement', 'compound', 'list'],
        description: 'List rolled-up supplement compounds across supplements.',
      },
      {
        path: ['supplement', 'compound', 'show'],
        description: 'Show one rolled-up supplement compound by name or lookup id.',
      },
    ],
    directVaultServiceBindings: {
      core: [
        'saveSupplement',
        'stopRegimen',
      ],
      query: [
        'showSupplement',
        'listSupplements',
        'showSupplementCompound',
        'listSupplementCompounds',
      ],
    },
    register({ cli, services }) {
      registerSupplementCommands(cli, services)
    },
  },
  {
    id: 'regimen-protocol',
    bindingMode: 'direct',
    rootCommandNames: ['regimen', 'protocol'],
    leafCommands: [
      {
        path: ['regimen', 'scaffold'],
        description: 'Print a starter regimen JSON payload.',
      },
      {
        path: ['regimen', 'list'],
        description: 'List private regimen records.',
      },
      {
        path: ['regimen', 'show'],
        description: 'Show one private regimen record.',
      },
      {
        path: ['regimen', 'import-json'],
        description: 'Import one regimen from an explicit JSON payload file or stdin.',
      },
      {
        path: ['regimen', 'save'],
        description: 'Create or update one regimen from typed command fields.',
      },
      {
        path: ['regimen', 'stop'],
        description: 'Stop one regimen while preserving its canonical id.',
      },
      {
        path: ['protocol', 'import-json'],
        description: 'Import one private Health Commons-backed protocol adaptation from JSON.',
      },
      {
        path: ['protocol', 'list'],
        description: 'List private Health Commons-backed protocol adaptations.',
      },
      {
        path: ['protocol', 'show'],
        description: 'Show one private Health Commons-backed protocol adaptation.',
      },
    ],
    directVaultServiceBindings: {
      core: [
        'scaffoldRegimen',
        'upsertRegimen',
        'saveRegimen',
        'stopRegimen',
        'upsertPrivateProtocol',
      ],
      query: [
        'showRegimen',
        'listRegimens',
        'showPrivateProtocol',
        'listPrivateProtocols',
      ],
    },
    register({ cli, services }) {
      registerProtocolCommands(cli, services)
    },
  },
] as const satisfies readonly VaultCliCommandDescriptor[]

function assertValidVaultCliCommandManifest(
  descriptors: readonly VaultCliCommandDescriptor[],
) {
  const descriptorIds = orderedUniqueStrings(descriptors.map((descriptor) => descriptor.id))
  if (descriptorIds.length !== descriptors.length) {
    throw new Error('vaultCliCommandDescriptors contains duplicate descriptor ids.')
  }

  const rootCommandNames = orderedUniqueStrings(
    descriptors.flatMap((descriptor) => [...descriptor.rootCommandNames]),
  )
  const expectedRootCommandCount = descriptors.reduce(
    (count, descriptor) => count + descriptor.rootCommandNames.length,
    0,
  )

  if (rootCommandNames.length !== expectedRootCommandCount) {
    throw new Error('vaultCliCommandDescriptors contains duplicate root command names.')
  }

  for (const descriptor of descriptors) {
    if (descriptor.bindingMode !== 'direct') {
      continue
    }

    const directVaultServiceBindings =
      'directVaultServiceBindings' in descriptor
        ? descriptor.directVaultServiceBindings
        : undefined
    const hasVaultBindings = Object.keys(directVaultServiceBindings ?? {}).length > 0

    if (!hasVaultBindings) {
      throw new Error(
        `Descriptor "${descriptor.id}" is marked direct but declares no direct service bindings.`,
      )
    }
  }
}

assertValidVaultCliCommandManifest(vaultCliCommandDescriptors)

const ROOT_COMMAND_NAMES_EXEMPT_FROM_VAULT = new Set([
  'commons',
  'model',
  'research',
  'route',
])

export function registerVaultCliCommandDescriptors(input: {
  cli: Cli.Cli
  services: VaultServices | CliVaultServices
  inboxServices: InboxServices
  excludeDescriptorIds?: ReadonlySet<string>
}) {
  const descriptorInput = {
    ...input,
    services: ensureCliVaultServices(input.services),
  }

  for (const descriptor of vaultCliCommandDescriptors) {
    if (input.excludeDescriptorIds?.has(descriptor.id)) {
      continue
    }

    descriptor.register(descriptorInput)
  }
}

export function collectVaultCliDescriptorRootCommandNames() {
  return orderedUniqueStrings(
    vaultCliCommandDescriptors.flatMap((descriptor) => [...descriptor.rootCommandNames]),
  )
}

export function collectVaultRequiredCliDescriptorRootCommandNames() {
  return collectVaultCliDescriptorRootCommandNames().filter(
    (commandName) => !ROOT_COMMAND_NAMES_EXEMPT_FROM_VAULT.has(commandName),
  )
}

export function collectVaultCliDirectServiceBindings(): CollectedVaultCliDirectServiceBindings {
  const vaultBindings: Record<VaultServiceGroupName, string[]> = {
    core: [],
    importers: [],
    query: [],
    devices: [],
  }

  for (const descriptor of vaultCliCommandDescriptors) {
    if (descriptor.bindingMode !== 'direct') {
      continue
    }

    const directVaultServiceBindings =
      'directVaultServiceBindings' in descriptor
        ? descriptor.directVaultServiceBindings
        : undefined
    for (const [groupName, methodNames] of Object.entries(
      directVaultServiceBindings ?? {},
    ) as Array<[VaultServiceGroupName, readonly string[]]>) {
      vaultBindings[groupName] = orderedUniqueStrings([
        ...vaultBindings[groupName],
        ...methodNames,
      ])
    }
  }

  return {
    vault: {
      core: vaultBindings.core as Array<Extract<keyof VaultServiceGroups['core'], string>>,
      importers:
        vaultBindings.importers as Array<
          Extract<keyof VaultServiceGroups['importers'], string>
        >,
      query: vaultBindings.query as Array<Extract<keyof VaultServiceGroups['query'], string>>,
      devices:
        vaultBindings.devices as Array<
          Extract<keyof VaultServiceGroups['devices'], string>
        >,
    },
  }
}
