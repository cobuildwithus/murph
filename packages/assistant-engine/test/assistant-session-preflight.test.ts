import { readFile, rm, writeFile } from 'node:fs/promises'

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getAssistantSession,
  listAssistantSessions,
  lookupAssistantSession,
  resolveAssistantSession,
} from '../src/assistant/store.ts'
import {
  resolveAssistantSessionPath,
  resolveAssistantSessionRoutingDatabasePath,
} from '../src/assistant/store/persistence.ts'
import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupPaths: string[] = []
const groupRoute = {
  actorId: 'speaker-first',
  channel: 'linq',
  identityId: 'identity-test',
  threadId: 'thread-group',
  threadIsDirect: false,
} as const

function target(model = 'gpt-test') {
  const value = createAssistantModelTarget({ model, provider: 'codex-cli' })
  if (!value) throw new Error('Expected a synthetic model target.')
  return value
}

async function createVault() {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-session-preflight-',
  )
  cleanupPaths.push(parentRoot)
  return vaultRoot
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) =>
    rm(path, { force: true, recursive: true }),
  ))
})

describe('assistant session preflight', () => {
  it('validates the next group speaker without persisting it before admission', async () => {
    const vault = await createVault()
    const created = await resolveAssistantSession({
      ...groupRoute, target: target(), vault,
    })
    const sessionPath = resolveAssistantSessionPath(created.paths, created.session.sessionId)
    const before = await readFile(sessionPath, 'utf8')
    const nextRoute = { ...groupRoute, actorId: 'speaker-next', vault }

    const candidate = await lookupAssistantSession(nextRoute)
    expect(candidate.session.sessionId).toBe(created.session.sessionId)
    expect(candidate.session.binding.actorId).toBe('speaker-next')
    expect(await readFile(sessionPath, 'utf8')).toBe(before)
    expect((await getAssistantSession(vault, candidate.session.sessionId)).binding.actorId)
      .toBe('speaker-first')

    const admitted = await resolveAssistantSession({ ...nextRoute, createIfMissing: false })
    expect(admitted.session.sessionId).toBe(candidate.session.sessionId)
    expect((await getAssistantSession(vault, admitted.session.sessionId)).binding.actorId)
      .toBe('speaker-next')
  })

  it.each(['session-id', 'alias'] as const)(
    'preserves explicit %s routing conflicts without changing the session',
    async (lookupSource) => {
      const vault = await createVault()
      const created = await resolveAssistantSession({
        ...groupRoute, alias: 'synthetic-alias', target: target(), vault,
      })
      const sessionPath = resolveAssistantSessionPath(created.paths, created.session.sessionId)
      const before = await readFile(sessionPath, 'utf8')
      await expect(lookupAssistantSession({
        ...groupRoute,
        actorId: 'speaker-other',
        ...(lookupSource === 'session-id'
          ? { sessionId: created.session.sessionId }
          : { alias: 'synthetic-alias' }),
        vault,
      })).rejects.toMatchObject({ code: 'ASSISTANT_SESSION_ROUTING_CONFLICT' })
      expect(await readFile(sessionPath, 'utf8')).toBe(before)
    },
  )

  it('excludes expired conversation candidates without creating a replacement', async () => {
    const vault = await createVault()
    const created = await resolveAssistantSession({
      ...groupRoute, now: new Date('2026-01-01T00:00:00Z'), target: target(), vault,
    })
    await expect(lookupAssistantSession({
      ...groupRoute,
      maxSessionAgeMs: 60_000,
      now: new Date('2026-01-01T00:01:00Z'),
      vault,
    })).rejects.toMatchObject({ code: 'ASSISTANT_SESSION_NOT_FOUND' })
    expect((await listAssistantSessions(vault)).map((session) => session.sessionId))
      .toEqual([created.session.sessionId])
  })

  it('preserves native model continuity and rejects incompatible session policy', async () => {
    const vault = await createVault()
    const created = await resolveAssistantSession({
      ...groupRoute, target: target('gpt-original'), vault,
    })
    const candidate = await lookupAssistantSession({ ...groupRoute, vault })
    expect(candidate.session.target).toEqual(created.session.target)
    const sameNativeThread = await lookupAssistantSession({
      ...groupRoute, target: target('gpt-different'), vault,
    })
    expect(sameNativeThread.session.sessionId).toBe(created.session.sessionId)
    expect(sameNativeThread.session.target).toEqual(created.session.target)
    await expect(lookupAssistantSession({
      ...groupRoute,
      target: { ...target('gpt-original'), sandbox: 'workspace-write' },
      vault,
    })).rejects.toMatchObject({ code: 'ASSISTANT_SESSION_NOT_FOUND' })
    expect((await getAssistantSession(vault, created.session.sessionId)).target)
      .toEqual(created.session.target)
  })

  it('keeps private completion actor continuity on an explicit session lookup', async () => {
    const vault = await createVault()
    const privateRoute = { ...groupRoute, threadIsDirect: true }
    const created = await resolveAssistantSession({
      ...privateRoute, target: target(), vault,
    })
    const candidate = await lookupAssistantSession({
      ...privateRoute,
      actorId: null,
      sessionId: created.session.sessionId,
      vault,
    })
    expect(candidate.session.binding.actorId).toBe('speaker-first')
    expect(candidate.session.binding.threadIsDirect).toBe(true)
    expect(await getAssistantSession(vault, created.session.sessionId)).toEqual(created.session)
  })

  it('repairs a corrupt routing projection without persisting the candidate binding', async () => {
    const vault = await createVault()
    const created = await resolveAssistantSession({
      ...groupRoute, target: target(), vault,
    })
    const sessionPath = resolveAssistantSessionPath(created.paths, created.session.sessionId)
    const before = await readFile(sessionPath, 'utf8')
    await writeFile(resolveAssistantSessionRoutingDatabasePath(created.paths), 'invalid sqlite')

    const candidate = await lookupAssistantSession({
      ...groupRoute, actorId: 'speaker-next', vault,
    })

    expect(candidate.session.sessionId).toBe(created.session.sessionId)
    expect(candidate.session.binding.actorId).toBe('speaker-next')
    expect(await readFile(sessionPath, 'utf8')).toBe(before)
    expect(await listAssistantQuarantineEntriesAtPaths(created.paths)).toEqual(
      expect.arrayContaining([expect.objectContaining({ artifactKind: 'indexes' })]),
    )
  })

  it('quarantines a corrupt session and fails closed without creating a replacement', async () => {
    const vault = await createVault()
    const created = await resolveAssistantSession({
      ...groupRoute, target: target(), vault,
    })
    const sessionPath = resolveAssistantSessionPath(created.paths, created.session.sessionId)
    await writeFile(sessionPath, '{invalid json')

    await expect(lookupAssistantSession({
      sessionId: created.session.sessionId, vault,
    })).rejects.toMatchObject({ code: 'ASSISTANT_SESSION_CORRUPTED' })
    await expect(readFile(sessionPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listAssistantQuarantineEntriesAtPaths(created.paths)).toEqual([
      expect.objectContaining({ artifactKind: 'session', originalPath: sessionPath }),
    ])
    await expect(lookupAssistantSession({
      ...groupRoute, vault,
    })).rejects.toMatchObject({ code: 'ASSISTANT_SESSION_NOT_FOUND' })
    expect(await listAssistantSessions(vault)).toEqual([])
  })
})
