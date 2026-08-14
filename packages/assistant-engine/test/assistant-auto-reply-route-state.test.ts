import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assistantOutboxIntentSchema,
  assistantTurnReceiptSchema,
  type AssistantOutboxIntent,
  type AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantInputConversationRef } from '../src/assistant/conversation-ref.ts'
import {
  claimAssistantAutoReplyRouteContext,
  compareAssistantAutoReplyDeliveryOrders,
  createAssistantAutoReplyRouteClaimHook,
  maintainAssistantAutoReplyRouteStateAtPaths,
  readAssistantAutoReplyRouteState,
  resolveAssistantAutoReplyInputExactRoute,
  resolveAssistantAutoReplyOutboxExactRoute,
  resolveAssistantAutoReplyRouteMigrationPath,
  resolveAssistantAutoReplyRouteStatePath,
  type AssistantAutoReplyDeliveryOrder,
  type AssistantAutoReplyExactRoute,
} from '../src/assistant/automation/cross-session-route-state.ts'
import {
  AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY,
} from '../src/assistant/automation/auto-reply-retry.ts'
import { withAssistantRuntimeWriteLock } from '../src/assistant/runtime-write-lock.ts'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
  resolveAssistantTurnReceiptPath,
  saveAssistantTurnReceipt,
} from '../src/assistant/turns.ts'

const tempRoots: string[] = []
const BASE_TIME = '2026-08-13T20:00:00.000Z'
const LATER_TIME = '2026-08-13T20:01:00.000Z'

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true }),
  ))
})

