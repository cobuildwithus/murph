import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantInputConversationRef } from '../src/assistant/conversation-ref.ts'
import {
  createAssistantAutoReplyHistoryReader,
} from '../src/assistant/automation/reply.ts'
import {
  ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT,
  parseAssistantAutoReplyRouteProjection,
  type AssistantAutoReplyRouteProjectionV1,
  resolveAssistantAutoReplyRouteProjectionIntentMemberships,
  resolveAssistantAutoReplyRouteProjectionQuery,
  upsertAssistantAutoReplyRouteProjectionCandidate,
} from '../src/assistant/automation/cross-session-route-projection.ts'
import {
  ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
  ASSISTANT_OUTBOX_LOOKUP_MAX_LOGICAL_WRITES_PER_MUTATION,
  ASSISTANT_OUTBOX_LOOKUP_OWNER,
  ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE,
  maintainAssistantOutboxLookupProjectionAtPaths,
  persistAssistantOutboxLookupAwareCanonicalMutationAtPaths,
  readAssistantOutboxDedupeLookupAtPaths,
  readAssistantOutboxProviderLookupAtPaths,
  resolveAssistantOutboxLookupPublicationPath,
} from '../src/assistant/outbox/lookup-projection.ts'
import {
  hashAssistantRebuildableLookupKey,
  hashAssistantRebuildableLookupKind,
  resolveAssistantRebuildableLookupBucketPath,
  resolveAssistantRebuildableLookupRecordPath,
} from '../src/assistant/rebuildable-lookup-store.ts'
import {
  hashAssistantOutboxIdentity,
  hashAssistantOutboxLegacyMediaDedupeIdentity,
  resolveAssistantOutboxIntentPath,
} from '../src/assistant/outbox/intents.ts'
import {
  findAssistantOutboxIntentByDedupeIdentity,
  listAssistantOutboxIntentsLocal,
  persistAssistantOutboxIntentAtPaths,
  readAssistantOutboxIntentAtPath,
  type AssistantOutboxDedupeReadObservation,
} from '../src/assistant/outbox/store.ts'
import { createAssistantOutboxIntent } from '../src/assistant/outbox.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []
const BASE_TIME = '2026-08-18T02:00:00.000Z'
const LATER_TIME = '2026-08-18T02:01:00.000Z'

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true }),
  ))
})

