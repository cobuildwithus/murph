import assert from 'node:assert/strict'
import { Cli, z } from 'incur'
import { estimateTokenCount } from 'tokenx'
import { test } from 'vitest'

import { installVaultCliSchemaIndex } from '../src/vault-cli-schema-index.js'

interface RawCliResult {
  exitCode: number | null
  output: string
}

function createSchemaIndexCli(): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: 'Synthetic schema index test CLI.',
  })
  const records = Cli.create('records', {
    description: 'Inspect synthetic records.',
  })

  for (let index = 0; index < 24; index += 1) {
    const commandName = `read-${index}`
    records.command(commandName, {
      description: `Read synthetic record ${index}.`,
      args: z.object({
        id: z.string().describe(`Synthetic identifier ${'detail '.repeat(120)}`),
      }),
      output: z.object({
        id: z.string(),
        payload: z.string().describe(`Synthetic payload ${'shape '.repeat(120)}`),
      }),
      run({ args }) {
        return {
          id: args.id,
          payload: 'synthetic',
        }
      },
    })
  }

  cli.command(records)
  installVaultCliSchemaIndex(cli)
  return cli
}

async function runRawCli(cli: Cli.Cli, argv: string[]): Promise<RawCliResult> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(argv, {
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    exitCode,
    output: output.join(''),
  }
}

test('root and group schema indexes project compact command descriptors', async () => {
  const cli = createSchemaIndexCli()
  const rootResult = await runRawCli(cli, ['--schema', '--format', 'json'])
  const groupResult = await runRawCli(cli, [
    'records',
    '--schema',
    '--format',
    'json',
  ])
  const manifestResult = await runRawCli(cli, [
    '--llms-full',
    '--format',
    'json',
  ])

  assert.equal(rootResult.exitCode, null)
  assert.equal(groupResult.exitCode, null)
  assert.equal(manifestResult.exitCode, null)

  const rootIndex = JSON.parse(rootResult.output) as {
    command: string | null
    commands: Array<Record<string, unknown>>
    kind: string
    version: string
  }
  const groupIndex = JSON.parse(groupResult.output) as typeof rootIndex

  assert.equal(rootIndex.version, 'murph.schema-index.v1')
  assert.equal(rootIndex.kind, 'root')
  assert.equal(rootIndex.command, null)
  assert.equal(groupIndex.kind, 'group')
  assert.equal(groupIndex.command, 'records')
  assert.deepEqual(rootIndex.commands, groupIndex.commands)
  assert.equal(rootIndex.commands.length, 24)
  assert.deepEqual(rootIndex.commands[0], {
    name: 'records read-0',
    description: 'Read synthetic record 0.',
  })

  for (const command of rootIndex.commands) {
    assert.deepEqual(Object.keys(command).sort(), ['description', 'name'])
  }

  assert.equal(rootResult.output.includes('Synthetic identifier'), false)
  assert.equal(rootResult.output.includes('Synthetic payload'), false)
  assert.equal(manifestResult.output.includes('Synthetic identifier'), true)
  assert.ok(manifestResult.output.length > rootResult.output.length * 8)
  assert.ok(rootResult.output.length < 5_000)
})

test('schema indexes honor the final explicit output format and preserve leaf schemas', async () => {
  const cli = createSchemaIndexCli()
  const finalYaml = await runRawCli(cli, [
    '--schema',
    '--format',
    'json',
    '--format',
    'yaml',
  ])
  const finalYamlAfterJsonAlias = await runRawCli(cli, [
    '--schema',
    '--json',
    '--format',
    'yaml',
  ])
  const finalJson = await runRawCli(cli, [
    '--schema',
    '--format',
    'yaml',
    '--format',
    'json',
  ])
  const leaf = await runRawCli(cli, [
    'records',
    'read-0',
    '--schema',
    '--format',
    'json',
  ])

  assert.equal(finalYaml.exitCode, null)
  assert.doesNotMatch(finalYaml.output, /murph\.schema-index\.v1/u)
  assert.doesNotMatch(finalYamlAfterJsonAlias.output, /murph\.schema-index\.v1/u)

  const finalJsonIndex = JSON.parse(finalJson.output) as { version: string }
  assert.equal(finalJsonIndex.version, 'murph.schema-index.v1')

  const leafSchema = JSON.parse(leaf.output) as {
    args: { properties: Record<string, unknown> }
    output: { properties: Record<string, unknown> }
  }
  assert.equal('id' in leafSchema.args.properties, true)
  assert.equal('payload' in leafSchema.output.properties, true)
  assert.equal('version' in leafSchema, false)
})

test('schema-index flag detection stops at the positional terminator', async () => {
  const cli = createSchemaIndexCli()
  const literalSchema = await runRawCli(cli, [
    '--format',
    'json',
    '--',
    '--schema',
  ])
  const literalHelp = await runRawCli(cli, [
    '--schema',
    '--format',
    'json',
    '--',
    '--help',
  ])

  assert.doesNotMatch(literalSchema.output, /murph\.schema-index\.v1/u)
  const literalHelpIndex = JSON.parse(literalHelp.output) as { version: string }
  assert.equal(literalHelpIndex.version, 'murph.schema-index.v1')
})

test('schema-index fallback applies token counting and pagination to compact output', async () => {
  const cli = createSchemaIndexCli()
  const full = await runRawCli(cli, ['--schema', '--format', 'json'])
  const count = await runRawCli(cli, [
    '--schema',
    '--format',
    'json',
    '--token-count',
  ])
  const firstPage = await runRawCli(cli, [
    '--schema',
    '--format',
    'json',
    '--token-limit',
    '24',
  ])
  const secondPage = await runRawCli(cli, [
    '--schema',
    '--format',
    'json',
    '--token-offset',
    '24',
    '--token-limit',
    '24',
  ])

  const total = estimateTokenCount(full.output.trimEnd())
  assert.equal(Number(count.output.trim()), total)
  assert.match(
    firstPage.output,
    new RegExp(`\\[truncated: showing tokens 0–24 of ${total}\\]`, 'u'),
  )
  assert.match(
    secondPage.output,
    new RegExp(`\\[truncated: showing tokens 24–48 of ${total}\\]`, 'u'),
  )
  assert.notEqual(firstPage.output, secondPage.output)
  assert.ok(firstPage.output.length < full.output.length)
  assert.ok(secondPage.output.length < full.output.length)
})