describe('assistant auto-reply exact route state', () => {
  it('centralizes exact route partitions and rejects incomplete legacy wildcard routes', () => {
    const linqInput = requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ source: 'linq' }),
      deliveryTarget: 'linq-thread-1',
    }))
    const linqOutbox = requireRoute(resolveAssistantAutoReplyOutboxExactRoute(
      createOutboxIntent({
        channel: 'linq',
        providerThreadId: 'linq-thread-1',
        target: 'rotating-recipient-target',
      }),
    ))
    expect(linqOutbox.digest).toBe(linqInput.digest)

    const emailInputA = requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ source: 'email' }),
      deliveryTarget: 'serialized-email-target-a',
    }))
    const emailInputB = requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ source: 'email' }),
      deliveryTarget: 'serialized-email-target-b',
    }))
    const emailOutbox = requireRoute(resolveAssistantAutoReplyOutboxExactRoute(
      createOutboxIntent({
        channel: 'email',
        target: 'serialized-email-target-c',
      }),
    ))
    expect(emailInputB.digest).toBe(emailInputA.digest)
    expect(emailOutbox.digest).toBe(emailInputA.digest)
    expect(requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({
        accountId: 'identity-2',
        source: 'email',
      }),
      deliveryTarget: 'serialized-email-target-a',
    })).digest).not.toBe(emailInputA.digest)

    const telegramRoute = requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ source: 'telegram' }),
      deliveryTarget: 'telegram-target-1',
    }))
    expect(requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ source: 'telegram' }),
      deliveryTarget: 'telegram-target-2',
    })).digest).not.toBe(telegramRoute.digest)
    expect(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({
        actorId: null,
        source: 'telegram',
      }),
      deliveryTarget: 'telegram-target-1',
    })).toBeNull()
    expect(resolveAssistantAutoReplyOutboxExactRoute(createOutboxIntent({
      actorId: null,
      channel: 'telegram',
      target: 'telegram-target-1',
    }))).toBeNull()
    expect(resolveAssistantAutoReplyOutboxExactRoute(createOutboxIntent({
      channel: 'linq',
      providerThreadId: null,
      targetKind: 'explicit',
    }))).toBeNull()
  })

  it('orders deliveries by sentAt and then intentId for same-millisecond ties', () => {
    const first = order('intent-a', BASE_TIME)
    const tiedLater = order('intent-b', BASE_TIME)
    const later = order('intent-c', LATER_TIME)

    expect(compareAssistantAutoReplyDeliveryOrders(first, tiedLater))
      .toBeLessThan(0)
    expect(compareAssistantAutoReplyDeliveryOrders(tiedLater, first))
      .toBeGreaterThan(0)
    expect(compareAssistantAutoReplyDeliveryOrders(tiedLater, later))
      .toBeLessThan(0)
  })

  it('runs legacy receipt migration once, commits completed and deferred ties, and ignores failed or blocked receipts', async () => {
    const vault = await createTempVault('migration-once')
    const paths = resolveAssistantStatePaths(vault)
    const route = emailRoute()
    const outboxIntents = [
      createOutboxIntent({ intentId: 'intent-a', sentAt: BASE_TIME }),
      createOutboxIntent({ intentId: 'intent-b', sentAt: BASE_TIME }),
      createOutboxIntent({
        intentId: 'intent-c-failed',
        sentAt: LATER_TIME,
      }),
      createOutboxIntent({
        intentId: 'intent-d-blocked',
        sentAt: '2026-08-13T20:02:00.000Z',
      }),
    ]
    const receipts = [
      createReceipt({
        intentId: 'intent-a',
        status: 'completed',
        turnId: 'turn-completed',
      }),
      createReceipt({
        intentId: 'intent-b',
        status: 'deferred',
        turnId: 'turn-deferred',
      }),
      createReceipt({
        intentId: 'intent-c-failed',
        status: 'failed',
        turnId: 'turn-failed',
      }),
      createReceipt({
        intentId: 'intent-d-blocked',
        status: 'blocked',
        turnId: 'turn-blocked',
      }),
    ]
    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents,
      outboxTrusted: true,
      paths,
      receipts,
      receiptsTrusted: true,
    })).resolves.toMatchObject({ trusted: true })
    await expect(readFile(
      resolveAssistantAutoReplyRouteMigrationPath(paths),
      'utf8',
    )).resolves.toContain('murph.assistant-auto-reply-route-migration')

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order('intent-b', BASE_TIME),
    })
  })

  it('migrates consumed accepted Linq media while its sibling delivery is retryable', async () => {
    const vault = await createTempVault('migration-accepted-linq-media')
    const paths = resolveAssistantStatePaths(vault)
    const outboxIntent = createAcceptedNonSentLinqMediaIntent({
      intentId: 'intent-migration-accepted-linq-media',
    })
    const route = requireRoute(resolveAssistantAutoReplyOutboxExactRoute(
      outboxIntent,
    ))
    const receipt = createReceipt({
      intentId: outboxIntent.intentId,
      status: 'completed',
      turnId: 'turn-migration-accepted-linq-media',
    })

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [outboxIntent],
      outboxTrusted: true,
      paths,
      receipts: [receipt],
      receiptsTrusted: true,
    })).resolves.toMatchObject({ changed: true, trusted: true })
    await expect(readFile(
      resolveAssistantAutoReplyRouteMigrationPath(paths),
      'utf8',
    )).resolves.toContain('murph.assistant-auto-reply-route-migration')
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(outboxIntent.intentId, BASE_TIME),
    })
  })

  it('leaves migration incomplete when legacy receipt or outbox inventory is untrusted', async () => {
    const vault = await createTempVault('migration-untrusted')
    const paths = resolveAssistantStatePaths(vault)

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [],
      outboxTrusted: false,
      paths,
      receipts: [],
      receiptsTrusted: true,
    })).resolves.toMatchObject({ trusted: false })
    await expect(readFile(
      resolveAssistantAutoReplyRouteMigrationPath(paths),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [],
      outboxTrusted: true,
      paths,
      receipts: [],
      receiptsTrusted: true,
    })).resolves.toMatchObject({ trusted: true })
  })

  it('fails unanchored foreground work closed before migration without scanning receipts while exact anchors remain importable', async () => {
    const vault = await createTempVault('migration-incomplete-foreground')
    const route = emailRoute()
    const outboxIntent = createOutboxIntent({ intentId: 'intent-pre-migration' })
    const receipt = createReceipt({
      intentId: outboxIntent.intentId,
      status: 'running',
      turnId: 'turn-pre-migration',
    })
    await saveAssistantTurnReceipt(vault, receipt)
    const readReceiptAtPaths = vi.fn(async () => receipt)

    await expect(readAssistantAutoReplyRouteState(
      {
        routeDigest: route.digest,
        vault,
      },
      {
        readReceiptAtPaths,
        writeRouteStateAtPaths: async () => undefined,
      },
    )).resolves.toEqual({
      kind: 'blocked',
      reason: 'migration-incomplete',
    })
    expect(readReceiptAtPaths).not.toHaveBeenCalled()

    await expect(claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order(outboxIntent.intentId, BASE_TIME),
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })).rejects.toThrow('migration is incomplete')
    await expect(claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: order(outboxIntent.intentId, BASE_TIME),
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })).resolves.toBeUndefined()

    await completeMigration(vault, [outboxIntent], [receipt])
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(outboxIntent.intentId, BASE_TIME),
    })
  })

  it('persists an exact pre-migration claim before its receipt records late-input acceptance', async () => {
    const vault = await createTempVault('migration-incomplete-late-anchor')
    const route = emailRoute()
    const outboxIntent = createOutboxIntent({ intentId: 'intent-late-anchor' })
    const receipt = await createRunningReceipt({
      turnId: 'turn-late-anchor',
      vault,
    })

    await claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: order(outboxIntent.intentId, BASE_TIME),
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await completeMigration(vault, [outboxIntent], [receipt])

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(outboxIntent.intentId, BASE_TIME),
    })
  })

  it('folds concurrent legacy running consumers into one suppression watermark', async () => {
    const vault = await createTempVault('migration-ambiguous-running')
    const paths = resolveAssistantStatePaths(vault)
    const route = emailRoute()
    const firstIntent = createOutboxIntent({ intentId: 'intent-running-first' })
    const secondIntent = createOutboxIntent({
      intentId: 'intent-running-second',
      sentAt: LATER_TIME,
    })
    const firstReceipt = createReceipt({
      intentId: firstIntent.intentId,
      status: 'running',
      turnId: 'turn-running-first',
    })
    const secondReceipt = createReceipt({
      intentId: secondIntent.intentId,
      status: 'running',
      turnId: 'turn-running-second',
    })

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [firstIntent, secondIntent],
      outboxTrusted: true,
      paths,
      receipts: [firstReceipt, secondReceipt],
      receiptsTrusted: true,
    })).resolves.toEqual({ changed: true, trusted: true })
    await expect(readFile(
      resolveAssistantAutoReplyRouteMigrationPath(paths),
      'utf8',
    )).resolves.toContain('murph.assistant-auto-reply-route-migration')
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(secondIntent.intentId, LATER_TIME),
    })
  })

  it('repeats partial multi-route migration without publishing the marker early', async () => {
    const vault = await createTempVault('migration-partial-multi-route')
    const paths = resolveAssistantStatePaths(vault)
    const firstIntent = createOutboxIntent({ intentId: 'intent-route-first' })
    const secondIntent = createOutboxIntent({
      identityId: 'identity-2',
      intentId: 'intent-route-second',
      sentAt: LATER_TIME,
    })
    const firstRoute = requireRoute(
      resolveAssistantAutoReplyOutboxExactRoute(firstIntent),
    )
    const secondRoute = requireRoute(
      resolveAssistantAutoReplyOutboxExactRoute(secondIntent),
    )
    const receipts = [
      createReceipt({
        intentId: firstIntent.intentId,
        status: 'completed',
        turnId: 'turn-route-first',
      }),
      createReceipt({
        intentId: secondIntent.intentId,
        status: 'completed',
        turnId: 'turn-route-second',
      }),
    ]
    let yieldChecks = 0

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [firstIntent, secondIntent],
      outboxTrusted: true,
      paths,
      receipts,
      receiptsTrusted: true,
      shouldYield: () => {
        yieldChecks += 1
        return yieldChecks >= 7
      },
    })).resolves.toEqual({ changed: true, trusted: false })
    await expect(readFile(
      resolveAssistantAutoReplyRouteMigrationPath(paths),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(
      resolveAssistantAutoReplyRouteStatePath(paths, firstRoute.digest),
      'utf8',
    )).resolves.toContain(firstIntent.intentId)

    await expect(maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: [firstIntent, secondIntent],
      outboxTrusted: true,
      paths,
      receipts,
      receiptsTrusted: true,
    })).resolves.toEqual({ changed: true, trusted: true })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: firstRoute.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(firstIntent.intentId, BASE_TIME),
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: secondRoute.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(secondIntent.intentId, LATER_TIME),
    })
  })

  it('retires a legacy running receipt into a suppression watermark', async () => {
    const vault = await createTempVault('legacy-running')
    const route = emailRoute()
    const outboxIntent = createOutboxIntent({ intentId: 'intent-running' })
    const runningReceipt = createReceipt({
      intentId: outboxIntent.intentId,
      status: 'running',
      turnId: 'turn-running-migration',
    })
    await saveAssistantTurnReceipt(vault, runningReceipt)

    await completeMigration(vault, [outboxIntent], [runningReceipt])
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: order(outboxIntent.intentId, BASE_TIME),
    })
  })

  it.each([
    { consumes: true, recordsClaim: true, status: 'completed' },
    { consumes: true, recordsClaim: true, status: 'deferred' },
    { consumes: false, recordsClaim: true, status: 'failed' },
    { consumes: false, recordsClaim: true, status: 'blocked' },
    { consumes: false, recordsClaim: false, status: 'completed' },
  ] satisfies readonly {
    consumes: boolean
    recordsClaim: boolean
    status: 'blocked' | 'completed' | 'deferred' | 'failed'
  }[])('$status receipt reconciliation recordsClaim=$recordsClaim consumes=$consumes', async ({
    consumes,
    recordsClaim,
    status,
  }: {
    consumes: boolean
    recordsClaim: boolean
    status: 'blocked' | 'completed' | 'deferred' | 'failed'
  }) => {
    const vault = await createTempVault(`terminal-${status}`)
    const route = emailRoute()
    const deliveryOrder = order(`intent-${status}`, BASE_TIME)
    const receipt = await createRunningReceipt({
      ...(recordsClaim ? { intentId: deliveryOrder.intentId } : {}),
      turnId: `turn-${status}`,
      vault,
    })
    await completeMigration(vault)
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: deliveryOrder,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: LATER_TIME,
      status,
      turnId: receipt.turnId,
      vault,
    })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: consumes ? deliveryOrder : null,
    })
  })

  it('requires the exact consuming receipt to exist and still be running before a claim is written', async () => {
    const vault = await createTempVault('claim-running-witness')
    const route = emailRoute()
    await completeMigration(vault)

    await expect(claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-missing-consumer', BASE_TIME),
      routeDigest: route.digest,
      turnId: 'turn-missing-consumer',
      vault,
    })).rejects.toThrow('receipt to be running')

    const completed = await createRunningReceipt({
      turnId: 'turn-terminal-consumer',
      vault,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: LATER_TIME,
      status: 'completed',
      turnId: completed.turnId,
      vault,
    })
    await expect(claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-terminal-consumer', BASE_TIME),
      routeDigest: route.digest,
      turnId: completed.turnId,
      vault,
    })).rejects.toThrow('receipt to be running')

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })
  })

  it('distinguishes crash-before-claim from crash-after-claim running state', async () => {
    const beforeVault = await createTempVault('crash-before')
    const route = emailRoute()
    await completeMigration(beforeVault)
    await createRunningReceipt({
      turnId: 'turn-crash-before',
      vault: beforeVault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: beforeVault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })

    const afterVault = await createTempVault('crash-after')
    await completeMigration(afterVault)
    const afterReceipt = await createRunningReceipt({
      turnId: 'turn-crash-after',
      vault: afterVault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-crash-after', BASE_TIME),
      routeDigest: route.digest,
      turnId: afterReceipt.turnId,
      vault: afterVault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: afterVault,
    })).resolves.toEqual({
      kind: 'blocked',
      reason: 'running-receipt',
    })
  })

  it('fails closed when a pending receipt is missing or corrupt', async () => {
    const route = emailRoute()
    const missingVault = await createTempVault('missing-receipt')
    await completeMigration(missingVault)
    const missingReceipt = await createRunningReceipt({
      turnId: 'turn-missing-receipt',
      vault: missingVault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-missing-receipt', BASE_TIME),
      routeDigest: route.digest,
      turnId: missingReceipt.turnId,
      vault: missingVault,
    })
    const missingPaths = resolveAssistantStatePaths(missingVault)
    await unlink(resolveAssistantTurnReceiptPath(
      missingPaths,
      missingReceipt.turnId,
    ))
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: missingVault,
    })).resolves.toEqual({
      kind: 'blocked',
      reason: 'missing-or-corrupt-receipt',
    })

    const corruptVault = await createTempVault('corrupt-receipt')
    await completeMigration(corruptVault)
    const corruptReceipt = await createRunningReceipt({
      turnId: 'turn-corrupt-receipt',
      vault: corruptVault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-corrupt-receipt', BASE_TIME),
      routeDigest: route.digest,
      turnId: corruptReceipt.turnId,
      vault: corruptVault,
    })
    const corruptPaths = resolveAssistantStatePaths(corruptVault)
    await writeFile(
      resolveAssistantTurnReceiptPath(corruptPaths, corruptReceipt.turnId),
      '{not-json',
      'utf8',
    )
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: corruptVault,
    })).resolves.toEqual({
      kind: 'blocked',
      reason: 'missing-or-corrupt-receipt',
    })
  })

  it('fails closed on corrupt route state without consulting receipt inventory', async () => {
    const vault = await createTempVault('corrupt-route')
    const route = emailRoute()
    await completeMigration(vault)
    const paths = resolveAssistantStatePaths(vault)
    const routePath = resolveAssistantAutoReplyRouteStatePath(
      paths,
      route.digest,
    )
    await mkdir(path.dirname(routePath), { recursive: true })
    await writeFile(routePath, '{not-json', 'utf8')
    const readReceiptAtPaths = vi.fn(async () => null)

    await expect(readAssistantAutoReplyRouteState(
      {
        routeDigest: route.digest,
        vault,
      },
      {
        readReceiptAtPaths,
        writeRouteStateAtPaths: async () => undefined,
      },
    )).resolves.toEqual({
      kind: 'blocked',
      reason: 'corrupt-route-state',
    })
    expect(readReceiptAtPaths).not.toHaveBeenCalled()
  })

  it('releases an external provider-input reservation and prevents provider start when the claim write fails', async () => {
    const release = vi.fn(async () => undefined)
    const externalBoundary = vi.fn(async () => release)
    const claim = vi.fn(async () => {
      throw new Error('route claim write failed')
    })
    const hook = createAssistantAutoReplyRouteClaimHook({
      beforeProviderAcceptedInputs: externalBoundary,
      claim,
      claims: [{
        anchored: false,
        order: order('intent-claim-failure', BASE_TIME),
        routeDigest: emailRoute().digest,
      }],
      vault: '/vault-not-used-by-injected-claim',
    })
    let providerStarted = false

    await expect((async () => {
      await hook({
        acceptedInputs: [],
        turnId: 'turn-claim-failure',
      })
      providerStarted = true
    })()).rejects.toThrow('route claim write failed')
    expect(providerStarted).toBe(false)
    expect(externalBoundary).toHaveBeenCalledOnce()
    expect(claim).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('collapses simultaneous same-route claims to the newest delivery before provider start', async () => {
    const route = emailRoute()
    const claim = vi.fn(async () => undefined)
    const hook = createAssistantAutoReplyRouteClaimHook({
      claim,
      claims: [
        {
          anchored: true,
          order: order('intent-newer', LATER_TIME),
          routeDigest: route.digest,
        },
        {
          anchored: true,
          order: order('intent-older', BASE_TIME),
          routeDigest: route.digest,
        },
      ],
      vault: '/unused-vault',
    })

    await hook({
      acceptedInputs: [],
      turnId: 'turn-simultaneous-anchors',
    })

    expect(claim).toHaveBeenCalledExactlyOnceWith({
      anchored: true,
      order: order('intent-newer', LATER_TIME),
      routeDigest: route.digest,
      turnId: 'turn-simultaneous-anchors',
      vault: '/unused-vault',
    })
  })

  it('reads at most one exact receipt in steady state and reads none without a pending claim', async () => {
    const route = emailRoute()
    const emptyVault = await createTempVault('bounded-empty')
    await completeMigration(emptyVault)
    const emptyReceiptRead = vi.fn(async () => null)
    await expect(readAssistantAutoReplyRouteState(
      {
        routeDigest: route.digest,
        vault: emptyVault,
      },
      {
        readReceiptAtPaths: emptyReceiptRead,
        writeRouteStateAtPaths: async () => undefined,
      },
    )).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })
    expect(emptyReceiptRead).not.toHaveBeenCalled()

    const pendingVault = await createTempVault('bounded-pending')
    await completeMigration(pendingVault)
    const pendingReceipt = await createRunningReceipt({
      turnId: 'turn-bounded-pending',
      vault: pendingVault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: order('intent-bounded-pending', BASE_TIME),
      routeDigest: route.digest,
      turnId: pendingReceipt.turnId,
      vault: pendingVault,
    })
    const pendingReceiptRead = vi.fn(async () => pendingReceipt)
    await expect(readAssistantAutoReplyRouteState(
      {
        routeDigest: route.digest,
        vault: pendingVault,
      },
      {
        readReceiptAtPaths: pendingReceiptRead,
        writeRouteStateAtPaths: async () => undefined,
      },
    )).resolves.toEqual({
      kind: 'blocked',
      reason: 'running-receipt',
    })
    expect(pendingReceiptRead).toHaveBeenCalledOnce()
    expect(pendingReceiptRead).toHaveBeenCalledWith(
      expect.any(Object),
      pendingReceipt.turnId,
    )
  })

  it('lets anchored older context bypass the watermark while advancing only monotonically for newer anchors', async () => {
    const vault = await createTempVault('anchored-monotonic')
    const route = emailRoute()
    const older = order('intent-older', BASE_TIME)
    const settled = order('intent-settled', LATER_TIME)
    const newer = order('intent-newer', '2026-08-13T20:02:00.000Z')
    await completeMigration(vault)

    await claimAndFinalize({
      anchored: false,
      deliveryOrder: settled,
      route,
      turnId: 'turn-settle-middle',
      vault,
    })
    await createRunningReceipt({
      turnId: 'turn-unanchored-old',
      vault,
    })
    await expect(claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: older,
      routeDigest: route.digest,
      turnId: 'turn-unanchored-old',
      vault,
    })).rejects.toThrow('already settled')

    await claimAndFinalize({
      anchored: true,
      deliveryOrder: older,
      route,
      turnId: 'turn-anchor-old',
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: settled,
    })

    await claimAndFinalize({
      anchored: true,
      deliveryOrder: newer,
      route,
      turnId: 'turn-anchor-new',
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: newer,
    })
  })

  it('advances from a settled delivery to a later unanchored delivery', async () => {
    const vault = await createTempVault('later-unanchored')
    const route = emailRoute()
    const first = order('intent-first', BASE_TIME)
    const later = order('intent-later', LATER_TIME)
    await completeMigration(vault)

    await claimAndFinalize({
      anchored: false,
      deliveryOrder: first,
      route,
      turnId: 'turn-first',
      vault,
    })
    await claimAndFinalize({
      anchored: false,
      deliveryOrder: later,
      route,
      turnId: 'turn-later',
      vault,
    })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: later,
    })
  })

  it('upgrades one consuming turn claim monotonically when a later exact anchor is admitted', async () => {
    const vault = await createTempVault('same-turn-upgrade')
    const route = emailRoute()
    const first = order('intent-first', BASE_TIME)
    const older = order('intent-older', '2026-08-13T19:59:00.000Z')
    const later = order('intent-later', LATER_TIME)
    const receipt = await createRunningReceipt({
      intentId: first.intentId,
      turnId: 'turn-same-consumer',
      vault,
    })
    await completeMigration(vault)

    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: first,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: older,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: later,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await appendAssistantTurnReceiptEvent({
      detail: null,
      kind: 'turn.input.accepted',
      metadata: {
        [AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY]:
          later.intentId,
      },
      turnId: receipt.turnId,
      vault,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: '2026-08-13T20:02:00.000Z',
      status: 'completed',
      turnId: receipt.turnId,
      vault,
    })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: later,
    })
  })

  it('settles an accepted same-turn claim instead of a newer abandoned steer', async () => {
    const vault = await createTempVault('same-turn-abandoned-steer')
    const route = emailRoute()
    const accepted = order('intent-accepted', BASE_TIME)
    const abandoned = order('intent-abandoned', LATER_TIME)
    const receipt = await createRunningReceipt({
      intentId: accepted.intentId,
      turnId: 'turn-abandoned-steer',
      vault,
    })
    await completeMigration(vault)

    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: accepted,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: abandoned,
      routeDigest: route.digest,
      turnId: receipt.turnId,
      vault,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: '2026-08-13T20:02:00.000Z',
      status: 'completed',
      turnId: receipt.turnId,
      vault,
    })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: accepted,
    })
  })

  it('keeps exact route watermarks isolated', async () => {
    const vault = await createTempVault('route-isolation')
    const routeA = emailRoute()
    const routeB = requireRoute(resolveAssistantAutoReplyInputExactRoute({
      conversation: createConversation({ threadId: 'thread-2' }),
      deliveryTarget: 'rotating-target-2',
    }))
    const deliveryOrder = order('intent-route-a', BASE_TIME)
    await completeMigration(vault)
    await claimAndFinalize({
      anchored: false,
      deliveryOrder,
      route: routeA,
      turnId: 'turn-route-a',
      vault,
    })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: routeA.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: routeB.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })
  })

  it('retires running claims at quiescence and removes routes with no live outbox authority', async () => {
    const vault = await createTempVault('residue')
    const route = emailRoute()
    const deliveryOrder = order('intent-residue', BASE_TIME)
    const liveOutboxIntent = createOutboxIntent({
      intentId: deliveryOrder.intentId,
      sentAt: deliveryOrder.sentAt,
    })
    await completeMigration(vault)
    const running = await createRunningReceipt({
      intentId: deliveryOrder.intentId,
      turnId: 'turn-residue',
      vault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: deliveryOrder,
      routeDigest: route.digest,
      turnId: running.turnId,
      vault,
    })

    const runningMaintenance = await maintainAtVault({
      outboxIntents: [liveOutboxIntent],
      receipts: [running],
      vault,
    })
    expect(runningMaintenance.trusted).toBe(true)
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })

    const completed = await finalizeAssistantTurnReceipt({
      completedAt: LATER_TIME,
      status: 'completed',
      turnId: running.turnId,
      vault,
    })
    if (!completed) {
      throw new Error('expected terminal receipt')
    }
    const terminalMaintenance = await maintainAtVault({
      outboxIntents: [liveOutboxIntent],
      receipts: [completed],
      vault,
    })
    expect(terminalMaintenance.trusted).toBe(true)

    const exactReceiptRead = vi.fn(async () => completed)
    await expect(readAssistantAutoReplyRouteState(
      {
        routeDigest: route.digest,
        vault,
      },
      {
        readReceiptAtPaths: exactReceiptRead,
        writeRouteStateAtPaths: async () => undefined,
      },
    )).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })
    expect(exactReceiptRead).not.toHaveBeenCalled()

    await maintainAtVault({
      outboxIntents: [],
      receipts: [completed],
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })
  })

  it('keeps an exact-reply watermark while accepted Linq media remains outbox authority', async () => {
    const vault = await createTempVault('accepted-linq-media-authority')
    const outboxIntent = createAcceptedNonSentLinqMediaIntent({
      intentId: 'intent-accepted-linq-media-authority',
    })
    const route = requireRoute(resolveAssistantAutoReplyOutboxExactRoute(
      outboxIntent,
    ))
    const deliveryOrder = order(outboxIntent.intentId, BASE_TIME)
    await completeMigration(vault)
    const running = await createRunningReceipt({
      intentId: outboxIntent.intentId,
      turnId: 'turn-accepted-linq-media-authority',
      vault,
    })
    await claimAssistantAutoReplyRouteContext({
      anchored: true,
      order: deliveryOrder,
      routeDigest: route.digest,
      turnId: running.turnId,
      vault,
    })
    const completed = await finalizeAssistantTurnReceipt({
      completedAt: LATER_TIME,
      status: 'completed',
      turnId: running.turnId,
      vault,
    })
    if (!completed) {
      throw new Error('expected completed accepted-media receipt')
    }
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })

    await maintainAtVault({
      outboxIntents: [outboxIntent],
      receipts: [completed],
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })

    const sentIntent = assistantOutboxIntentSchema.parse({
      ...outboxIntent,
      lastError: null,
      nextAttemptAt: null,
      sentAt: LATER_TIME,
      status: 'sent',
      updatedAt: LATER_TIME,
    })
    await maintainAtVault({
      outboxIntents: [sentIntent],
      receipts: [completed],
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })
    await createRunningReceipt({
      turnId: 'turn-unanchored-after-accepted-media-send',
      vault,
    })
    await expect(claimAssistantAutoReplyRouteContext({
      anchored: false,
      order: deliveryOrder,
      routeDigest: route.digest,
      turnId: 'turn-unanchored-after-accepted-media-send',
      vault,
    })).rejects.toThrow('already settled')

    await maintainAtVault({
      outboxIntents: [],
      receipts: [completed],
      vault,
    })
    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: null,
    })
  })

  it('restores the opaque route watermark with the portable assistant auto-reply subtree', async () => {
    const sourceVault = await createTempVault('restore-source')
    const restoredVault = await createTempVault('restore-target')
    const route = emailRoute()
    const deliveryOrder = order('intent-portable', BASE_TIME)
    await completeMigration(sourceVault)
    await claimAndFinalize({
      anchored: false,
      deliveryOrder,
      route,
      turnId: 'turn-portable',
      vault: sourceVault,
    })
    await readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: sourceVault,
    })

    const sourcePaths = resolveAssistantStatePaths(sourceVault)
    const restoredPaths = resolveAssistantStatePaths(restoredVault)
    const sourceAutoReply = path.join(
      sourcePaths.assistantStateRoot,
      'auto-reply',
    )
    const restoredAutoReply = path.join(
      restoredPaths.assistantStateRoot,
      'auto-reply',
    )
    await mkdir(path.dirname(restoredAutoReply), { recursive: true })
    await cp(sourceAutoReply, restoredAutoReply, { recursive: true })

    await expect(readAssistantAutoReplyRouteState({
      routeDigest: route.digest,
      vault: restoredVault,
    })).resolves.toEqual({
      kind: 'ready',
      settledThrough: deliveryOrder,
    })
    const migrationEnvelope = JSON.parse(await readFile(
      resolveAssistantAutoReplyRouteMigrationPath(restoredPaths),
      'utf8',
    ))
    expect(migrationEnvelope).toMatchObject({
      schema: 'murph.assistant-auto-reply-route-migration',
      schemaVersion: 1,
    })
  })
})