describe('assistant outbox lookup projection', () => {
  it('preserves opaque lookup identity bytes while rejecting whitespace-only values', () => {
    const base = {
      kind: 'opaque-kind',
      owner: 'opaque-owner',
    }
    expect(hashAssistantRebuildableLookupKey({
      ...base,
      key: 'opaque-key',
    })).not.toBe(hashAssistantRebuildableLookupKey({
      ...base,
      key: ' opaque-key ',
    }))
    expect(hashAssistantRebuildableLookupKind({
      kind: 'opaque-kind',
      owner: 'opaque-owner',
    })).not.toBe(hashAssistantRebuildableLookupKind({
      kind: ' opaque-kind ',
      owner: 'opaque-owner',
    }))
    expect(() => hashAssistantRebuildableLookupKey({
      ...base,
      key: '   ',
    })).toThrow('must be nonempty')
  })

  it('keeps canonical outbox file mutation in the lookup-aware store owner', async () => {
    const assistantSourceDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/assistant',
    )
    const sourceFiles = await listTypeScriptFiles(assistantSourceDirectory)
    const offenders: string[] = []
    for (const sourceFile of sourceFiles) {
      const relativePath = path.relative(assistantSourceDirectory, sourceFile)
      if (relativePath === path.join('outbox', 'store.ts')) {
        continue
      }
      const source = await readFile(sourceFile, 'utf8')
      if (
        source.includes('resolveAssistantOutboxIntentPath') &&
        /\b(?:writeJsonFileAtomic|writeFile|rename|rm|unlink)\s*\(/u.test(source)
      ) {
        offenders.push(relativePath)
      }
    }
    expect(offenders).toEqual([])

    const ownerSource = await readFile(
      path.join(assistantSourceDirectory, 'outbox', 'store.ts'),
      'utf8',
    )
    expect(ownerSource).toContain(
      'persistAssistantOutboxLookupAwareCanonicalMutationAtPaths',
    )
  })

  it('leaves cold mutations canonical-only until maintenance starts the rebuild', async () => {
    const { paths, vaultRoot } = await createVault('cold-mutation')
    const pending = createIntent({
      intentId: 'intent-cold-mutation',
      status: 'pending',
    })

    await expect(persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
      next: pending,
      paths,
      previous: null,
      writeCanonical: async () => {
        await writeCanonicalIntent(paths, pending)
      },
    })).resolves.toEqual({ lookupWrites: 0 })
    await expect(readFile(
      resolveAssistantOutboxLookupPublicationPath(paths),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readAssistantOutboxIntentAtPath(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, pending.intentId),
      { vault: vaultRoot },
    )).resolves.toMatchObject({ intentId: pending.intentId })

    await expect(maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: [pending],
      outboxTrusted: true,
      paths,
    })).resolves.toMatchObject({
      rebuildCompleted: true,
      rebuildStarted: true,
      trusted: true,
    })
  })

  it('keeps warm exact hit and trusted miss work bounded independently of canonical inventory', async () => {
    const { paths, vaultRoot } = await createVault('bounded-read')
    const intents = Array.from(
      { length: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE + 1 },
      (_, index) => createIntent({
        intentId: `intent-bounded-${index.toString().padStart(3, '0')}`,
      }),
    )
    await seedCanonicalIntents(paths, intents)

    const first = await maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })
    expect(first).toMatchObject({
      canonicalIntentsProcessed: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE,
      rebuildStarted: true,
      trusted: false,
    })
    const second = await maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })
    expect(second).toMatchObject({
      canonicalIntentsProcessed: 1,
      rebuildCompleted: true,
      rebuildResumed: true,
      trusted: true,
    })

    let hitObservation: AssistantOutboxDedupeReadObservation | null = null
    const selected = intents.at(-1)!
    const hit = await findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: selected.dedupeKey,
      onLookup: (observation) => {
        hitObservation = observation
      },
      vault: vaultRoot,
    })
    expect(hit).toMatchObject({
      intent: { intentId: selected.intentId },
      kind: 'found',
    })
    const observedHit = requireObservation(hitObservation)
    expect(observedHit.outboxScan).toBeUndefined()
    expect(observedHit.lookup.canonicalValidationFilesRead).toBe(1)
    expect(observedHit.lookup.lookupFilesRead).toBeLessThanOrEqual(6)
    expect(observedHit.lookup.lookupBytesRead).toBeGreaterThan(0)
    expect(observedHit.lookup.elapsedMs).toBeGreaterThanOrEqual(0)

    let missObservation: AssistantOutboxDedupeReadObservation | null = null
    const miss = await findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: '0000000000000000000000000000000000000000',
      onLookup: (observation) => {
        missObservation = observation
      },
      vault: vaultRoot,
    })
    expect(miss).toEqual({ kind: 'not-found' })
    const observedMiss = requireObservation(missObservation)
    expect(observedMiss.outboxScan).toBeUndefined()
    expect(observedMiss.lookup.canonicalValidationFilesRead).toBe(0)
    expect(observedMiss.lookup.lookupFilesRead).toBeLessThanOrEqual(5)
  })

  it('serves exact native anchors and bounded routes through the production history reader', async () => {
    const { paths, vaultRoot } = await createVault('history-reader')
    const intent = createIntent({
      actorId: 'actor-history',
      channel: 'telegram',
      identityId: 'identity-history',
      intentId: 'intent-history',
      providerMessageId: 'provider-history',
      target: 'telegram-target-history',
      threadId: 'telegram-thread-history',
      threadIsDirect: true,
    })
    await seedCanonicalIntents(paths, [intent])
    await expectTrustedMaintenance(paths, [intent])

    const historyReader = createAssistantAutoReplyHistoryReader({
      vault: vaultRoot,
    })
    await expect(historyReader.readOutboxIntents({
      channel: 'telegram',
      kind: 'provider-message',
      providerMessageIds: ['provider-history'],
    })).resolves.toMatchObject([{ intentId: intent.intentId }])

    const actorQuery = requireRouteQuery(
      resolveAssistantAutoReplyRouteProjectionQuery({
        conversation: createConversation({
          accountId: 'identity-history',
          actorId: 'actor-history',
          source: 'telegram',
          threadId: 'telegram-thread-history',
        }),
        deliveryTarget: 'telegram-target-history',
      }),
    )
    await expect(historyReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(LATER_TIME),
        inputTimeMs: Date.parse(LATER_TIME),
        kind: 'echo',
        maxDeltaMs: 30_000,
      },
      query: actorQuery,
    })).resolves.toMatchObject([{ intentId: intent.intentId }])

    const actorlessDirectQuery = requireRouteQuery(
      resolveAssistantAutoReplyRouteProjectionQuery({
        conversation: createConversation({
          accountId: 'identity-history',
          actorId: null,
          source: 'telegram',
          threadId: 'telegram-thread-history',
          threadIsDirect: true,
        }),
        deliveryTarget: 'telegram-target-history',
      }),
    )
    await expect(historyReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(LATER_TIME),
        inputTimeMs: Date.parse(LATER_TIME),
        kind: 'echo',
        maxDeltaMs: 30_000,
      },
      query: actorlessDirectQuery,
    })).resolves.toMatchObject([{ intentId: intent.intentId }])

    expect(historyReader.readMetrics()).toMatchObject({
      outboxLookupCanonicalValidationFilesRead: 3,
      outboxLookupFallbackCount: 0,
      outboxLookupReads: 3,
      outboxScanPerformed: false,
    })
  })

  it('matches forced canonical dedupe behavior for active, terminal, absent, and legacy-compatible intents', async () => {
    const { paths, vaultRoot } = await createVault('equivalence')
    const active = [
      createIntent({ intentId: 'intent-active-pending', status: 'pending' }),
      createIntent({ intentId: 'intent-active-retryable', status: 'retryable' }),
      createIntent({ intentId: 'intent-active-sent' }),
    ]
    const terminal = [
      createIntent({ intentId: 'intent-terminal-failed', status: 'failed' }),
      createIntent({ intentId: 'intent-terminal-abandoned', status: 'abandoned' }),
    ]
    const legacyToken = 'legacy-compatible-token'
    const currentLegacyKey = hashAssistantOutboxIdentity({
      dedupeToken: legacyToken,
      message: 'legacy compatible message',
      sessionId: 'legacy-session',
      turnId: 'legacy-turn',
    })
    const legacyMediaKey = requireString(
      hashAssistantOutboxLegacyMediaDedupeIdentity({
        dedupeToken: legacyToken,
        media: [],
      }),
    )
    const legacy = createIntent({
      dedupeKey: legacyMediaKey,
      intentId: 'intent-legacy-unclassified',
      legacyDedupeLookupKey: 'omit',
    })
    const intents = [...active, ...terminal, legacy]
    await seedCanonicalIntents(paths, intents)
    await expectTrustedMaintenance(paths, intents)

    for (const intent of active) {
      await expect(findAssistantOutboxIntentByDedupeIdentity({
        dedupeKey: intent.dedupeKey,
        vault: vaultRoot,
      })).resolves.toMatchObject({
        intent: { intentId: intent.intentId },
        kind: 'found',
      })
    }
    for (const intent of terminal) {
      await expect(findAssistantOutboxIntentByDedupeIdentity({
        dedupeKey: intent.dedupeKey,
        vault: vaultRoot,
      })).resolves.toEqual({ kind: 'not-found' })
    }
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: 'ffffffffffffffffffffffffffffffffffffffff',
      vault: vaultRoot,
    })).resolves.toEqual({ kind: 'not-found' })
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: currentLegacyKey,
      dedupeToken: legacyToken,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: legacy.intentId },
      kind: 'found',
      legacyDedupeLookupKeyUpgrade: currentLegacyKey,
    })
  })

  it('rejects a route projection whose completeness contradicts its compacted history', () => {
    const intent = createIntent({ intentId: 'intent-route-parser' })
    const membership = resolveAssistantAutoReplyRouteProjectionIntentMemberships(
      intent,
    )[0]
    expect(membership).toBeDefined()
    const projection = upsertAssistantAutoReplyRouteProjectionCandidate({
      candidate: membership!.candidate,
      current: null,
      membership: membership!.membership,
    })
    expect(projection.state).toBe('complete')
    expect(() => parseAssistantAutoReplyRouteProjection({
      ...projection,
      state: 'degraded',
    })).toThrow('completeness is inconsistent')
    expect(() => parseAssistantAutoReplyRouteProjection({
      ...projection,
      candidates: projection.candidates.map((candidate) => ({
        ...candidate,
        intentId: ` ${candidate.intentId}`,
        order: {
          ...candidate.order,
          intentId: ` ${candidate.order.intentId}`,
        },
      })),
    })).toThrow('intent id is invalid')
    expect(() => parseAssistantAutoReplyRouteProjection({
      ...projection,
      candidates: projection.candidates.map((candidate) => ({
        ...candidate,
        intentId: '../intent',
        order: {
          ...candidate.order,
          intentId: '../intent',
        },
      })),
    })).toThrow('intent id is invalid')
  })

  it('fails soft to canonical authority for malformed, missing, and dangling disposable records', async () => {
    const { paths, vaultRoot } = await createVault('damaged-sidecars')
    const intent = createIntent({ intentId: 'intent-damaged-sidecars' })
    await seedCanonicalIntents(paths, [intent])
    await expectTrustedMaintenance(paths, [intent])

    const active = await readActivePublication(paths)
    const kindDigest = hashAssistantRebuildableLookupKind({
      kind: ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    })
    const keyDigest = hashAssistantRebuildableLookupKey({
      key: intent.dedupeKey,
      kind: ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    })
    const recordPath = resolveAssistantRebuildableLookupRecordPath({
      generation: active.generation,
      keyDigest,
      kindDigest,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths,
    })
    await writeFile(recordPath, '{"partial":', 'utf8')

    let observation: AssistantOutboxDedupeReadObservation | null = null
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: intent.dedupeKey,
      onLookup: (value) => {
        observation = value
      },
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: intent.intentId },
      kind: 'found',
    })
    const observedFallback = requireObservation(observation)
    expect(observedFallback.fallbackReason).toMatch(/lookup-/u)
    expect(observedFallback.outboxScan?.filesRead).toBe(1)

    await expectTrustedMaintenance(paths, [intent])
    const repaired = await readActivePublication(paths)
    const bucketPath = resolveAssistantRebuildableLookupBucketPath({
      bucketId: keyDigest.slice(0, 2),
      generation: repaired.generation,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths,
    })
    await unlink(bucketPath)
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: intent.dedupeKey,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: intent.intentId },
      kind: 'found',
    })

    await expectTrustedMaintenance(paths, [intent])
    await unlink(resolveAssistantOutboxLookupPublicationPath(paths))
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: intent.dedupeKey,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: intent.intentId },
      kind: 'found',
    })

    await expectTrustedMaintenance(paths, [intent])
    const publicationPath = resolveAssistantOutboxLookupPublicationPath(paths)
    const envelope: unknown = JSON.parse(await readFile(publicationPath, 'utf8'))
    if (!isPlainObject(envelope) || !isPlainObject(envelope.value)) {
      throw new TypeError('Expected assistant outbox lookup publication envelope.')
    }
    const activePublication = envelope.value.active
    if (!isPlainObject(activePublication)) {
      throw new TypeError('Expected active assistant outbox lookup publication.')
    }
    envelope.value.building = {
      afterIntentId: null,
      bucketDigests: activePublication.bucketDigests,
      buildId: 'b'.repeat(32),
      generation: activePublication.generation,
      startedAt: BASE_TIME,
    }
    await writeFile(publicationPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
    let invalidPublicationObservation: AssistantOutboxDedupeReadObservation | null = null
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: intent.dedupeKey,
      onLookup: (value) => {
        invalidPublicationObservation = value
      },
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: intent.intentId },
      kind: 'found',
    })
    expect(requireObservation(invalidPublicationObservation)).toMatchObject({
      fallbackReason: 'publication-invalid',
      outboxScan: { filesRead: 1 },
    })
  })

  it('quarantines malformed canonical evidence and invalidates projection trust without throwing into lookup work', async () => {
    const { paths, vaultRoot } = await createVault('malformed-canonical')
    const intent = createIntent({ intentId: 'intent-malformed-canonical' })
    await seedCanonicalIntents(paths, [intent])
    await expectTrustedMaintenance(paths, [intent])
    await writeFile(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
      '{"schema":',
      'utf8',
    )

    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: intent.dedupeKey,
      vault: vaultRoot,
    })).resolves.toEqual({ kind: 'not-found' })
    await expect(readActivePublication(paths)).rejects.toThrow(
      'active assistant outbox lookup generation',
    )
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
  })

  it('retries a publication witness instead of accepting an ABA generation read', async () => {
    const { paths, vaultRoot } = await createVault('aba-witness')
    const intent = createIntent({ intentId: 'intent-aba-witness' })
    await seedCanonicalIntents(paths, [intent])
    await expectTrustedMaintenance(paths, [intent])
    let mutationApplied = false

    const result = await readAssistantOutboxDedupeLookupAtPaths({
      dedupeKey: intent.dedupeKey,
      paths,
      reader: {
        readIntent: async (intentId, onBytesRead) => {
          const current = await readAssistantOutboxIntentAtPath(
            resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
            { onBytesRead, vault: vaultRoot },
          )
          if (current && !mutationApplied) {
            mutationApplied = true
            await persistAssistantOutboxIntentAtPaths({
              intent: assistantOutboxIntentSchema.parse({
                ...current,
                status: 'failed',
                updatedAt: LATER_TIME,
              }),
              paths,
              previous: current,
            })
          }
          return current
        },
      },
    })

    expect(result).toMatchObject({
      kind: 'not-found',
      metrics: { publicationRetries: 1 },
    })
  })

  it('publishes an irreversible-provider mutation barrier and clears it only with durable evidence', async () => {
    const { paths, vaultRoot } = await createVault('provider-barrier')
    const pending = createIntent({
      intentId: 'intent-provider-barrier',
      status: 'pending',
    })
    await seedCanonicalIntents(paths, [pending])
    await expectTrustedMaintenance(paths, [pending])

    const sending = assistantOutboxIntentSchema.parse({
      ...pending,
      attemptCount: 1,
      lastAttemptAt: LATER_TIME,
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: LATER_TIME,
    })
    await persistAssistantOutboxIntentAtPaths({
      intent: sending,
      paths,
      previous: pending,
    })
    await expect(readAssistantOutboxDedupeLookupAtPaths({
      dedupeKey: pending.dedupeKey,
      paths,
      reader: canonicalReader(vaultRoot, paths),
    })).resolves.toMatchObject({
      kind: 'fallback',
      reason: 'lookup-canonical-mutation-incomplete',
    })

    const sent = assistantOutboxIntentSchema.parse({
      ...sending,
      delivery: {
        channel: 'telegram',
        idempotencyKey: sending.deliveryIdempotencyKey,
        messageLength: sending.message.length,
        providerMessageId: 'provider-barrier-complete',
        providerThreadId: sending.explicitTarget,
        sentAt: '2026-08-18T02:02:00.000Z',
        target: sending.explicitTarget,
        targetKind: 'thread',
      },
      sentAt: '2026-08-18T02:02:00.000Z',
      status: 'sent',
      updatedAt: '2026-08-18T02:02:00.000Z',
    })
    await persistAssistantOutboxIntentAtPaths({
      intent: sent,
      paths,
      previous: sending,
    })
    const provider = await readAssistantOutboxProviderLookupAtPaths({
      channel: 'telegram',
      paths,
      providerMessageIds: ['provider-barrier-complete'],
      reader: canonicalReader(vaultRoot, paths),
    })
    expect(provider.kind).toBe('complete')
    expect(provider.kind === 'complete'
      ? provider.intentsByProviderMessageId.get('provider-barrier-complete')
      : null).toMatchObject([{ intentId: sent.intentId }])
  })

  it('re-enables repair after a failed canonical write and preserves a fixed projection write budget', async () => {
    const { paths, vaultRoot } = await createVault('failed-canonical')
    const pending = createIntent({
      intentId: 'intent-failed-canonical',
      status: 'pending',
    })
    await seedCanonicalIntents(paths, [pending])
    await expectTrustedMaintenance(paths, [pending])
    const sending = assistantOutboxIntentSchema.parse({
      ...pending,
      attemptCount: 1,
      lastAttemptAt: LATER_TIME,
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: LATER_TIME,
    })

    await expect(persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
      next: sending,
      paths,
      previous: pending,
      writeCanonical: async () => {
        throw new Error('injected canonical write failure')
      },
    })).rejects.toThrow('injected canonical write failure')
    await expect(readAssistantOutboxDedupeLookupAtPaths({
      dedupeKey: pending.dedupeKey,
      paths,
      reader: canonicalReader(vaultRoot, paths),
    })).resolves.toMatchObject({ kind: 'fallback' })
    await expectTrustedMaintenance(paths, [pending])
    await expect(readAssistantOutboxDedupeLookupAtPaths({
      dedupeKey: pending.dedupeKey,
      paths,
      reader: canonicalReader(vaultRoot, paths),
    })).resolves.toMatchObject({
      intent: { intentId: pending.intentId },
      kind: 'found',
    })

    const metadataOnly = assistantOutboxIntentSchema.parse({
      ...pending,
      updatedAt: '2026-08-18T02:03:00.000Z',
    })
    const noProjectionWrite =
      await persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
        next: metadataOnly,
        paths,
        previous: pending,
        writeCanonical: async () => {
          await writeCanonicalIntent(paths, metadataOnly)
        },
      })
    expect(noProjectionWrite.lookupWrites).toBe(0)

    const terminal = assistantOutboxIntentSchema.parse({
      ...metadataOnly,
      status: 'failed',
      updatedAt: '2026-08-18T02:04:00.000Z',
    })
    const projected = await persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
      next: terminal,
      paths,
      previous: metadataOnly,
      writeCanonical: async () => {
        await writeCanonicalIntent(paths, terminal)
      },
    })
    expect(projected.lookupWrites).toBeGreaterThan(0)
    expect(projected.lookupWrites)
      .toBeLessThanOrEqual(ASSISTANT_OUTBOX_LOOKUP_MAX_LOGICAL_WRITES_PER_MUTATION)
  })

  it('resumes interrupted rebuild work, preserves its cursor, and publishes only a complete generation', async () => {
    const { paths } = await createVault('resumable-rebuild')
    const intents = Array.from(
      { length: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE + 1 },
      (_, index) => createIntent({
        intentId: `intent-rebuild-${index.toString().padStart(3, '0')}`,
      }),
    )
    await seedCanonicalIntents(paths, intents)
    const staleCandidateDirectory = path.join(
      paths.outboxDirectory,
      '.lookups-v1',
    )
    await mkdir(staleCandidateDirectory, { recursive: true })
    await writeFile(
      path.join(staleCandidateDirectory, 'residue.json'),
      '{}',
      'utf8',
    )

    const first = await maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })
    expect(first).toMatchObject({
      canonicalIntentsProcessed: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE,
      rebuildCompleted: false,
      rebuildStarted: true,
      trusted: false,
    })
    await expect(readFile(
      path.join(staleCandidateDirectory, 'residue.json'),
      'utf8',
    )).resolves.toBe('{}')

    const second = await maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })
    expect(second).toMatchObject({
      canonicalIntentsProcessed: 1,
      rebuildCompleted: true,
      rebuildResumed: true,
      trusted: true,
    })
    await expect(readFile(
      path.join(staleCandidateDirectory, 'residue.json'),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('invalidates a failed building prewrite before canonical commit so a stale cursor cannot resume', async () => {
    const { paths } = await createVault('building-prewrite-failure')
    const intents = Array.from(
      { length: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE + 1 },
      (_, index) => createIntent({
        intentId: `intent-building-prewrite-${index.toString().padStart(3, '0')}`,
        status: 'pending',
      }),
    )
    await seedCanonicalIntents(paths, intents)
    await expect(maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })).resolves.toMatchObject({
      canonicalIntentsProcessed: ASSISTANT_OUTBOX_LOOKUP_REBUILD_BATCH_SIZE,
      rebuildCompleted: false,
      rebuildStarted: true,
      trusted: false,
    })

    const before = await readLookupPublicationValue(paths)
    const buildingBefore = before.building
    if (
      !isPlainObject(buildingBefore) ||
      typeof buildingBefore.generation !== 'string'
    ) {
      throw new TypeError('Expected a building assistant outbox lookup generation.')
    }
    const priorGeneration = buildingBefore.generation
    const previous = intents[0]!
    const next = assistantOutboxIntentSchema.parse({
      ...previous,
      dedupeKey: 'f'.repeat(40),
      updatedAt: LATER_TIME,
    })
    const keyDigest = hashAssistantRebuildableLookupKey({
      key: next.dedupeKey,
      kind: ASSISTANT_OUTBOX_ACTIVE_DEDUPE_LOOKUP_KIND,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
    })
    const bucketPath = resolveAssistantRebuildableLookupBucketPath({
      bucketId: keyDigest.slice(0, 2),
      generation: priorGeneration,
      owner: ASSISTANT_OUTBOX_LOOKUP_OWNER,
      paths,
    })
    await mkdir(path.dirname(bucketPath), { recursive: true })
    await writeFile(bucketPath, '{"schema":', 'utf8')

    let publicationDuringCanonical: Record<string, unknown> | null = null
    await persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
      next,
      paths,
      previous,
      writeCanonical: async () => {
        publicationDuringCanonical = await readLookupPublicationValue(paths)
        await writeCanonicalIntent(paths, next)
      },
    })

    expect(publicationDuringCanonical).toMatchObject({
      active: null,
      building: null,
    })
    const after = await readLookupPublicationValue(paths)
    expect(after.active).toBeNull()
    if (
      !isPlainObject(after.building) ||
      typeof after.building.generation !== 'string'
    ) {
      throw new TypeError('Expected a replacement building generation.')
    }
    expect(after.building.generation).not.toBe(priorGeneration)
  })

  it('keeps pre-publication mixed-writer state on canonical fallback and warms only after an all-current rebuild', async () => {
    const { paths, vaultRoot } = await createVault('mixed-writer')
    const legacyWriterIntent = createIntent({
      intentId: 'intent-mixed-writer',
      legacyDedupeLookupKey: 'omit',
    })
    await seedCanonicalIntents(paths, [legacyWriterIntent])

    let coldObservation: AssistantOutboxDedupeReadObservation | null = null
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: legacyWriterIntent.dedupeKey,
      onLookup: (observation) => {
        coldObservation = observation
      },
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: legacyWriterIntent.intentId },
      kind: 'found',
    })
    const observedCold = requireObservation(coldObservation)
    expect(observedCold.fallbackReason).toBe('publication-missing')
    expect(observedCold.outboxScan?.filesRead).toBe(1)

    await expectTrustedMaintenance(paths, [legacyWriterIntent])
    let warmObservation: AssistantOutboxDedupeReadObservation | null = null
    await expect(findAssistantOutboxIntentByDedupeIdentity({
      dedupeKey: legacyWriterIntent.dedupeKey,
      onLookup: (observation) => {
        warmObservation = observation
      },
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: { intentId: legacyWriterIntent.intentId },
      kind: 'found',
    })
    expect(requireObservation(warmObservation).outboxScan).toBeUndefined()
  })

  it('keeps route history compact and falls back only when omitted history can change the query', async () => {
    const { paths, vaultRoot } = await createVault('bounded-route-tail')
    const intents = Array.from(
      { length: ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT + 1 },
      (_, index) => createIntent({
        actorId: 'actor-route-tail',
        channel: 'email',
        identityId: 'identity-route-tail',
        intentId: `intent-route-tail-${index.toString().padStart(2, '0')}`,
        providerMessageId: `provider-route-tail-${index}`,
        sentAt: new Date(Date.parse(BASE_TIME) + index * 1_000).toISOString(),
        target: 'email-target-route-tail',
        threadId: 'email-thread-route-tail',
      }),
    )
    let projection: AssistantAutoReplyRouteProjectionV1 | null = null
    for (const intent of intents) {
      const memberships = resolveAssistantAutoReplyRouteProjectionIntentMemberships(
        intent,
      )
      expect(memberships).toHaveLength(1)
      const membership = memberships[0]!
      projection = upsertAssistantAutoReplyRouteProjectionCandidate({
        candidate: membership.candidate,
        current: projection,
        membership: membership.membership,
      })
    }
    expect(projection).toMatchObject({
      candidates: expect.any(Array),
      omitted: expect.any(Object),
      state: 'degraded',
    })
    expect(projection?.candidates).toHaveLength(
      ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT,
    )

    await seedCanonicalIntents(paths, intents)
    await expectTrustedMaintenance(paths, intents)
    const query = requireRouteQuery(
      resolveAssistantAutoReplyRouteProjectionQuery({
        conversation: createConversation({
          accountId: 'identity-route-tail',
          actorId: 'actor-route-tail',
          source: 'email',
          threadId: 'email-thread-route-tail',
        }),
        deliveryTarget: 'email-target-route-tail',
      }),
    )
    const historyReader = createAssistantAutoReplyHistoryReader({
      vault: vaultRoot,
    })
    await expect(historyReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(LATER_TIME),
        excludedSessionId: null,
        kind: 'latest',
        settledThrough: null,
      },
      query,
    })).resolves.toHaveLength(ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT)
    expect(historyReader.readMetrics()).toMatchObject({
      outboxLookupFallbackCount: 0,
      outboxScanPerformed: false,
    })

    const completeHistoryReader = createAssistantAutoReplyHistoryReader({
      vault: vaultRoot,
    })
    await expect(completeHistoryReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(LATER_TIME),
        excludedSessionId: null,
        kind: 'history',
        settledThrough: null,
      },
      query,
    })).resolves.toHaveLength(intents.length)
    expect(completeHistoryReader.readMetrics()).toMatchObject({
      outboxLookupFallbackCount: 1,
      outboxLookupFallbackReason: 'route-projection-degraded',
      outboxScanFilesRead: intents.length,
      outboxScanPerformed: true,
    })

    const settledHistoryReader = createAssistantAutoReplyHistoryReader({
      vault: vaultRoot,
    })
    await expect(settledHistoryReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(LATER_TIME),
        excludedSessionId: null,
        kind: 'history',
        settledThrough: {
          intentId: intents[0]!.intentId,
          sentAt: intents[0]!.delivery!.sentAt,
        },
      },
      query,
    })).resolves.toHaveLength(ASSISTANT_AUTO_REPLY_ROUTE_TAIL_LIMIT)
    expect(settledHistoryReader.readMetrics()).toMatchObject({
      outboxLookupFallbackCount: 0,
      outboxScanPerformed: false,
    })

    const omittedCouldMatterReader = createAssistantAutoReplyHistoryReader({
      vault: vaultRoot,
    })
    await expect(omittedCouldMatterReader.readOutboxIntents({
      kind: 'route',
      proof: {
        causalUpperBoundMs: Date.parse(intents[0]!.delivery!.sentAt),
        excludedSessionId: null,
        kind: 'latest',
        settledThrough: null,
      },
      query,
    })).resolves.toHaveLength(intents.length)
    expect(omittedCouldMatterReader.readMetrics()).toMatchObject({
      outboxLookupFallbackCount: 1,
      outboxLookupFallbackReason: 'route-projection-degraded',
      outboxScanFilesRead: intents.length,
      outboxScanPerformed: true,
    })
  })

  it('preserves concurrent pre-provider admission and post-provider dedupe authority', async () => {
    const { paths, vaultRoot } = await createVault('production-dedupe')
    const create = () => createAssistantOutboxIntent({
      actorId: 'actor-production-dedupe',
      channel: 'telegram',
      createdAt: BASE_TIME,
      dedupeToken: 'production-dedupe-token',
      explicitTarget: 'telegram-target-production-dedupe',
      identityId: 'identity-production-dedupe',
      message: 'production dedupe message',
      sessionId: 'session-production-dedupe',
      threadId: 'thread-production-dedupe',
      threadIsDirect: true,
      turnId: 'turn-production-dedupe',
      vault: vaultRoot,
    })
    const [first, concurrent] = await Promise.all([create(), create()])
    expect(concurrent.intentId).toBe(first.intentId)
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toHaveLength(1)

    const sent = assistantOutboxIntentSchema.parse({
      ...first,
      attemptCount: 1,
      delivery: {
        channel: 'telegram',
        idempotencyKey: first.deliveryIdempotencyKey,
        messageLength: first.message.length,
        providerMessageId: 'provider-production-dedupe',
        providerThreadId: first.explicitTarget,
        sentAt: LATER_TIME,
        target: first.explicitTarget,
        targetKind: 'thread',
      },
      lastAttemptAt: LATER_TIME,
      nextAttemptAt: null,
      sentAt: LATER_TIME,
      status: 'sent',
      updatedAt: LATER_TIME,
    })
    await persistAssistantOutboxIntentAtPaths({
      intent: sent,
      paths,
      previous: first,
    })
    const replay = await create()
    expect(replay.intentId).toBe(first.intentId)
    expect(replay.status).toBe('sent')
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toHaveLength(1)
  })
})

