import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'
import { createVaultCli } from '../src/vault-cli.js'

const BASE_OPTION_NAMES = new Set(['requestId', 'vault'])
const healthRegistryJsonHardCutNouns = [
  'allergy',
  'blood-test',
  'condition',
  'family',
  'genetics',
  'goal',
  'immunization',
] as const

const jsonImportHardCutCommandNames = [
  ...healthRegistryJsonHardCutNouns,
  'automation',
  'food',
  'protocol',
  'provider',
  'recipe',
  'scheduled-log',
] as const

interface CommandGuard {
  label: string
  commandNames: readonly string[]
  fieldHints: readonly string[]
}

interface ManifestCommand {
  name: string
  schema: JsonRecord
}

type JsonRecord = Record<string, unknown>

const canonicalTypedCommands = [
  {
    label: 'experiment checkpoint',
    commandNames: ['experiment checkpoint'],
    fieldHints: ['id', 'lookup', 'occurredAt', 'title', 'note'],
  },
  {
    label: 'experiment session log',
    commandNames: ['experiment session log'],
    fieldHints: [
      'id',
      'lookup',
      'reminderIntentId',
      'interventionType',
      'durationMinutes',
      'sessionStatus',
      'status',
      'confounder',
      'note',
    ],
  },
  {
    label: 'experiment context log',
    commandNames: ['experiment context log'],
    fieldHints: [
      'id',
      'lookup',
      'kind',
      'contextType',
      'supplementName',
      'severity',
      'note',
    ],
  },
  {
    label: 'samples add',
    commandNames: ['samples add'],
    fieldHints: ['stream', 'recordedAt', 'value', 'stage', 'unit', 'sourcePath', 'batch'],
  },
  {
    label: 'event note add',
    commandNames: ['event note add', 'event add note'],
    fieldHints: ['note', 'title', 'occurredAt', 'tag'],
  },
  {
    label: 'event symptom add',
    commandNames: ['event symptom add', 'event add symptom'],
    fieldHints: ['symptom', 'severity', 'title', 'occurredAt', 'tag'],
  },
  {
    label: 'event observation add',
    commandNames: ['event observation add', 'event add observation'],
    fieldHints: ['observation', 'value', 'title', 'note', 'occurredAt', 'tag'],
  },
  {
    label: 'event intake add',
    commandNames: [
      'event intake add',
      'event supplement-intake add',
      'event supplement intake add',
      'event medication-intake add',
      'event medication intake add',
    ],
    fieldHints: [
      'kind',
      'name',
      'supplementName',
      'medicationName',
      'dose',
      'unit',
      'occurredAt',
    ],
  },
  {
    label: 'event encounter add',
    commandNames: ['event encounter add'],
    fieldHints: ['encounterType', 'location', 'providerId', 'occurredAt', 'note'],
  },
  {
    label: 'event procedure add',
    commandNames: ['event procedure add'],
    fieldHints: ['procedure', 'status', 'occurredAt', 'note'],
  },
  {
    label: 'event adverse-effect add',
    commandNames: ['event adverse-effect add'],
    fieldHints: ['substance', 'effect', 'severity', 'occurredAt', 'note'],
  },
  {
    label: 'event exposure add',
    commandNames: ['event exposure add'],
    fieldHints: ['exposureType', 'substance', 'duration', 'occurredAt', 'note'],
  },
  {
    label: 'supplement save',
    commandNames: ['supplement save'],
    fieldHints: [
      'title',
      'name',
      'slug',
      'ingredient',
      'dose',
      'doseUnit',
      'substance',
      'status',
    ],
  },
  {
    label: 'regimen save',
    commandNames: ['regimen save'],
    fieldHints: [
      'title',
      'kind',
      'slug',
      'dose',
      'schedule',
      'status',
      'brand',
      'servingSize',
      'ingredientCompound',
      'ingredientActive',
      'note',
    ],
  },
  {
    label: 'medication history add',
    commandNames: ['medication history add'],
    fieldHints: [
      'title',
      'startedOn',
      'stoppedOn',
      'substance',
      'dose',
      'unit',
      'schedule',
      'note',
    ],
  },
  {
    label: 'condition save',
    commandNames: ['condition save'],
    fieldHints: [
      'title',
      'slug',
      'clinicalStatus',
      'verificationStatus',
      'assertedOn',
      'resolvedOn',
      'severity',
      'bodySite',
      'relatedGoalId',
      'relatedRegimenId',
      'note',
    ],
  },
  {
    label: 'allergy save',
    commandNames: ['allergy save'],
    fieldHints: [
      'title',
      'slug',
      'substance',
      'status',
      'criticality',
      'reaction',
      'recordedOn',
      'relatedConditionId',
      'note',
    ],
  },
  {
    label: 'goal save',
    commandNames: ['goal save'],
    fieldHints: [
      'title',
      'slug',
      'status',
      'horizon',
      'priority',
      'startAt',
      'targetAt',
      'parentGoalId',
      'relatedGoalId',
      'relatedExperimentId',
      'domain',
    ],
  },
  {
    label: 'immunization save',
    commandNames: ['immunization save'],
    fieldHints: [
      'vaccineName',
      'occurredAt',
      'manufacturer',
      'lotNumber',
      'route',
      'site',
      'targetDisease',
    ],
  },
  {
    label: 'family save',
    commandNames: ['family save'],
    fieldHints: [
      'title',
      'relationship',
      'condition',
      'deceased',
      'relatedVariantId',
      'note',
    ],
  },
  {
    label: 'genetics save',
    commandNames: ['genetics save'],
    fieldHints: [
      'title',
      'gene',
      'slug',
      'zygosity',
      'significance',
      'inheritance',
      'sourceFamilyMemberId',
      'note',
    ],
  },
  {
    label: 'automation save',
    commandNames: ['automation save'],
    fieldHints: [
      'title',
      'id',
      'slug',
      'status',
      'summary',
      'tags',
      'continuityPolicy',
      'instructions',
      'scheduleKind',
      'scheduleAt',
      'scheduleEveryMs',
      'scheduleCron',
      'scheduleLocalTime',
      'channel',
      'deliveryTarget',
      'identityId',
      'participantId',
      'threadId',
      'assistantTargetOverrideModel',
      'assistantTargetOverrideModelProvider',
      'assistantTargetOverrideReasoningEffort',
    ],
  },
  {
    label: 'automation edit',
    commandNames: ['automation edit'],
    fieldHints: [
      'lookup',
      'title',
      'slug',
      'status',
      'summary',
      'tags',
      'continuityPolicy',
      'instructions',
      'scheduleKind',
      'scheduleAt',
      'scheduleEveryMs',
      'scheduleCron',
      'scheduleLocalTime',
      'channel',
      'deliveryTarget',
      'identityId',
      'participantId',
      'threadId',
      'assistantTargetOverrideModel',
      'assistantTargetOverrideModelProvider',
      'assistantTargetOverrideReasoningEffort',
      'clearAssistantTargetOverride',
    ],
  },
  {
    label: 'capture add',
    commandNames: ['capture add'],
    fieldHints: ['media', 'label', 'bodySite', 'collection', 'relatedId', 'timeZone'],
  },
  {
    label: 'meal add',
    commandNames: ['meal add'],
    fieldHints: [
      'photo',
      'audio',
      'note',
      'ingredient',
      'nutritionCalories',
      'nutritionSource',
    ],
  },
  {
    label: 'measurement add',
    commandNames: ['measurement add'],
    fieldHints: ['metric', 'value', 'unit', 'measurementNote', 'tag', 'timeZone'],
  },
  {
    label: 'workout add',
    commandNames: ['workout add'],
    fieldHints: [
      'text',
      'note',
      'title',
      'workoutSourceApp',
      'workoutExercise',
      'workoutSet',
    ],
  },
  {
    label: 'workout format save',
    commandNames: ['workout format save'],
    fieldHints: [
      'name',
      'workoutFormatId',
      'slug',
      'templateText',
      'exercise',
      'setTemplate',
    ],
  },
  {
    label: 'document edit',
    commandNames: ['document edit'],
    fieldHints: ['title', 'note', 'occurredAt', 'dayKeyPolicy'],
  },
  {
    label: 'event edit',
    commandNames: ['event edit'],
    fieldHints: ['title', 'note', 'occurredAt', 'dayKeyPolicy'],
  },
  {
    label: 'meal edit',
    commandNames: ['meal edit'],
    fieldHints: ['note', 'ingredient', 'nutritionCalories', 'dayKeyPolicy'],
  },
  {
    label: 'workout edit',
    commandNames: ['workout edit'],
    fieldHints: ['note', 'duration', 'type', 'workoutExercise', 'dayKeyPolicy'],
  },
  {
    label: 'intervention edit',
    commandNames: ['intervention edit'],
    fieldHints: ['note', 'type', 'duration', 'regimenId', 'sessionStatus', 'dayKeyPolicy'],
  },
  {
    label: 'provider edit',
    commandNames: ['provider edit'],
    fieldHints: ['title', 'slug', 'status', 'specialty', 'alias'],
  },
  {
    label: 'food edit',
    commandNames: ['food edit'],
    fieldHints: ['title', 'slug', 'status', 'ingredient', 'nutritionSource'],
  },
  {
    label: 'recipe edit',
    commandNames: ['recipe edit'],
    fieldHints: ['title', 'slug', 'status', 'ingredient', 'step'],
  },
] as const satisfies readonly CommandGuard[]