async function createTempVault(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `murph-route-${label}-`))
  tempRoots.push(root)
  return path.join(root, 'vault')
}

function createConversation(
  overrides: Partial<AssistantInputConversationRef> = {},
): AssistantInputConversationRef {
  return {
    accountId: 'identity-1',
    actorId: 'actor-1',
    actorIsSelf: false,
    source: 'email',
    threadId: 'thread-1',
    threadIsDirect: true,
    ...overrides,
  }
}

function createOutboxIntent(input: {
  actorId?: string | null
  channel?: string
  identityId?: string | null
  intentId?: string
  providerThreadId?: string | null
  sentAt?: string
  target?: string
  targetKind?: 'explicit' | 'participant' | 'thread'
  threadId?: string | null
} = {}): AssistantOutboxIntent {
  const channel = input.channel ?? 'email'
  const intentId = input.intentId ?? 'intent-default'
  const sentAt = input.sentAt ?? BASE_TIME
  const target = input.target ?? 'delivery-target-1'
  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId,
    sessionId: 'session-outbox',
    turnId: `turn-${intentId}`,
    createdAt: sentAt,
    updatedAt: sentAt,
    lastAttemptAt: sentAt,
    nextAttemptAt: null,
    sentAt,
    attemptCount: 1,
    status: 'sent',
    message: `message for ${intentId}`,
    dedupeKey: `dedupe-${intentId}`,
    targetFingerprint: `fingerprint-${intentId}`,
    channel,
    identityId: input.identityId === undefined
      ? 'identity-1'
      : input.identityId,
    actorId: input.actorId === undefined ? 'actor-1' : input.actorId,
    threadId: input.threadId === undefined ? 'thread-1' : input.threadId,
    threadIsDirect: true,
    bindingDelivery: null,
    explicitTarget: target,
    delivery: {
      channel,
      idempotencyKey: null,
      messageLength: `message for ${intentId}`.length,
      providerMessageId: `provider-${intentId}`,
      providerThreadId: input.providerThreadId === undefined
        ? target
        : input.providerThreadId,
      sentAt,
      target,
      targetKind: input.targetKind ?? 'thread',
    },
    lastError: null,
  })
}

