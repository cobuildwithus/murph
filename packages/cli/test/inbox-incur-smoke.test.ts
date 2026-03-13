import assert from 'node:assert/strict'
import { test } from 'vitest'
import { runRawCli } from './cli-test-helpers.js'

test('root help exposes the inbox command group', async () => {
  const help = await runRawCli(['--help'])

  assert.match(help, /inbox\s+Inbox runtime setup, diagnostics/u)
})

test('inbox source add schema exposes the local runtime config options', async () => {
  const schema = JSON.parse(
    await runRawCli(['inbox', 'source', 'add', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('source' in schema.args.properties, true)
  assert.equal('id' in schema.options.properties, true)
  assert.equal('includeOwn' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'id', 'backfillLimit'])
})

test('inbox help surfaces the first-pass operator commands', async () => {
  const help = await runRawCli(['inbox', '--help'])

  assert.match(help, /init\s+Initialize local inbox runtime state/u)
  assert.match(help, /source\s+Manage machine-local inbox connector configuration/u)
  assert.match(help, /doctor\s+Verify inbox runtime configuration/u)
  assert.match(help, /backfill\s+Backfill one configured inbox connector/u)
  assert.match(help, /run\s+Run all enabled inbox connectors/u)
  assert.match(help, /list\s+List captured inbox items/u)
  assert.match(help, /show\s+Show one captured inbox item/u)
  assert.match(help, /search\s+Search captured inbox items/u)
  assert.match(help, /promote\s+Promote captured inbox items/u)
})