interface CreateIntentInput {
  actorId?: string | null
  channel?: string
  dedupeKey?: string
  deliveryIdempotencyKey?: string | null
  identityId?: string | null
  intentId?: string
  legacyDedupeLookupKey?: string | null | 'omit'
  providerMessageId?: string
  sentAt?: string
  status?: AssistantOutboxIntent['status']
  target?: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  updatedAt?: string
}

function createIntent(input: CreateIntentInput = {}): AssistantOutboxIntent {
  const intentId = input.intentId ?? 'intent-default'
  const status = input.status ?? 'sent'
  const sentAt = input.sentAt ?? BASE_TIME
  const channel = input.channel ?? 'telegram'
  const target = input.target ?? 'telegram-target-default'
  const hasDelivery = status === 'sent'
  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    actorId: input.actorId === undefined ? 'actor-default' : input.actorId,
    attemptCount: hasDelivery ? 1 : 0,
    bindingDelivery: null,
    channel,
    createdAt: BASE_TIME,
    dedupeKey: input.dedupeKey ?? dedupeKeyForIntent(intentId),
    delivery: hasDelivery
      ? {
          channel,
          idempotencyKey: input.deliveryIdempotencyKey ?? null,
          messageLength: `message for ${intentId}`.length,
          providerMessageId:
            input.providerMessageId ?? `provider-${intentId}`,
          providerThreadId: target,
          sentAt,
          target,
          targetKind: 'thread',
        }
      : null,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey ?? null,
    explicitTarget: target,
    identityId:
      input.identityId === undefined ? 'identity-default' : input.identityId,
    intentId,
    lastAttemptAt: hasDelivery ? sentAt : null,
    lastError: null,
    ...(input.legacyDedupeLookupKey === 'omit'
      ? {}
      : {
          legacyDedupeLookupKey:
            input.legacyDedupeLookupKey === undefined
              ? null
              : input.legacyDedupeLookupKey,
        }),
    message: `message for ${intentId}`,
    nextAttemptAt: status === 'pending' || status === 'retryable'
      ? BASE_TIME
      : null,
    operation: null,
    sentAt: hasDelivery ? sentAt : null,
    sessionId: `session-${intentId}`,
    status,
    targetFingerprint: `fingerprint-${intentId}`,
    threadId: input.threadId === undefined ? 'thread-default' : input.threadId,
    threadIsDirect:
      input.threadIsDirect === undefined ? true : input.threadIsDirect,
    turnId: `turn-${intentId}`,
    updatedAt: input.updatedAt ?? sentAt,
  })
}