function createAcceptedNonSentLinqMediaIntent(input: {
  intentId: string
}): AssistantOutboxIntent {
  const providerMessageId = `provider-${input.intentId}`
  const intent = createOutboxIntent({
    channel: 'linq',
    intentId: input.intentId,
    providerThreadId: 'linq-thread-accepted-media',
    target: 'linq-thread-accepted-media',
  })
  if (!intent.delivery || intent.delivery.kind === 'message-reaction') {
    throw new Error('expected message delivery')
  }
  return assistantOutboxIntentSchema.parse({
    ...intent,
    delivery: {
      ...intent.delivery,
      providerMessageEffects: [{
        carriesIntentMedia: true,
        message: 'Generated image',
        providerMessageId,
      }],
      providerMessageId,
      providerMessageIds: [providerMessageId],
    },
    deliveryConfirmationPending: false,
    lastError: {
      code: 'ASSISTANT_DELIVERY_RETRYABLE',
      message: 'rich-link delivery is retryable',
    },
    nextAttemptAt: LATER_TIME,
    sentAt: null,
    status: 'retryable',
    updatedAt: BASE_TIME,
  })
}

function createReceipt(input: {
  intentId?: string
  status: AssistantTurnReceipt['status']
  turnId: string
}): AssistantTurnReceipt {
  const terminal = input.status !== 'running'
  return assistantTurnReceiptSchema.parse({
    schema: 'murph.assistant-turn-receipt.v1',
    turnId: input.turnId,
    sessionId: 'session-receipt',
    provider: 'codex-cli',
    providerModel: null,
    promptPreview: null,
    responsePreview: null,
    status: input.status,
    deliveryRequested: false,
    deliveryDisposition: 'not-requested',
    deliveryIntentId: null,
    startedAt: BASE_TIME,
    updatedAt: terminal ? LATER_TIME : BASE_TIME,
    completedAt: terminal ? LATER_TIME : null,
    lastError: null,
    timeline: [{
      at: BASE_TIME,
      kind: 'turn.started',
      detail: null,
      metadata: input.intentId
        ? {
            [AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY]:
              input.intentId,
          }
        : {},
    }],
  })
}

