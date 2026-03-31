import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { test } from 'vitest'

import {
  applyGatewayProjectionSnapshotToEventLog,
  createGatewayConversationSessionKey,
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  gatewayReadMessagesInputSchema,
  mergeGatewayConversationRoutes,
  pollGatewayEventLogState,
  resolveGatewayConversationRouteKey,
} from '@murph/gateway-core'

const execFileAsync = promisify(execFile)
const gatewayCoreSourceDir = path.resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  '..',
  'gateway-core',
  'src',
)

test('murph no longer publishes legacy gateway-core compatibility exports', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, { default?: string; types?: string }>
  }

  assert.equal(packageManifest.exports['./gateway-core'], undefined)
  assert.equal(packageManifest.exports['./gateway-core-local'], undefined)
})

test('gateway-core is fully hard-cut over: the owner package owns ./local and murph no longer ships gateway compatibility shims', async () => {
  const packageManifest = JSON.parse(
    await readFile(path.resolve(gatewayCoreSourceDir, '..', 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string | undefined>
  }
  const cliPackageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    dependencies?: Record<string, string | undefined>
  }
  const packageIndex = await readFile(path.join(gatewayCoreSourceDir, 'index.ts'), 'utf8')
  const packageLocal = await readFile(path.join(gatewayCoreSourceDir, 'local.ts'), 'utf8')

  assert.doesNotMatch(packageIndex, /from ['"]murph\/gateway-core['"]/u)
  assert.equal(packageManifest.dependencies?.murph, undefined)
  assert.doesNotMatch(packageLocal, /murph\/gateway-core-local/u)
  assert.match(packageLocal, /\.\/local-service\.js/u)
  assert.match(packageLocal, /\.\/projection\.js/u)
  assert.match(packageLocal, /\.\/send\.js/u)
  assert.equal(cliPackageManifest.dependencies?.['@murph/gateway-core'], undefined)

  await assert.rejects(
    access(new URL('../src/gateway-core.ts', import.meta.url), constants.F_OK),
  )
  await assert.rejects(
    access(new URL('../src/gateway-core-local.ts', import.meta.url), constants.F_OK),
  )
  await assert.rejects(
    access(path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'gateway'), constants.F_OK),
  )
})

test('workspace source resolution points directly at the dedicated @murph/gateway-core packages with no murph compatibility alias left behind', async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8'),
  ) as {
    compilerOptions?: {
      paths?: Record<string, string[] | undefined>
    }
  }

  assert.deepEqual(tsconfig.compilerOptions?.paths?.['@murph/gateway-core'], [
    'packages/gateway-core/src/index.ts',
  ])
  assert.deepEqual(tsconfig.compilerOptions?.paths?.['@murph/gateway-core/local'], [
    'packages/gateway-core/src/local.ts',
  ])
  assert.equal(tsconfig.compilerOptions?.paths?.['murph/gateway-core'], undefined)
  assert.equal(tsconfig.compilerOptions?.paths?.['murph/gateway-core-local'], undefined)
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

test('gateway conversation routes normalize sent outbox intents into the same stable route key', () => {
  const route = gatewayConversationRouteFromOutboxIntent({
    actorId: 'contact:alex',
    bindingDelivery: {
      kind: 'thread',
      target: 'thread-123',
    },
    channel: 'email',
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

test('gateway direct conversations keep actor-first route identity even when thread metadata arrives later', () => {
  const directRoute = gatewayConversationRouteFromCapture({
    accountId: null,
    actor: {
      id: 'contact:taylor',
    },
    source: 'telegram',
    thread: {
      id: 'chat-99',
      isDirect: true,
    },
  })

  assert.equal(
    resolveGatewayConversationRouteKey(directRoute),
    'channel:telegram|actor:contact%3Ataylor',
  )
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

test('gateway route merging rewrites inherited thread reply targets when the thread id changes', () => {
  const merged = mergeGatewayConversationRoutes(
    gatewayConversationRouteFromBinding({
      actorId: 'contact:alex',
      channel: 'email',
      delivery: {
        kind: 'thread',
        target: 'thread-123',
      },
      identityId: 'murph@example.com',
      threadId: 'thread-123',
      threadIsDirect: false,
    }),
    {
      threadId: 'thread-456',
    },
  )

  assert.deepEqual(merged.reply, {
    kind: 'thread',
    target: 'thread-456',
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

test('gateway event-log helpers append and filter snapshot emissions without duplicating identical snapshots', () => {
  const sessionKey = createGatewayConversationSessionKey(
    'channel:email|identity:murph%40example.com|thread:thread-123',
  )
  const initialSnapshot = {
    schema: 'murph.gateway-projection-snapshot.v1' as const,
    generatedAt: '2026-03-30T21:00:00.000Z',
    conversations: [],
    messages: [],
    permissions: [{
      action: 'send-message',
      description: 'Need operator approval',
      note: null,
      requestId: 'perm_123',
      requestedAt: '2026-03-30T21:00:00.000Z',
      resolvedAt: null,
      schema: 'murph.gateway-permission-request.v1' as const,
      sessionKey,
      status: 'open' as const,
    }],
  }
  const resolvedSnapshot = {
    ...initialSnapshot,
    generatedAt: '2026-03-30T21:05:00.000Z',
    messages: [{
      actorDisplayName: 'Alex',
      attachments: [],
      createdAt: '2026-03-30T21:05:00.000Z',
      direction: 'inbound' as const,
      messageId: 'gwcm_123',
      schema: 'murph.gateway-message.v1' as const,
      sessionKey,
      text: 'Can you send the file now?',
    }],
    permissions: [{
      ...initialSnapshot.permissions[0],
      note: 'Approved by operator',
      resolvedAt: '2026-03-30T21:05:30.000Z',
      status: 'approved' as const,
    }],
  }

  const updated = applyGatewayProjectionSnapshotToEventLog(
    {
      events: [],
      nextCursor: 0,
      snapshot: initialSnapshot,
    },
    resolvedSnapshot,
  )
  const duplicated = applyGatewayProjectionSnapshotToEventLog(updated, resolvedSnapshot)

  assert.equal(updated.nextCursor, 2)
  assert.deepEqual(
    updated.events.map((event) => event.kind),
    ['message.created', 'permission.resolved'],
  )
  assert.equal(duplicated, updated)

  const filtered = pollGatewayEventLogState(updated, {
    cursor: 0,
    kinds: ['permission.resolved'],
    limit: 10,
    sessionKey,
  })

  assert.equal(filtered.events.length, 1)
  assert.equal(filtered.events[0]?.permissionRequestId, 'perm_123')
  assert.equal(filtered.nextCursor, 2)
})

test('gateway sendability respects current channel delivery constraints', () => {
  assert.equal(
    gatewayConversationRouteCanSend({
      channel: 'email',
      directness: 'direct',
      identityId: null,
      participantId: 'contact:alex',
      reply: {
        kind: 'participant',
        target: 'contact:alex',
      },
      threadId: null,
    }),
    false,
  )

  assert.equal(
    gatewayConversationRouteCanSend({
      channel: 'linq',
      directness: 'direct',
      identityId: 'workspace:linq',
      participantId: 'contact:alex',
      reply: {
        kind: 'participant',
        target: 'contact:alex',
      },
      threadId: null,
    }),
    false,
  )
})

test('built @murph/gateway-core import stays free of assistant runtime warnings', async () => {
  const distPath = new URL('../../gateway-core/dist/index.js', import.meta.url)
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

test('gateway event polling never moves cursors backwards when callers pass a future cursor', () => {
  const state = {
    events: [],
    nextCursor: 4,
    snapshot: null,
  }

  const result = pollGatewayEventLogState(state, {
    cursor: 9,
    kinds: [],
    limit: 10,
    sessionKey: null,
  })

  assert.equal(result.events.length, 0)
  assert.equal(result.nextCursor, 9)
})
