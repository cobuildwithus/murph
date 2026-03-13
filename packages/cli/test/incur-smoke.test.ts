import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { requireData, runCli, runRawCli } from './cli-test-helpers.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

test('root help exposes the Incur built-ins', async () => {
  const help = await runRawCli(['--help'])

  assert.match(help, new RegExp(`vault-cli@${packageJson.version ?? '0.0.0'}`, 'u'))
  assert.match(help, /Built-in Commands:/u)
  assert.match(help, /search\s+Search the local read model/u)
  assert.match(help, /timeline\s+Build a descending timeline/u)
  assert.match(help, /completions\s+Generate shell completion script/u)
  assert.match(help, /--schema\s+Show JSON Schema for a command/u)
  assert.match(help, /--verbose\s+Show full output envelope/u)
  assert.match(help, /--llms, --llms-full\s+Print LLM-readable manifest/u)
})

test('root help preserves simple health CRUD command ordering around bespoke groups', async () => {
  const help = await runRawCli(['--help'])
  const orderedCommands = [
    'profile',
    'goal',
    'condition',
    'allergy',
    'regimen',
    'history',
    'family',
    'genetics',
  ]

  const positions = orderedCommands.map((command) => {
    const position = help.search(new RegExp(`^\\s+${command}\\s+`, 'mu'))
    assert.notEqual(position, -1, `expected root help to list ${command}`)
    return position
  })

  assert.deepEqual([...positions].sort((left, right) => left - right), positions)
})

test('search schema exposes retrieval-specific filters', async () => {
  const schema = JSON.parse(
    await runRawCli(['search', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('text' in schema.options.properties, true)
  assert.equal('backend' in schema.options.properties, true)
  assert.equal('recordType' in schema.options.properties, true)
  assert.equal('entryType' in schema.options.properties, false)
  assert.deepEqual(schema.options.required, ['vault', 'text', 'limit'])
})

test('profile show help exposes only the global format flag', async () => {
  const help = await runRawCli(['profile', 'show', '--help'])

  assert.match(help, /Usage: vault-cli profile show <id> \[options\]/u)
  assert.doesNotMatch(help, /Options:[\s\S]*--format <json\|md>/u)
  assert.match(help, /Global Options:[\s\S]*--format <toon\|json\|yaml\|md\|jsonl>/u)
})

test('health command help surfaces examples and hints through Incur metadata', async () => {
  const profileUpsertHelp = await runRawCli(['profile', 'upsert', '--help'])
  const profileRebuildHelp = await runRawCli(['profile', 'current', 'rebuild', '--help'])
  const regimenStopHelp = await runRawCli(['regimen', 'stop', '--help'])

  assert.match(
    profileUpsertHelp,
    /vault-cli profile upsert --input @profile-snapshot\.json --vault \.\/vault/u,
  )
  assert.match(
    profileUpsertHelp,
    /--input expects @file\.json so the CLI can load the structured profile snapshot payload from disk\./u,
  )
  assert.match(
    profileRebuildHelp,
    /Run this after accepting a snapshot if you need to refresh the derived current profile document immediately\./u,
  )
  assert.match(
    regimenStopHelp,
    /Use the canonical regimen id so the stop event is attached to the existing registry record\./u,
  )
})

test('command schema reflects only domain-specific options', async () => {
  const schema = JSON.parse(
    await runRawCli(['init', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.deepEqual(Object.keys(schema.options.properties), ['vault', 'requestId'])
  assert.deepEqual(schema.options.required, ['vault'])
})

test('health command schema remains JSON-Schema-safe', async () => {
  const schema = JSON.parse(
    await runRawCli(['profile', 'upsert', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'input'])
})

test.sequential('verbose json exposes the native Incur success envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-incur-'))

  try {
    const result = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])

    assert.equal(result.ok, true)
    assert.equal(result.meta.command, 'init')
    assert.equal(requireData(result).created, true)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('health command metadata exposes Incur-native CTA suggestions', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-incur-'))

  try {
    const result = await runCli<{ noun: string }>(['profile', 'scaffold', '--vault', vaultRoot])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).noun, 'profile')
    assert.equal(
      result.meta.cta?.commands.some((command) =>
        command.command.includes('vault-cli profile upsert'),
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('compact llms json manifest remains available', async () => {
  const manifest = JSON.parse(
    await runRawCli(['--llms', '--format', 'json']),
  ) as {
    version: string
    commands: Array<{ name: string }>
  }

  assert.equal(manifest.version, 'incur.v1')
  assert.equal(manifest.commands.some((command) => command.name === 'init'), true)
  assert.equal(
    manifest.commands.some((command) => command.name === 'profile show'),
    true,
  )
})

test('full llms json manifest remains available for schema-rich commands', async () => {
  const manifest = JSON.parse(
    await runRawCli(['--llms-full', '--format', 'json']),
  ) as {
    commands: Array<{
      name: string
      options?: Record<string, unknown>
    }>
  }

  assert.equal(
    manifest.commands.some((command) => command.name === 'profile upsert'),
    true,
  )
})

test('bash completions remain available', async () => {
  const script = await runRawCli(['completions', 'bash'])

  assert.match(script, /_incur_complete_vault_cli/u)
  assert.match(
    script,
    /complete -o default -o bashdefault -o nosort -F _incur_complete_vault_cli vault-cli/u,
  )
})

test('goal scaffold help surfaces factory-provided example and hint text', async () => {
  const help = await runRawCli(['goal', 'scaffold', '--help'])

  assert.match(
    help,
    /vault-cli goal scaffold --vault \.\/vault  # Print a template goal payload\./u,
  )
  assert.match(
    help,
    /Edit the emitted payload, save it as goal\.json, then pass it back with --input @goal\.json\./u,
  )
})

test.sequential('profile scaffold exposes a success CTA in the verbose json envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-incur-cta-'))

  try {
    const initResult = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const scaffoldResult = await runCli<{
      noun: string
      payload: Record<string, unknown>
    }>(['profile', 'scaffold', '--vault', vaultRoot])

    assert.equal(scaffoldResult.ok, true)
    assert.equal(scaffoldResult.meta.command, 'profile scaffold')
    assert.equal(requireData(scaffoldResult).noun, 'profile')
    assert.deepEqual(scaffoldResult.meta.cta?.commands, [
      {
        command: 'vault-cli profile upsert --input @profile-snapshot.json --vault <vault>',
        description: 'Apply the edited profile snapshot payload.',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
