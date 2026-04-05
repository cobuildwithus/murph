import { Cli, z } from 'incur'
import {
  createHealthScaffoldResultSchema,
  hasHealthCommandDescriptor,
  healthEntityDescriptorByCommandName,
  healthListResultSchema,
  healthShowResultSchema,
  type HealthCommandDescriptorEntry,
} from '@murphai/assistant-core/health-cli-descriptors'
import {
  listResultSchema,
  showResultSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import type { InboxServices } from '@murphai/assistant-core/inbox-services'
import type { VaultServices } from '@murphai/assistant-core/vault-services'
import { registerAssistantCommands } from './commands/assistant.js'
import { registerAuditCommands } from './commands/audit.js'
import { registerDeviceCommands } from './commands/device.js'
import { registerDocumentCommands } from './commands/document.js'
import { registerEventCommands } from './commands/event.js'
import { registerExperimentCommands } from './commands/experiment.js'
import { registerInterventionCommands } from './commands/intervention.js'
import { registerExportCommands } from './commands/export.js'
import {
  createHealthUpsertResultSchema,
  registerHealthEntityCrudGroup,
} from './commands/health-entity-command-registry.js'
import { registerInboxCommands } from './commands/inbox.js'
import { registerIntakeCommands } from './commands/intake.js'
import { registerJournalCommands } from './commands/journal.js'
import { registerMealCommands } from './commands/meal.js'
import { registerProfileCommands } from './commands/profile.js'
import { registerRecipeCommands } from './commands/recipe.js'
import { registerProviderCommands } from './commands/provider.js'
import { registerFoodCommands } from './commands/food.js'
import { registerResearchCommands } from './commands/research.js'
import { registerKnowledgeCommands } from './commands/knowledge.js'
import { researchRunResultSchema } from './research-cli-contracts.js'
import {
  knowledgeIndexRebuildResultSchema,
  knowledgeLogTailResultSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeSearchResultSchema,
  knowledgeShowResultSchema,
  knowledgeUpsertResultSchema,
} from './knowledge-cli-contracts.js'
import { registerReadCommands } from './commands/read.js'
import { registerProtocolCommands } from './commands/protocol.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerSearchCommands } from './commands/search.js'
import { registerSupplementCommands } from './commands/supplement.js'
import { registerVaultCommands } from './commands/vault.js'
import { registerWorkoutCommands } from './commands/workout.js'
import {
  registerWearablesCommands,
  wearablesActivityListResultSchema,
  wearablesBodyStateListResultSchema,
  wearablesDayResultSchema,
  wearablesRecoveryListResultSchema,
  wearablesSleepListResultSchema,
  wearablesSourcesListResultSchema,
} from './commands/wearables.js'

type VaultServiceGroupName = Extract<keyof VaultServices, string>
type InboxServiceMethodName = Extract<keyof InboxServices, string>
type CommandExample = Readonly<Record<string, unknown>>
type DirectVaultServiceBindings = {
  [TGroupName in VaultServiceGroupName]?: ReadonlyArray<
    Extract<keyof VaultServices[TGroupName], string>
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
    services: VaultServices
    inboxServices: InboxServices
  }): void
}

interface DirectBindingCommandDescriptor extends BaseVaultCliCommandDescriptor {
  bindingMode: 'direct'
  directVaultServiceBindings?: DirectVaultServiceBindings
  directInboxServiceBindings?: readonly InboxServiceMethodName[]
}

interface NonDirectBindingCommandDescriptor extends BaseVaultCliCommandDescriptor {
  bindingMode: 'indirect' | 'none'
}

export type VaultCliCommandDescriptor =
  | DirectBindingCommandDescriptor
  | NonDirectBindingCommandDescriptor

export interface CollectedVaultCliDirectServiceBindings {
  inbox: readonly InboxServiceMethodName[]
  vault: {
    [TGroupName in VaultServiceGroupName]: ReadonlyArray<
      Extract<keyof VaultServices[TGroupName], string>
    >
  }
}

const genericHealthRootCommandNames = [
  'goal',
  'condition',
  'allergy',
  'history',
  'blood-test',
  'family',
  'genetics',
] as const

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
  return [
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
    {
      path: [descriptor.command.commandName, 'upsert'],
      description: descriptor.command.descriptions.upsert,
      examples: descriptor.command.examples?.upsert,
      hint: descriptor.command.hints?.upsert,
      output: createHealthUpsertResultSchema(descriptor),
    },
  ]
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

