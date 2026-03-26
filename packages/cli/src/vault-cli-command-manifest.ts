import { Cli, z } from 'incur'
import {
  createHealthScaffoldResultSchema,
  hasHealthCommandDescriptor,
  healthEntityDescriptorByCommandName,
  healthListResultSchema,
  healthShowResultSchema,
  type HealthCommandDescriptorEntry,
} from './health-cli-descriptors.js'
import type { InboxCliServices } from './inbox-services.js'
import type { VaultCliServices } from './vault-cli-services.js'
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
import { researchRunResultSchema } from './research-cli-contracts.js'
import { registerReadCommands } from './commands/read.js'
import { registerProtocolCommands } from './commands/protocol.js'
import { registerSamplesCommands } from './commands/samples.js'
import { registerSearchCommands } from './commands/search.js'
import { registerSupplementCommands } from './commands/supplement.js'
import { registerVaultCommands } from './commands/vault.js'
import { registerWorkoutCommands } from './commands/workout.js'

type VaultServiceGroupName = Extract<keyof VaultCliServices, string>
type InboxServiceMethodName = Extract<keyof InboxCliServices, string>
type CommandExample = Readonly<Record<string, unknown>>
type DirectVaultServiceBindings = {
  [TGroupName in VaultServiceGroupName]?: ReadonlyArray<
    Extract<keyof VaultCliServices[TGroupName], string>
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
    services: VaultCliServices
    inboxServices: InboxCliServices
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
      Extract<keyof VaultCliServices[TGroupName], string>
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
          'Record one workout from a freeform note with lightweight structured inference.',
      },
      {
        path: ['workout', 'format', 'save'],
        description:
          'Save or update one reusable workout format from a name plus workout text.',
      },
      {
        path: ['workout', 'format', 'show'],
        description: 'Show one saved workout format by name or slug.',
      },
      {
        path: ['workout', 'format', 'list'],
        description: 'List saved workout formats.',
      },
      {
        path: ['workout', 'format', 'log'],
        description:
          'Log one dated workout from a saved workout format through the same canonical event path as workout add.',
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
    register({ cli, services }) {
      registerInterventionCommands(cli, services)
    },
  },
  {
    id: 'provider',
    bindingMode: 'direct',
    rootCommandNames: ['provider'],
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
    register({ cli, services }) {
      registerSearchCommands(cli, services)
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
  services: VaultCliServices
  inboxServices: InboxCliServices
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
      core: vaultBindings.core as Array<Extract<keyof VaultCliServices['core'], string>>,
      importers:
        vaultBindings.importers as Array<
          Extract<keyof VaultCliServices['importers'], string>
        >,
      query: vaultBindings.query as Array<Extract<keyof VaultCliServices['query'], string>>,
      devices:
        vaultBindings.devices as Array<
          Extract<keyof VaultCliServices['devices'], string>
        >,
    },
  }
}
