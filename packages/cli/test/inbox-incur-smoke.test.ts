import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, test } from 'vitest'
import { runRawCli } from './cli-test-helpers.js'

let isolatedHome = ''

beforeAll(async () => {
  isolatedHome = await mkdtemp(path.join(tmpdir(), 'murph-inbox-incur-home-'))
})

afterAll(async () => {
  await rm(isolatedHome, {
    force: true,
    recursive: true,
  })
})

test('root help exposes the inbox command group', async () => {
  const help = await runInboxRawCli(['--help'])

  assert.match(help, /inbox\s+Inbox runtime setup, diagnostics/u)
})

test('inbox source add schema exposes the local runtime config options', async () => {
  const schema = JSON.parse(
    await runInboxRawCli(['inbox', 'source', 'add', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        enum?: string[]
      }>
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('source' in schema.args.properties, true)
  assert.deepEqual(schema.args.properties.source?.enum, ['telegram', 'email'])
  assert.equal('id' in schema.options.properties, true)
  assert.equal('provision' in schema.options.properties, true)
  assert.equal('linqWebhookHost' in schema.options.properties, false)
  assert.equal('linqWebhookPath' in schema.options.properties, false)
  assert.equal('linqWebhookPort' in schema.options.properties, false)
  assert.equal('enableAutoReply' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'id', 'backfillLimit'])
})

test('inbox bootstrap schema exposes init and setup option families together', async () => {
  const schema = JSON.parse(
    await runInboxRawCli(['inbox', 'bootstrap', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('rebuild' in schema.options.properties, true)
  assert.equal('strict' in schema.options.properties, true)
  assert.equal('whisperCommand' in schema.options.properties, true)
  assert.equal('whisperModelPath' in schema.options.properties, true)
  assert.equal(schema.options.required?.includes('vault') ?? false, true)
})

test('inbox backfill schema exposes optional parser draining', async () => {
  const schema = JSON.parse(
    await runInboxRawCli(['inbox', 'backfill', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('parse' in schema.options.properties, true)
})

test('inbox attachment list schema exposes an optional limit', async () => {
  const schema = JSON.parse(
    await runInboxRawCli(['inbox', 'attachment', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('limit' in schema.options.properties, true)
})

test('inbox source list schema exposes an optional limit', async () => {
  const schema = JSON.parse(
    await runInboxRawCli(['inbox', 'source', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('limit' in schema.options.properties, true)
})

test('inbox attachment help surfaces inspect/status/decode wrappers', async () => {
  const help = await runInboxRawCli(['inbox', 'attachment', '--help'])

  assert.match(help, /inspect/u)
  assert.match(help, /status/u)
  assert.match(help, /decode/u)
})

test('inbox help surfaces the first-pass operator commands', async () => {
  const help = await runInboxRawCli(['inbox', '--help'])

  assert.match(help, /init\s+Initialize local inbox runtime state/u)
  assert.match(
    help,
    /bootstrap\s+Initialize local inbox runtime state and write parser toolchain config/u,
  )
  assert.match(help, /setup\s+Write parser toolchain config/u)
  assert.match(help, /source\s+Manage machine-local inbox connector configuration/u)
  assert.match(help, /doctor\s+Verify inbox runtime configuration/u)
  assert.match(help, /parse\s+Drain queued attachment parse jobs/u)
  assert.match(help, /requeue\s+Reset failed or interrupted attachment parse jobs/u)
  assert.match(help, /backfill\s+Backfill one configured inbox connector/u)
  assert.match(help, /run\s+Run all enabled inbox connectors/u)
  assert.match(help, /list\s+List captured inbox items/u)
  assert.match(help, /show\s+Show one captured inbox item/u)
  assert.match(help, /search\s+Search captured inbox items/u)
  assert.match(help, /promote\s+Promote captured inbox items/u)
  assert.match(help, /model\s+Build a deterministic normalized inbox bundle/u)
})

test('inbox promote help includes document promotion', async () => {
  const help = await runInboxRawCli(['inbox', 'promote', '--help'])

  assert.match(
    help,
    /document\s+Promote one inbox capture with a stored document attachment/u,
  )
})

test('inbox model help exposes bundle only and omits removed route backend options', async () => {
  const help = await runInboxRawCli(['inbox', 'model', '--help'])
  const removedRouteOutput = await runInboxRawCli(['inbox', 'model', 'route', '--help'])

  assert.match(help, /bundle\s+Materialize the normalized routing bundle/u)
  assert.doesNotMatch(help, /\broute\b/u)
  assert.doesNotMatch(help, /\bbaseUrl\b/u)
  assert.doesNotMatch(help, /\bapiKey\b/u)
  assert.doesNotMatch(help, /\bheadersJson\b/u)
  assert.match(removedRouteOutput, /unknown|invalid|not found|route/iu)
  assert.doesNotMatch(removedRouteOutput, /\bbaseUrl\b/u)
  assert.doesNotMatch(removedRouteOutput, /\bapiKey\b/u)
  assert.doesNotMatch(removedRouteOutput, /\bheadersJson\b/u)
})

async function runInboxRawCli(args: string[]): Promise<string> {
  return await runRawCli(args, {
    env: {
      HOME: isolatedHome,
      VAULT: undefined,
    },
  })
}