function buildHealthCommandManifestDescriptor(input: {
  commandName: string
  register: DirectBindingCommandDescriptor['register']
  additionalVaultServiceBindings?: DirectVaultServiceBindings
}): DirectBindingCommandDescriptor {
  const descriptor = requireHealthCommandDescriptor(input.commandName)

  return {
    id: `health:${input.commandName}`,
    bindingMode: 'direct',
    rootCommandNames: [input.commandName],
    leafCommands: createHealthLeafCommands(descriptor),
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

const genericHealthCommandDescriptors = genericHealthRootCommandNames.map(
  (commandName) =>
    buildHealthCommandManifestDescriptor({
      commandName,
      register({ cli, services }) {
        registerHealthEntityCrudGroup(cli, services, commandName)
      },
    }),
)

export const vaultCliCommandDescriptors = [
  {
    id: 'vault',
    bindingMode: 'direct',
    rootCommandNames: ['init', 'validate', 'vault'],
    directVaultServiceBindings: {
      core: ['init', 'validate', 'updateVault', 'repairVault'],
      query: ['showVault', 'showVaultPaths', 'showVaultStats'],
    },
    register({ cli, services }) {
      registerVaultCommands(cli, services)
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
    id: 'audit',
    bindingMode: 'none',
    rootCommandNames: ['audit'],
    register({ cli, services }) {
      registerAuditCommands(cli, services)
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
        path: ['document', 'edit'],
        description: 'Edit one imported document event by merging a partial JSON patch or path assignments.',
      },
      {
        path: ['document', 'delete'],
        description: 'Delete one imported document event while leaving immutable raw artifacts on disk.',
      },
    ],
    directVaultServiceBindings: {
      importers: ['importDocument'],
      query: ['showDocument', 'listDocuments', 'showDocumentManifest'],
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
      registerDeviceCommands(cli, services)
    },
  },
  {
    id: 'meal',
    bindingMode: 'none',
    rootCommandNames: ['meal'],
    leafCommands: [
      {
        path: ['meal', 'add'],
        description: 'Record one meal from raw photo/audio artifacts or a freeform note.',
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
        path: ['meal', 'manifest'],
        description: 'Show the immutable raw-import manifest for one recorded meal.',
      },
      {
        path: ['meal', 'edit'],
        description: 'Edit one meal event by merging a partial JSON patch or path assignments.',
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
    id: 'workout',
    bindingMode: 'none',
    rootCommandNames: ['workout'],
    leafCommands: [
      {
        path: ['workout', 'add'],
        description:
          'Record one workout either from a freeform note or from a structured JSON payload.',
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
          'Edit one saved workout activity event by merging a partial JSON patch or path assignments.',
      },
      {
        path: ['workout', 'delete'],
        description: 'Delete one workout activity event.',
      },
      {
        path: ['workout', 'measurement', 'add'],
        description:
          'Record one body-measurement check-in from a structured JSON payload or a single typed measurement, with optional progress photos.',
      },
      {
        path: ['workout', 'measurement', 'show'],
        description: 'Show one body-measurement event by canonical event id.',
      },
      {
        path: ['workout', 'measurement', 'list'],
        description: 'List body-measurement events with optional date bounds.',
      },
      {
        path: ['workout', 'measurement', 'manifest'],
        description: 'Show the immutable raw import manifest for an imported body-measurement event.',
      },
      {
        path: ['workout', 'units', 'show'],
        description: 'Show the saved workout unit preferences from the current profile snapshot.',
      },
      {
        path: ['workout', 'units', 'set'],
        description: 'Set one or more workout unit preferences on the current profile snapshot.',
      },
      {
        path: ['workout', 'import', 'inspect'],
        description: 'Inspect one workout CSV file without writing anything.',
      },
      {
        path: ['workout', 'import', 'csv'],
        description:
          'Copy one workout CSV export into raw/workouts/** and optionally map it into activity_session events.',
      },
      {
        path: ['workout', 'format', 'save'],
        description:
          'Save or update one reusable workout format from freeform text or a structured JSON payload.',
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
          'Record one intervention session from a freeform note with lightweight structured inference.',
      },
      {
        path: ['intervention', 'edit'],
        description:
          'Edit one saved intervention session event by merging a partial JSON patch or path assignments.',
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
        description: 'Emit a provider payload template for `provider upsert`.',
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
        path: ['provider', 'upsert'],
        description: 'Create or update one provider Markdown record from a JSON payload file or stdin.',
      },
      {
        path: ['provider', 'edit'],
        description: 'Edit one provider by merging a partial JSON patch or path assignments.',
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
        description: 'Emit a recipe payload template for `recipe upsert`.',
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
        path: ['recipe', 'upsert'],
        description: 'Create or update one recipe Markdown record from a JSON payload file or stdin.',
      },
      {
        path: ['recipe', 'edit'],
        description: 'Edit one recipe by merging a partial JSON patch or path assignments.',
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
        description: 'Emit a food payload template for `food upsert`.',
      },
      {
        path: ['food', 'show'],
        description: 'Show one food by canonical id or slug.',
      },
      {
        path: ['food', 'upsert'],
        description: 'Create or update one food Markdown record from a JSON payload file or stdin.',
      },
      {
        path: ['food', 'edit'],
        description: 'Edit one food by merging a partial JSON patch or path assignments.',
      },
      {
        path: ['food', 'delete'],
        description: 'Delete one remembered food Markdown record.',
      },
      {
        path: ['food', 'schedule'],
        description: 'Schedule one remembered food for daily auto-log meal creation.',
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
        path: ['event', 'upsert'],
        description: 'Create or update one canonical event from a JSON payload file or stdin.',
      },
      {
        path: ['event', 'edit'],
        description: 'Edit one canonical event by merging a partial JSON patch or path assignments.',
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
        path: ['wearables', 'day'],
        description: 'Show one semantic wearable day mirror with deduped sleep, activity, body-state, recovery, and source-confidence notes.',
        output: wearablesDayResultSchema,
      },
      {
        path: ['wearables', 'sleep', 'list'],
        description: 'List semantic daily sleep summaries with selected-provider reasoning and confidence details.',
        output: wearablesSleepListResultSchema,
      },
      {
        path: ['wearables', 'activity', 'list'],
        description: 'List semantic daily activity summaries with deduped workouts, steps, and distance details.',
        output: wearablesActivityListResultSchema,
      },
      {
        path: ['wearables', 'body', 'list'],
        description: 'List semantic daily body-state summaries with deduped weight, body-fat, BMI, temperature, and source-confidence details.',
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
    ],
    directVaultServiceBindings: {
      query: [
        'showWearableDay',
        'listWearableSleep',
        'listWearableActivity',
        'listWearableBodyState',
        'listWearableRecovery',
        'listWearableSources',
      ],
    },
    register({ cli, services }) {
      registerWearablesCommands(cli, services)
    },
  },
  {
    id: 'experiment',
    bindingMode: 'direct',
    rootCommandNames: ['experiment'],
    directVaultServiceBindings: {
      core: [
        'createExperiment',
        'updateExperiment',
        'checkpointExperiment',
        'stopExperiment',
      ],
      query: ['showExperiment', 'listExperiments'],
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
          'Read one canonical vault record through the query layer when you already know the exact query-layer record id. Use family-specific show or manifest commands for meal/document/import provenance reads when those lookup ids differ.',
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
    rootCommandNames: ['search', 'timeline'],
    leafCommands: [
      {
        path: ['search', 'query'],
        description:
          'Search the local read model by fuzzy text when the target is remembered by phrase rather than exact id. Prefer this over broad raw-file reads.',
      },
      {
        path: ['timeline'],
        description:
          'Build a descending cross-record timeline when the question is about what changed, what happened over a window, or what stood out over time.',
      },
    ],
    register({ cli, services }) {
      registerSearchCommands(cli, services)
    },
  },
  {
    id: 'knowledge',
    bindingMode: 'none',
    rootCommandNames: ['knowledge'],
    leafCommands: [
      {
        path: ['knowledge', 'upsert'],
        description:
          'Persist one assistant-authored derived knowledge page from local vault context. Writes under derived/knowledge/pages/**, rebuilds the derived knowledge index, and rejects derived/runtime source inputs such as derived/** and .runtime/**.',
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
    id: 'research',
    bindingMode: 'none',
    rootCommandNames: ['research', 'deepthink'],
    leafCommands: [
      {
        path: ['research'],
        description:
          'Run ChatGPT Deep Research through review:gpt, auto-send the staged prompt, wait for the response, and save the markdown note into research/ inside the vault. These runs commonly take 10 to 60 minutes.',
        output: researchRunResultSchema,
      },
      {
        path: ['deepthink'],
        description:
          'Run GPT Pro through review:gpt, auto-send the staged prompt, wait for the response, and save the markdown note into research/ inside the vault.',
        output: researchRunResultSchema,
      },
    ],
    register({ cli }) {
      registerResearchCommands(cli)
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
  {
    id: 'inbox',
    bindingMode: 'direct',
    rootCommandNames: ['inbox'],
    directInboxServiceBindings: [
      'init',
      'bootstrap',
      'setup',
      'sourceAdd',
      'sourceList',
      'sourceRemove',
      'doctor',
      'parse',
      'requeue',
      'backfill',
      'run',
      'status',
      'stop',
      'list',
      'show',
      'search',
      'listAttachments',
      'showAttachment',
      'showAttachmentStatus',
      'parseAttachment',
      'reparseAttachment',
      'promoteMeal',
      'promoteDocument',
      'promoteJournal',
      'promoteExperimentNote',
    ],
    register({ cli, services, inboxServices }) {
      registerInboxCommands(cli, inboxServices, services)
    },
  },
  buildHealthCommandManifestDescriptor({
    commandName: 'profile',
    additionalVaultServiceBindings: {
      core: ['rebuildCurrentProfile'],
    },
    register({ cli, services }) {
      registerProfileCommands(cli, services)
    },
  }),
  ...genericHealthCommandDescriptors,
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
        path: ['supplement', 'scaffold'],
        description: 'Emit a payload template for one supplement product.',
        output: createHealthScaffoldResultSchema('supplement'),
      },
      {
        path: ['supplement', 'show'],
        description: 'Show one supplement by canonical id or slug.',
        output: healthShowResultSchema,
      },
      {
        path: ['supplement', 'upsert'],
        description: 'Upsert one supplement from a JSON payload file or stdin.',
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
      core: ['scaffoldSupplement', 'upsertSupplement', 'stopSupplement'],
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
  buildHealthCommandManifestDescriptor({
    commandName: 'protocol',
    additionalVaultServiceBindings: {
      core: ['stopProtocol'],
    },
    register({ cli, services }) {
      registerProtocolCommands(cli, services)
    },
  }),
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
    const directInboxServiceBindings =
      'directInboxServiceBindings' in descriptor
        ? descriptor.directInboxServiceBindings
        : undefined
    const hasVaultBindings = Object.keys(directVaultServiceBindings ?? {}).length > 0
    const hasInboxBindings = (directInboxServiceBindings?.length ?? 0) > 0

    if (!hasVaultBindings && !hasInboxBindings) {
      throw new Error(
        `Descriptor "${descriptor.id}" is marked direct but declares no direct service bindings.`,
      )
    }
  }
}

assertValidVaultCliCommandManifest(vaultCliCommandDescriptors)

export function registerVaultCliCommandDescriptors(input: {
  cli: Cli.Cli
  services: VaultServices
  inboxServices: InboxServices
}) {
  for (const descriptor of vaultCliCommandDescriptors) {
    descriptor.register(input)
  }
}

export function collectVaultCliDescriptorRootCommandNames() {
  return orderedUniqueStrings(
    vaultCliCommandDescriptors.flatMap((descriptor) => [...descriptor.rootCommandNames]),
  )
}

export function collectVaultCliDirectServiceBindings(): CollectedVaultCliDirectServiceBindings {
  const vaultBindings: Record<VaultServiceGroupName, string[]> = {
    core: [],
    importers: [],
    query: [],
    devices: [],
  }
  const inboxBindings: InboxServiceMethodName[] = []

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

    const directInboxServiceBindings =
      'directInboxServiceBindings' in descriptor
        ? descriptor.directInboxServiceBindings
        : undefined
    if (directInboxServiceBindings) {
      inboxBindings.push(...directInboxServiceBindings)
    }
  }

  return {
    inbox: orderedUniqueStrings(inboxBindings),
    vault: {
      core: vaultBindings.core as Array<Extract<keyof VaultServices['core'], string>>,
      importers:
        vaultBindings.importers as Array<
          Extract<keyof VaultServices['importers'], string>
        >,
      query: vaultBindings.query as Array<Extract<keyof VaultServices['query'], string>>,
      devices:
        vaultBindings.devices as Array<
          Extract<keyof VaultServices['devices'], string>
        >,
    },
  }
}