function createConversation(
  input: Partial<AssistantInputConversationRef> = {},
): AssistantInputConversationRef {
  return {
    accountId: 'identity-default',
    actorId: 'actor-default',
    actorIsSelf: false,
    source: 'telegram',
    threadId: 'thread-default',
    threadIsDirect: true,
    ...input,
  }
}

function canonicalReader(
  vaultRoot: string,
  paths: AssistantStatePaths,
) {
  return {
    readIntent: async (
      intentId: string,
      onBytesRead?: (bytes: number) => void,
    ) => await readAssistantOutboxIntentAtPath(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
      { onBytesRead, vault: vaultRoot },
    ),
  }
}

async function createVault(label: string): Promise<{
  paths: AssistantStatePaths
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    `assistant-outbox-lookups-${label}-`,
  )
  tempRoots.push(parentRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)
  await ensureAssistantState(paths)
  return { paths, vaultRoot }
}

async function seedCanonicalIntents(
  paths: AssistantStatePaths,
  intents: readonly AssistantOutboxIntent[],
): Promise<void> {
  for (const intent of intents) {
    await writeCanonicalIntent(paths, intent)
  }
}

async function writeCanonicalIntent(
  paths: AssistantStatePaths,
  intent: AssistantOutboxIntent,
): Promise<void> {
  await writeFile(
    resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
    `${JSON.stringify(intent, null, 2)}\n`,
    'utf8',
  )
}