async function createRunningReceipt(input: {
  intentId?: string
  turnId: string
  vault: string
}): Promise<AssistantTurnReceipt> {
  return await createAssistantTurnReceipt({
    deliveryRequested: false,
    ...(input.intentId
      ? {
          metadata: {
            [AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY]:
              input.intentId,
          },
        }
      : {}),
    prompt: 'test prompt',
    provider: 'codex-cli',
    providerModel: null,
    sessionId: 'session-running',
    startedAt: BASE_TIME,
    turnId: input.turnId,
    vault: input.vault,
  })
}

async function completeMigration(
  vault: string,
  outboxIntents: readonly AssistantOutboxIntent[] = [],
  receipts: readonly AssistantTurnReceipt[] = [],
): Promise<void> {
  await maintainAssistantAutoReplyRouteStateAtPaths({
    outboxIntents,
    outboxTrusted: true,
    paths: resolveAssistantStatePaths(vault),
    receipts,
    receiptsTrusted: true,
  })
}

function emailRoute(): AssistantAutoReplyExactRoute {
  return requireRoute(resolveAssistantAutoReplyInputExactRoute({
    conversation: createConversation(),
    deliveryTarget: 'rotating-email-target',
  }))
}

function requireRoute(
  route: AssistantAutoReplyExactRoute | null,
): AssistantAutoReplyExactRoute {
  if (!route) {
    throw new Error('expected exact route')
  }
  return route
}

