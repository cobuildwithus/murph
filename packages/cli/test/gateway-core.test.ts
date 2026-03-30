import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { test } from 'vitest'

import {
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayReadMessagesInputSchema,
  mergeGatewayConversationRoutes,
  resolveGatewayConversationRouteKey,
} from '../src/gateway-core.js'

const execFileAsync = promisify(execFile)

test('murph publishes gateway-core for headless conversation gateway consumers', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, { default?: string; types?: string }>
  }

  assert.deepEqual(packageManifest.exports['./gateway-core'], {
    default: './dist/gateway-core.js',
    types: './dist/gateway-core.d.ts',
  })
})

test('workspace source resolution knows about murph/gateway-core', async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8'),
  ) as {
    compilerOptions?: {
      paths?: Record<string, string[] | undefined>
    }
  }

  assert.deepEqual(tsconfig.compilerOptions?.paths?.['murph/gateway-core'], [
    'packages/cli/src/gateway-core.ts',
  ])
})

test('gateway conversation routes normalize existing assistant bindings without leaking assistant-only field names', () => {
  const route = gatewayConversationRouteFromBinding({
    actorId: 'contact:alex',
    channel: 'email',
    delivery: {
      kind: 'thread',
      target: 'thread-123',
    },
    identityId: 'murph@example.com',
    threadId: 'thread-123',
    threadIsDirect: false,
  })

  assert.deepEqual(route, {
    channel: 'email',
    directness: 'group',
    identityId: 'murph@example.com',
    participantId: 'contact:alex',
    reply: {
      kind: 'thread',
      target: 'thread-123',
    },
    threadId: 'thread-123',
  })
  assert.equal(
    resolveGatewayConversationRouteKey(route),
    'channel:email|identity:murph%40example.com|thread:thread-123',
  )
  assert.equal(gatewayConversationRouteCanSend(route), true)
})

test('gateway conversation routes reuse inbox capture identity normalization rules', () => {
  const route = gatewayConversationRouteFromCapture({
    accountId: 'murph@example.com',
    actor: {
      id: 'contact:alex',
    },
    source: 'email',
    thread: {
      id: 'thread-456',
      isDirect: true,
    },
  })

  assert.deepEqual(route, {
    channel: 'email',
    directness: 'direct',
    identityId: 'murph@example.com',
    participantId: 'contact:alex',
    reply: {
      kind: null,
      target: null,
    },
    threadId: 'thread-456',
  })
  assert.equal(gatewayConversationRouteCanSend(route), true)
})

test('gateway route merging preserves existing reply routes while allowing projection layers to enrich metadata', () => {
  const merged = mergeGatewayConversationRoutes(
    gatewayConversationRouteFromBinding({
      actorId: 'contact:alex',
      channel: 'telegram',
      delivery: {
        kind: 'participant',
        target: 'contact:alex',
      },
      identityId: null,
      threadId: null,
      threadIsDirect: true,
    }),
    {
      directness: 'unknown',
      threadId: 'chat-99',
    },
  )

  assert.deepEqual(merged, {
    channel: 'telegram',
    directness: 'unknown',
    identityId: null,
    participantId: 'contact:alex',
    reply: {
      kind: 'participant',
      target: 'contact:alex',
    },
    threadId: 'chat-99',
  })
})

test('gateway read schemas keep the future transcript surface bounded and cursor-oriented', () => {
  const parsed = gatewayReadMessagesInputSchema.parse({
    oldestFirst: true,
    sessionKey: 'sess_opaque',
  })

  assert.equal(parsed.limit, 100)
  assert.equal(parsed.oldestFirst, true)
  assert.equal(parsed.sessionKey, 'sess_opaque')
  assert.equal(parsed.afterMessageId, null)
})

test('built gateway-core import stays free of assistant runtime warnings', async () => {
  const distPath = new URL('../dist/gateway-core.js', import.meta.url)
  try {
    await access(distPath, constants.F_OK)
  } catch {
    return
  }

  const result = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(distPath.href)})`,
  ])

  assert.equal(result.stdout.trim(), '')
  assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/u)
})
