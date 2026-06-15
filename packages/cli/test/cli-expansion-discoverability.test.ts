import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createVaultCli } from '../src/index.js'

interface ScaffoldResult {
  vault: string
  noun: string
  kind?: string
  payload: Record<string, unknown>
}

interface LlmManifest {
  commands: Array<{
    examples?: Array<{
      command: string
      description?: string
    }>
    name: string
  }>
}

async function runRawCli(args: readonly string[]): Promise<string> {
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

  assert.ok(exitCode === null || exitCode === 0, `expected ${args.join(' ')} to succeed`)
  return output.join('').trim()
}

async function readLlmManifest(args: readonly string[]): Promise<LlmManifest> {
  return JSON.parse(
    await runRawCli([...args, '--llms-full', '--format', 'json']),
  ) as LlmManifest
}

async function readScaffold(args: readonly string[]): Promise<ScaffoldResult> {
  return JSON.parse(
    await runRawCli([...args, '--vault', './vault', '--format', 'json']),
  ) as ScaffoldResult
}

function assertPayloadFields(
  payload: Record<string, unknown>,
  expectedFields: readonly string[],
) {
  for (const field of expectedFields) {
    assert.equal(field in payload, true, `expected scaffold payload field ${field}`)
  }
}

function commandExample(
  manifest: LlmManifest,
  commandName: string,
  index = 0,
): string {
  const command = manifest.commands.find((candidate) => candidate.name === commandName)
  assert.notEqual(command, undefined, `missing ${commandName}`)

  const example = command?.examples?.[index]
  assert.notEqual(example, undefined, `missing example ${index} for ${commandName}`)
  return example?.command ?? ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const scaffoldCases = [
  {
    command: ['goal', 'scaffold'],
    llmsTokens: ['goal scaffold', 'payload', 'goal import-json'],
    noun: 'goal',
    payloadFields: ['title', 'status', 'metricTargets'],
  },
  {
    command: ['regimen', 'scaffold'],
    llmsTokens: ['regimen scaffold', 'payload'],
    noun: 'regimen',
    payloadFields: ['title', 'kind', 'status', 'ingredients', 'relatedGoalIds'],
  },
  {
    command: ['genetics', 'scaffold'],
    llmsTokens: ['genetics scaffold', 'payload', 'genetics import-json'],
    noun: 'genetics',
    payloadFields: ['title', 'gene', 'significance', 'sourceFamilyMemberIds'],
  },
] as const

const scopedLlmsCases = [
  {
    command: ['meal', 'add'],
    duplicate: 'vault-cli meal meal',
    expected: 'vault-cli meal add',
  },
  {
    command: ['food', 'save'],
    duplicate: 'vault-cli food food',
    expected: 'vault-cli food save',
  },
  {
    command: ['scheduled-log', 'save'],
    duplicate: 'vault-cli scheduled-log scheduled-log',
    expected: 'vault-cli scheduled-log save',
  },
  {
    command: ['supplement'],
    duplicate: 'vault-cli supplement supplement',
    expected: 'vault-cli supplement compound list',
  },
  {
    command: ['supplement', 'save'],
    duplicate: 'vault-cli supplement supplement',
    expected: "vault-cli supplement save 'Magnesium glycinate'",
  },
  {
    command: ['workout', 'format', 'save'],
    duplicate: 'vault-cli workout format workout format',
    expected: "vault-cli workout format save 'Upper Body A'",
  },
] as const

test.each(scaffoldCases)(
  '$noun scaffold is visible to LLM docs and emits representative payload fields',
  async ({ command, llmsTokens, noun, payloadFields }) => {
    const llmsFull = await runRawCli([...command, '--llms-full'])
    for (const token of llmsTokens) {
      assert.match(llmsFull, new RegExp(token, 'u'))
    }

    const scaffold = await readScaffold(command)
    assert.equal(scaffold.vault, './vault')
    assert.equal(scaffold.noun, noun)
    assertPayloadFields(scaffold.payload, payloadFields)
  },
)

test.each(scopedLlmsCases)(
  '$command scoped LLM markdown does not duplicate nested command prefixes',
  async ({ command, duplicate, expected }) => {
    const llmsFull = await runRawCli([...command, '--llms-full'])

    assert.doesNotMatch(llmsFull, new RegExp(escapeRegExp(duplicate), 'u'))
    assert.match(llmsFull, new RegExp(escapeRegExp(expected), 'u'))
  },
)

test('compact scoped LLM guidance also avoids duplicated group prefixes', async () => {
  const compact = await runRawCli(['supplement', '--llms'])

  assert.doesNotMatch(compact, /vault-cli supplement supplement/u)
  assert.match(compact, /vault-cli supplement save/u)
})

test('supplement LLM examples are copyable and avoid placeholder syntax', async () => {
  const manifest = await readLlmManifest(['supplement'])

  const batch = commandExample(manifest, 'supplement search-labels-batch')
  assert.match(
    batch,
    /supplement search-labels-batch --query 'creatine' --query 'magnesium glycinate' --query 'blueprint bryan johnson' --limit 5/u,
  )
  assert.doesNotMatch(batch, /creatine,magnesium glycinate/u)

  const save = commandExample(manifest, 'supplement save')
  assert.match(save, /supplement save 'Magnesium glycinate'/u)
  assert.doesNotMatch(save, /supplement save Magnesium glycinate --ingredient/u)

  const show = commandExample(manifest, 'supplement show')
  const stop = commandExample(manifest, 'supplement stop')
  const datedStop = commandExample(manifest, 'supplement stop', 1)
  for (const rendered of [show, stop, datedStop]) {
    assert.match(rendered, /magnesium-glycinate/u)
    assert.doesNotMatch(rendered, /<supplement-id>/u)
  }
})

test('food label LLM examples are copyable and avoid placeholder syntax', async () => {
  const manifest = await readLlmManifest(['food'])

  const search = commandExample(manifest, 'food search-labels')
  assert.match(search, /food search-labels 'plain greek yogurt' --limit 5/u)
  assert.doesNotMatch(search, /<food/u)

  const batch = commandExample(manifest, 'food search-labels-batch')
  assert.match(
    batch,
    /food search-labels-batch --query 'greek yogurt' --query 'whole milk' --query 'sourdough bread' --limit 5/u,
  )
  assert.doesNotMatch(batch, /greek yogurt,whole milk/u)
})

test('generic event scaffold docs stay visible without snapshotting every event branch', async () => {
  const llmsFull = await runRawCli(['event', 'scaffold', '--llms-full'])
  assert.match(llmsFull, /event scaffold/u)
  assert.match(llmsFull, /Canonical event kind to scaffold/u)
  assert.match(llmsFull, /payload/u)

  const scaffold = await readScaffold(['event', 'scaffold', '--kind', 'activity_session'])
  assert.equal(scaffold.noun, 'event')
  assert.equal(scaffold.kind, 'activity_session')
  assert.equal(scaffold.payload.kind, 'activity_session')
  assertPayloadFields(scaffold.payload, ['kind', 'occurredAt', 'title', 'activityType'])
})
