import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createVaultCli } from '../src/index.js'

interface ScaffoldResult {
  vault: string
  noun: string
  kind?: string
  payload: Record<string, unknown>
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
