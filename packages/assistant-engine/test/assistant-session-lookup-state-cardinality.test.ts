import { rm } from 'node:fs/promises'

import {
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import { afterEach, expect, it, vi } from 'vitest'

import {
  assertStateCardinalityInvariant,
  describeStateCardinality,
  type StateCardinalityProbe,
} from '../../../config/state-cardinality-test.ts'
import {
  resolveAssistantSession as seedAssistantSession,
} from '../src/assistant/store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupPaths: string[] = []

const sessionLookupProbe = {
  name: 'exact session-route lookup ignores unrelated durable state',
  prepare: prepareSessionLookup,
} satisfies StateCardinalityProbe

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describeStateCardinality(
  'assistant session foreground state-cardinality invariant',
  () => {
    it(sessionLookupProbe.name, async () => {
      await assertStateCardinalityInvariant(sessionLookupProbe)
    }, 180_000)
  },
)

async function prepareSessionLookup(unrelatedStateCount: number) {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    `assistant-session-cardinality-${unrelatedStateCount}-`,
  )
  cleanupPaths.push(parentRoot)

  const target = createAssistantModelTarget({
    model: 'gpt-5.6-test',
    provider: 'codex-cli',
  })
  if (!target) {
    throw new Error('Expected a test assistant target.')
  }

  const route = {
    actorId: 'actor-current',
    channel: 'linq',
    identityId: 'identity-current',
    threadId: 'thread-current',
    threadIsDirect: true,
  } as const
  const current = await seedAssistantSession({
    ...route,
    target,
    vault: vaultRoot,
  })
  for (let index = 0; index < unrelatedStateCount; index += 1) {
    const suffix = index.toString().padStart(4, '0')
    await seedAssistantSession({
      actorId: `actor-noise-${suffix}`,
      channel: 'linq',
      identityId: 'identity-noise',
      target,
      threadId: `thread-noise-${suffix}`,
      threadIsDirect: true,
      vault: vaultRoot,
    })
  }

  return {
    root: vaultRoot,
    async loadOperation() {
      const measuredStore = await import('../src/assistant/store.ts')

      return async () => {
        const resolved = await measuredStore.resolveAssistantSession({
          ...route,
          createIfMissing: false,
          vault: vaultRoot,
        })
        expect(resolved.session.sessionId).toBe(current.session.sessionId)
      }
    },
  }
}