async function expectTrustedMaintenance(
  paths: AssistantStatePaths,
  intents: readonly AssistantOutboxIntent[],
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await maintainAssistantOutboxLookupProjectionAtPaths({
      outboxIntents: intents,
      outboxTrusted: true,
      paths,
    })
    if (result.trusted) {
      return
    }
  }
  throw new Error('Assistant outbox lookup projection did not become trusted.')
}

async function readActivePublication(
  paths: AssistantStatePaths,
): Promise<{ generation: string; publicationId: string }> {
  const publication = await readLookupPublicationValue(paths)
  const active = publication.active
  if (
    !isPlainObject(active) ||
    typeof active.generation !== 'string' ||
    typeof active.publicationId !== 'string'
  ) {
    throw new TypeError('Expected active assistant outbox lookup generation.')
  }
  return {
    generation: active.generation,
    publicationId: active.publicationId,
  }
}

async function readLookupPublicationValue(
  paths: AssistantStatePaths,
): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(
    await readFile(resolveAssistantOutboxLookupPublicationPath(paths), 'utf8'),
  )
  if (!isPlainObject(raw) || !isPlainObject(raw.value)) {
    throw new TypeError('Expected assistant outbox lookup publication envelope.')
  }
  return raw.value
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return await listTypeScriptFiles(entryPath)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
  }))
  return files.flat()
}

function requireObservation(
  value: AssistantOutboxDedupeReadObservation | null,
): AssistantOutboxDedupeReadObservation {
  if (value === null) {
    throw new TypeError('Expected an assistant outbox lookup observation.')
  }
  return value
}

function requireRouteQuery<T>(value: T | null): T {
  if (value === null) {
    throw new TypeError('Expected an assistant auto-reply route query.')
  }
  return value
}

function requireString(value: string | null): string {
  if (value === null) {
    throw new TypeError('Expected a non-null string.')
  }
  return value
}

function dedupeKeyForIntent(intentId: string): string {
  return hashAssistantOutboxIdentity({
    dedupeToken: `dedupe-token-${intentId}`,
    message: `message for ${intentId}`,
    sessionId: `session-${intentId}`,
    turnId: `turn-${intentId}`,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