const typedPatchEditCommandNames = [
  'document edit',
  'event edit',
  'meal edit',
  'workout edit',
  'intervention edit',
  'provider edit',
  'food edit',
  'recipe edit',
] as const

const genericPatchOptionNames = ['input', 'set', 'clear'] as const

test('canonical agent write commands expose typed schemas without primary JSON input blobs', async () => {
  const commands = await loadFullLlmCommands()
  const failures: string[] = []

  for (const guard of canonicalTypedCommands) {
    const command = findManifestCommand(commands, guard)

    if (!command) {
      failures.push(formatMissingManifestCommand(commands, guard))
      continue
    }

    collectAssertionFailure(failures, `${command.name} llms schema`, () => {
      assertCanonicalTypedSchema(command.name, command.schema, guard.fieldHints)
    })

    try {
      const schema = await loadCommandSchema(command.name)
      collectAssertionFailure(failures, `${command.name} direct schema`, () => {
        assertCanonicalTypedSchema(command.name, schema, guard.fieldHints)
      })
    } catch (error) {
      failures.push(`${command.name} direct schema: ${errorMessage(error)}`)
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'))
})

test('explicit JSON fallback commands remain separate from the canonical typed surfaces', async () => {
  const commands = await loadFullLlmCommands()
  const commandNames = new Set(commands.map((command) => command.name))

  for (const [typedName, jsonName, typedHint] of [
    ['capture add', 'capture import-json', 'media'],
    ['samples add', 'samples import-json', 'stream'],
    ['event note add', 'event import-json', 'note'],
    ['meal add', 'meal import-json', 'ingredient'],
    ['measurement add', 'measurement import-json', 'metric'],
    ['workout add', 'workout import-json', 'text'],
    ['workout format save', 'workout format import-json', 'name'],
    ['goal save', 'goal import-json', 'title'],
    ['condition save', 'condition import-json', 'title'],
    ['allergy save', 'allergy import-json', 'title'],
    ['regimen save', 'regimen import-json', 'title'],
    ['family save', 'family import-json', 'title'],
    ['genetics save', 'genetics import-json', 'gene'],
    ['automation save', 'automation import-json', 'title'],
    ['provider save', 'provider import-json', 'title'],
    ['food save', 'food import-json', 'title'],
    ['recipe save', 'recipe import-json', 'title'],
    ['blood-test save', 'blood-test import-json', 'title'],
    ['immunization save', 'immunization import-json', 'vaccineName'],
    ['scheduled-log save', 'scheduled-log import-json', 'title'],
  ] as const) {
    assert.equal(commandNames.has(typedName), true)
    assert.equal(commandNames.has(jsonName), true)

    const typedCommand = requireManifestCommand(commands, {
      label: typedName,
      commandNames: [typedName],
      fieldHints: [typedHint],
    })
    const jsonCommand = requireManifestCommand(commands, {
      label: jsonName,
      commandNames: [jsonName],
      fieldHints: ['input'],
    })

    assert.equal(
      schemaIncludesProperty(typedCommand.schema, 'input'),
      false,
      `${typedName} must stay the typed agent-first surface`,
    )
    assert.equal(
      schemaIncludesProperty(jsonCommand.schema, 'input'),
      true,
      `${jsonName} is the explicit JSON payload fallback`,
    )
  }
})

test('legacy hard-cut command aliases stay out of the agent command manifest', async () => {
  const commands = await loadFullLlmCommands()
  const commandNames = new Set(commands.map((command) => command.name))

  const legacyNames = [
    ['allergy', 'upsert'],
    ['automation', 'upsert'],
    ['blood-test', 'upsert'],
    ['condition', 'upsert'],
    ['event', 'upsert'],
    ['encounter', 'save'],
    ['experiment', 'create'],
    ['family', 'upsert'],
    ['food', 'upsert'],
    ['genetics', 'upsert'],
    ['goal', 'upsert'],
    ['provider', 'upsert'],
    ['recipe', 'upsert'],
    ['scheduled-log', 'upsert'],
    ['supplement', 'import-json'],
    ['supplement', 'rename'],
    ['supplement', 'scaffold'],
    ['supplement', 'upsert'],
    ['protocol', 'profile', 'upsert'],
    ['protocol', 'save'],
    ['protocol', 'upsert'],
    ['protocol', 'scaffold'],
    ['protocol', 'stop'],
  ].map((segments) => segments.join(' '))

  for (const legacyName of legacyNames) {
    assert.equal(
      commandNames.has(legacyName),
      false,
      `${legacyName} must not remain an agent-visible compatibility command`,
    )
  }
})

test('capture import-json exposes a paired Incur-discoverable payload-schema sibling so its complex --input @file body satisfies the agent-visible payload invariant', async () => {
  const commands = await loadFullLlmCommands()
  const commandNames = new Set(commands.map((command) => command.name))

  assert.equal(commandNames.has('capture import-json'), true)
  assert.equal(commandNames.has('capture payload-schema'), true)
})

test('agent-visible input-file command surfaces stay explicitly reviewed', async () => {
  const commands = await loadFullLlmCommands()
  const reviewedInputCommands = [
    'age calculate',
    'age calculate-bundle',
    'age evidence',
    'age preview',
    'age preview-view',
    'allergy import-json',
    'assertion import-json',
    'automation import-json',
    'blood-test import-json',
    'capture import-json',
    'clinical-note import-json',
    'condition import-json',
    'diagnostic-test import-json',
    'encounter import-json',
    'event import-json',
    'event import-jsonl',
    'family import-json',
    'food import-json',
    'genetics import-json',
    'goal import-json',
    'immunization import-json',
    'knowledge score-challenge',
    'meal import-json',
    'measurement import-json',
    'protocol import-json',
    'provider import-json',
    'regimen import-json',
    'recipe import-json',
    'research scout',
    'research scout-batch',
    'samples import-json',
    'scheduled-log import-json',
    'social-history import-json',
    'vitals import-json',
    'workout format import-json',
    'workout import-json',
  ].sort()

  const inputCommands = commands
    .filter((command) => schemaIncludesProperty(command.schema, 'input'))
    .map((command) => command.name)
    .sort()

  assert.deepEqual(inputCommands, reviewedInputCommands)
})

test('murph age submitted-data commands stay in generated agent artifacts', async () => {
  const commands = await loadFullLlmCommands()
  const generatedTypes = await readFile(
    new URL('../src/incur.generated.ts', import.meta.url),
    'utf8',
  )
  const configSchema = parseJsonObject(
    await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'),
    'config schema',
  )
  const previewCommand = requireManifestCommand(commands, {
    label: 'age preview',
    commandNames: ['age preview'],
    fieldHints: ['input', 'modelCardArtifactRoot'],
  })
  const calculateCommand = requireManifestCommand(commands, {
    label: 'age calculate',
    commandNames: ['age calculate'],
    fieldHints: ['input', 'mode', 'modelCardArtifactRoot'],
  })
  const calculateBundleCommand = requireManifestCommand(commands, {
    label: 'age calculate-bundle',
    commandNames: ['age calculate-bundle'],
    fieldHints: ['input', 'includeResearchPreview', 'modelCardArtifactRoot'],
  })
  const scaffoldCommand = requireManifestCommand(commands, {
    label: 'age scaffold',
    commandNames: ['age scaffold'],
    fieldHints: [],
  })

  assert.equal(schemaIncludesProperty(calculateCommand.schema, 'input'), true)
  assert.equal(schemaIncludesProperty(calculateCommand.schema, 'mode'), true)
  assert.equal(schemaIncludesProperty(calculateCommand.schema, 'modelCardArtifactRoot'), true)
  assert.equal(schemaIncludesProperty(calculateBundleCommand.schema, 'input'), true)
  assert.equal(schemaIncludesProperty(calculateBundleCommand.schema, 'includeResearchPreview'), true)
  assert.equal(schemaIncludesProperty(calculateBundleCommand.schema, 'modelCardArtifactRoot'), true)
  assert.equal(schemaIncludesProperty(previewCommand.schema, 'input'), true)
  assert.equal(schemaIncludesProperty(previewCommand.schema, 'modelCardArtifactRoot'), true)
  assert.equal(schemaIncludesProperty(scaffoldCommand.schema, 'input'), false)
  assert.match(generatedTypes, /'age calculate': \{ args: \{\}; options: \{ input: string; mode: "product" \| "research"; modelCardArtifactRoot\?: string \} \}/u)
  assert.match(generatedTypes, /'age calculate-bundle': \{ args: \{\}; options: \{ input: string; includeResearchPreview: boolean; modelCardArtifactRoot\?: string \} \}/u)
  assert.match(generatedTypes, /'age preview': \{ args: \{\}; options: \{ input: string; modelCardArtifactRoot\?: string \} \}/u)
  assert.match(generatedTypes, /'age scaffold': \{ args: \{\}; options: \{\} \}/u)
  assert.deepEqual(commandConfigOptionNames(configSchema, 'age calculate').sort(), [
    'input',
    'mode',
    'modelCardArtifactRoot',
  ])
  assert.deepEqual(commandConfigOptionNames(configSchema, 'age calculate-bundle').sort(), [
    'includeResearchPreview',
    'input',
    'modelCardArtifactRoot',
  ])
  assert.deepEqual(commandConfigOptionNames(configSchema, 'age preview').sort(), [
    'input',
    'modelCardArtifactRoot',
  ])
  assert.deepEqual(commandConfigOptionNames(configSchema, 'age scaffold'), [])
})

test('patch-style edit commands expose typed fields instead of generic patch flags', async () => {
  const commands = await loadFullLlmCommands()
  const generatedTypes = await readFile(
    new URL('../src/incur.generated.ts', import.meta.url),
    'utf8',
  )
  const configSchema = parseJsonObject(
    await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'),
    'config schema',
  )
  const failures: string[] = []

  for (const commandName of typedPatchEditCommandNames) {
    const manifestCommand = requireManifestCommand(commands, {
      label: commandName,
      commandNames: [commandName],
      fieldHints: ['title', 'note', 'status', 'ingredient', 'duration'],
    })
    const directSchema = await loadCommandSchema(commandName)
    const configOptions = commandConfigOptionNames(configSchema, commandName)
    const generatedLinePattern = new RegExp(
      `'${commandName}': \\{[^\\n]+options: \\{([^\\n]+)\\}`,
      'u',
    )
    const generatedLine = generatedTypes.match(generatedLinePattern)?.[1] ?? ''

    for (const optionName of genericPatchOptionNames) {
      collectAssertionFailure(failures, `${commandName} llms ${optionName}`, () => {
        assert.equal(schemaIncludesProperty(manifestCommand.schema, optionName), false)
      })
      collectAssertionFailure(failures, `${commandName} schema ${optionName}`, () => {
        assert.equal(schemaIncludesProperty(directSchema, optionName), false)
      })
      collectAssertionFailure(failures, `${commandName} config ${optionName}`, () => {
        assert.equal(configOptions.includes(optionName), false)
      })
      collectAssertionFailure(failures, `${commandName} generated ${optionName}`, () => {
        assert.equal(new RegExp(`\\b${optionName}\\??:`, 'u').test(generatedLine), false)
      })
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'))
})

test('health registry import-json hard cut is reflected in generated artifacts and help', async () => {
  const generatedTypes = await readFile(
    new URL('../src/incur.generated.ts', import.meta.url),
    'utf8',
  )
  const configSchema = parseJsonObject(
    await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'),
    'config schema',
  )
  const rootCommands = requireRecord(
    requireRecord(
      requireRecord(configSchema.properties, 'config schema.properties').commands,
      'config schema.properties.commands',
    ).properties,
    'config schema.properties.commands.properties',
  )

  for (const noun of jsonImportHardCutCommandNames) {
    assert.match(generatedTypes, new RegExp(`'${noun} import-json':`, 'u'))
    assert.doesNotMatch(generatedTypes, new RegExp(`'${noun} upsert':`, 'u'))

    const nounCommands = requireRecord(
      requireRecord(
        requireRecord(rootCommands[noun], `config schema commands.${noun}`).properties,
        `config schema commands.${noun}.properties`,
      ).commands,
      `config schema commands.${noun}.properties.commands`,
    )
    const commandProperties = requireRecord(
      nounCommands.properties,
      `config schema commands.${noun}.commands.properties`,
    )
    assert.equal('import-json' in commandProperties, true)
    assert.equal('upsert' in commandProperties, false)

    if (noun !== 'protocol') {
      const saveHelp = await runSourceCliRaw([noun, 'save', '--help'])
      assert.match(saveHelp, new RegExp(`${noun} import-json`, 'u'))
      assert.doesNotMatch(saveHelp, new RegExp(`${noun} upsert`, 'u'))
    }
  }
})

async function runSourceCliRaw(args: readonly string[]): Promise<string> {
  const cli = createVaultCli()
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  if (exitCode !== null && exitCode !== 0) {
    assert.fail(`source CLI exited ${exitCode} for ${args.join(' ')}`)
  }

  return output.join('').trim()
}

async function loadFullLlmCommands(): Promise<ManifestCommand[]> {
  const manifest = parseJsonObject(
    await runSourceCliRaw(['--llms-full', '--format', 'json']),
    'llms manifest',
  )
  const commands = requireArray(manifest.commands, 'llms manifest commands')

  return commands.map((value, index) => {
    const command = requireRecord(value, `llms manifest commands[${index}]`)
    const name = requireString(command.name, `llms manifest commands[${index}].name`)
    const schema = requireRecord(
      command.schema,
      `llms manifest commands[${index}].schema`,
    )

    return { name, schema }
  })
}

async function loadCommandSchema(commandName: string): Promise<JsonRecord> {
  return parseJsonObject(
    await runSourceCliRaw([...commandName.split(' '), '--schema', '--format', 'json']),
    `${commandName} schema`,
  )
}

function requireManifestCommand(
  commands: readonly ManifestCommand[],
  guard: CommandGuard,
): ManifestCommand {
  const command = findManifestCommand(commands, guard)

  if (!command) {
    assert.fail(formatMissingManifestCommand(commands, guard))
  }

  return command
}

function findManifestCommand(
  commands: readonly ManifestCommand[],
  guard: CommandGuard,
): ManifestCommand | undefined {
  const commandNameSet = new Set(guard.commandNames)
  return commands.find((candidate) => commandNameSet.has(candidate.name))
}

function formatMissingManifestCommand(
  commands: readonly ManifestCommand[],
  guard: CommandGuard,
): string {
  const rootNames = new Set(guard.commandNames.map((name) => name.split(' ')[0] ?? name))
  const available = commands
    .map((candidate) => candidate.name)
    .filter((name) => rootNames.has(name.split(' ')[0] ?? name))
    .sort((left, right) => left.localeCompare(right))

  return `${guard.label} is missing from the LLM command manifest. Tried ${guard.commandNames.join(
    ', ',
  )}. Available matching commands: ${available.join(', ')}`
}

function collectAssertionFailure(
  failures: string[],
  label: string,
  action: () => void,
) {
  try {
    action()
  } catch (error) {
    failures.push(`${label}: ${errorMessage(error)}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertCanonicalTypedSchema(
  commandName: string,
  schema: JsonRecord,
  fieldHints: readonly string[],
) {
  assert.equal(
    schemaIncludesProperty(schema, 'input'),
    false,
    `${commandName} must not expose a generic input payload on its canonical schema`,
  )
  assert.equal(
    requiredFields(schema, 'args').includes('input'),
    false,
    `${commandName} must not require a positional input payload`,
  )
  assert.equal(
    requiredFields(schema, 'options').includes('input'),
    false,
    `${commandName} must not require --input as its primary agent input`,
  )

  const typedFieldNames = commandFieldNames(schema).filter(
    (fieldName) => !BASE_OPTION_NAMES.has(fieldName),
  )
  assert.notEqual(
    typedFieldNames.length,
    0,
    `${commandName} should expose at least one concrete typed arg or option`,
  )
  assert.equal(
    fieldHints.some((fieldName) => typedFieldNames.includes(fieldName)),
    true,
    `${commandName} should expose one of: ${fieldHints.join(', ')}`,
  )
}

function schemaIncludesProperty(schema: JsonRecord, propertyName: string): boolean {
  return (
    propertyName in schemaProperties(schema, 'args') ||
    propertyName in schemaProperties(schema, 'options')
  )
}

function commandFieldNames(schema: JsonRecord): string[] {
  return [
    ...Object.keys(schemaProperties(schema, 'args')),
    ...Object.keys(schemaProperties(schema, 'options')),
  ]
}

function schemaProperties(schema: JsonRecord, key: 'args' | 'options'): JsonRecord {
  const objectSchema = requireRecord(schema[key], `schema.${key}`)
  const properties = objectSchema.properties
  return properties === undefined
    ? {}
    : requireRecord(properties, `schema.${key}.properties`)
}

function requiredFields(schema: JsonRecord, key: 'args' | 'options'): string[] {
  const objectSchema = requireRecord(schema[key], `schema.${key}`)
  const required = objectSchema.required

  if (required === undefined) {
    return []
  }

  const values = requireArray(required, `schema.${key}.required`)
  return values.map((value, index) =>
    requireString(value, `schema.${key}.required[${index}]`),
  )
}

function commandConfigOptionNames(
  configSchema: JsonRecord,
  commandName: string,
): string[] {
  const rootCommands = requireRecord(
    requireRecord(
      requireRecord(configSchema.properties, 'config schema.properties').commands,
      'config schema.properties.commands',
    ).properties,
    'config schema.properties.commands.properties',
  )
  const segments = commandName.split(' ')
  let currentCommands = rootCommands

  for (const [index, segment] of segments.entries()) {
    const commandSchema = requireRecord(
      currentCommands[segment],
      `config schema command ${segments.slice(0, index + 1).join(' ')}`,
    )
    if (commandSchema.properties === undefined && index === segments.length - 1) {
      return []
    }
    const commandProperties = requireRecord(
      commandSchema.properties,
      `config schema command ${segments.slice(0, index + 1).join(' ')} properties`,
    )

    if (index === segments.length - 1) {
      const options = commandProperties.options
      if (options === undefined) {
        return []
      }
      return Object.keys(
        requireRecord(
          requireRecord(options, `${commandName} options`).properties,
          `${commandName} option properties`,
        ),
      )
    }

    const nestedCommands = requireRecord(
      commandProperties.commands,
      `config schema command ${segments.slice(0, index + 1).join(' ')} commands`,
    )
    currentCommands = requireRecord(
      nestedCommands.properties,
      `config schema command ${segments.slice(0, index + 1).join(' ')} command properties`,
    )
  }

  return []
}

function parseJsonObject(text: string, label: string): JsonRecord {
  const parsed: unknown = JSON.parse(text)
  return requireRecord(parsed, label)
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    assert.fail(`${label} must be an array`)
  }

  return value
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    assert.fail(`${label} must be an object`)
  }

  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} must be a string`)
  }

  return value
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