function order(
  intentId: string,
  sentAt: string,
): AssistantAutoReplyDeliveryOrder {
  return { intentId, sentAt }
}

async function claimAndFinalize(input: {
  anchored: boolean
  deliveryOrder: AssistantAutoReplyDeliveryOrder
  route: AssistantAutoReplyExactRoute
  turnId: string
  vault: string
}): Promise<void> {
  await createRunningReceipt({
    intentId: input.deliveryOrder.intentId,
    turnId: input.turnId,
    vault: input.vault,
  })
  await claimAssistantAutoReplyRouteContext({
    anchored: input.anchored,
    order: input.deliveryOrder,
    routeDigest: input.route.digest,
    turnId: input.turnId,
    vault: input.vault,
  })
  await finalizeAssistantTurnReceipt({
    completedAt: LATER_TIME,
    status: 'completed',
    turnId: input.turnId,
    vault: input.vault,
  })
  await readAssistantAutoReplyRouteState({
    routeDigest: input.route.digest,
    vault: input.vault,
  })
}

async function maintainAtVault(input: {
  outboxIntents: readonly AssistantOutboxIntent[]
  receipts: readonly AssistantTurnReceipt[]
  vault: string
}) {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) =>
    await maintainAssistantAutoReplyRouteStateAtPaths({
      outboxIntents: input.outboxIntents,
      outboxTrusted: true,
      paths,
      receipts: input.receipts,
      receiptsTrusted: true,
    }),
  )
}
