import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  computeAssistantAutoReplyAnsweredCoverage,
} from '../src/assistant/automation/reply.js'
import {
  writeAssistantAutoReplyReplyTerminalEvidence,
  writeAssistantAutoReplySuppressionEvidence,
} from '../src/assistant/automation/evidence.js'
import {
  upsertAssistantInputEvent,
  type AssistantInputEventRecord,
} from '../src/assistant/input-store.js'
import {
  resolveAssistantStatePaths,
} from '../src/assistant/store/paths.js'

describe('assistant auto-reply answered coverage', () => {
  it('holds back below a pending Telegram input even when a later Linq input is answered', async () => {
    await withCoverageVault(async (vault) => {
      const linqOne = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'linq answered first',
        vault,
      })
      await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'telegram',
        text: 'telegram pending',
        vault,
      })
      const linqThree = await stageHostedMailboxInput({
        laneSeq: '3',
        source: 'linq',
        text: 'linq answered later',
        vault,
      })
      await writeReplyEvidence({
        inputIds: [linqOne.inputId],
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [linqThree.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '1',
      })
    })
  })

  it('advances through a suppressed prefix', async () => {
    await withCoverageVault(async (vault) => {
      const first = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'suppressed first',
        vault,
      })
      const second = await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'telegram',
        text: 'suppressed second',
        vault,
      })
      const third = await stageHostedMailboxInput({
        laneSeq: '3',
        source: 'linq',
        text: 'answered third',
        vault,
      })
      await writeAssistantAutoReplySuppressionEvidence({
        captureIds: [],
        inputIds: [first.inputId, second.inputId],
        linqMessageIds: [],
        reason: 'covered by policy',
        recordedAt: '2026-04-26T00:00:00.000Z',
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [third.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '3',
      })
    })
  })

  it('advances through pending terminal seqs when a gap closes', async () => {
    await withCoverageVault(async (vault) => {
      const first = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'first terminal',
        vault,
      })
      const second = await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'telegram',
        text: 'gap closer',
        vault,
      })
      const third = await stageHostedMailboxInput({
        laneSeq: '3',
        source: 'linq',
        text: 'already terminal tail',
        vault,
      })
      await writeReplyEvidence({
        inputIds: [first.inputId],
        vault,
      })
      await writeReplyEvidence({
        inputIds: [third.inputId],
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [second.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '3',
      })
    })
  })

  it('rebuilds terminal seqs beyond the bounded pending projection when a gap closes', async () => {
    await withCoverageVault(async (vault) => {
      const staged: AssistantInputEventRecord[] = []
      for (let seq = 1; seq <= 1002; seq += 1) {
        staged.push(await stageHostedMailboxInput({
          laneSeq: seq.toString(),
          source: 'linq',
          text: `terminal ${seq}`,
          vault,
        }))
      }

      await writeReplyEvidence({
        inputIds: staged.slice(501).map((event) => event.inputId),
        vault,
      })
      await expect(readAnsweredCoveragePendingSeqCount(vault)).resolves.toBe(500)

      await writeReplyEvidence({
        inputIds: staged.slice(0, 500).map((event) => event.inputId),
        vault,
      })
      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '500',
      })

      await writeReplyEvidence({
        inputIds: [staged[500]!.inputId],
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '1002',
      })
    })
  })

  it('holds back below a pending group thread-route item in the shared conversation lane', async () => {
    await withCoverageVault(async (vault) => {
      const first = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'answered direct thread',
        vault,
      })
      await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'linq',
        text: 'pending routed group item',
        threadId: 'group_thread_1',
        threadIsDirect: false,
        vault,
      })
      const third = await stageHostedMailboxInput({
        laneSeq: '3',
        source: 'linq',
        text: 'answered direct tail',
        vault,
      })
      await writeReplyEvidence({
        inputIds: [first.inputId],
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [third.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '1',
      })
    })
  })

  it('covers every persisted input in a multi-message turn prefix', async () => {
    await withCoverageVault(async (vault) => {
      const first = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'first message in turn',
        vault,
      })
      const second = await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'linq',
        text: 'second message in turn',
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [first.inputId, second.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '2',
      })
    })
  })

  it('does not cover a staged input that is not part of the committed reply turn', async () => {
    await withCoverageVault(async (vault) => {
      const first = await stageHostedMailboxInput({
        laneSeq: '1',
        source: 'linq',
        text: 'answered input',
        vault,
      })
      await stageHostedMailboxInput({
        laneSeq: '2',
        source: 'linq',
        text: 'mid-turn pending input',
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext(),
        terminalInputIds: [first.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '1',
      })
    })
  })

  it('returns the shared cursor floor when no terminal input ids are provided', async () => {
    await withCoverageVault(async (vault) => {
      const linq = await stageHostedMailboxInput({
        laneSeq: '12',
        source: 'linq',
        text: 'linq cursor',
        vault,
      })
      const telegram = await stageHostedMailboxInput({
        laneSeq: '10',
        source: 'telegram',
        text: 'telegram cursor',
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext({
          autoReply: [
            autoReplyCursor('linq', linq),
            autoReplyCursor('telegram', telegram),
          ],
        }),
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '10',
      })
    })
  })

  it('ignores idle channels when using a valid hosted mailbox cursor as coverage floor', async () => {
    await withCoverageVault(async (vault) => {
      const linqCursor = await stageHostedMailboxInput({
        laneSeq: '10',
        source: 'linq',
        text: 'linq cursor',
        vault,
      })
      const linqReply = await stageHostedMailboxInput({
        laneSeq: '11',
        source: 'linq',
        text: 'linq answered after idle telegram',
        vault,
      })

      await expect(computeAssistantAutoReplyAnsweredCoverage({
        context: coverageContext({
          autoReply: [
            autoReplyCursor('linq', linqCursor),
            {
              channel: 'telegram',
              eligibleAfter: null,
              enabledAt: '2026-04-26T00:00:00.000Z',
            },
          ],
        }),
        terminalInputIds: [linqReply.inputId],
        vault,
      })).resolves.toEqual({
        lane: 'conversation',
        laneSeq: '11',
      })
    })
  })
})

async function withCoverageVault<T>(
  run: (vault: string) => Promise<T>,
): Promise<T> {
  const vault = await mkdtemp(path.join(tmpdir(), 'assistant-auto-reply-coverage-'))
  try {
    return await run(vault)
  } finally {
    await rm(vault, {
      force: true,
      recursive: true,
    })
  }
}

async function stageHostedMailboxInput(input: {
  laneSeq: string
  source: string
  text: string
  threadId?: string
  threadIsDirect?: boolean
  vault: string
}) {
  const timestamp = coverageTimestamp(input.laneSeq)
  return await upsertAssistantInputEvent({
    event: {
      content: {
        text: input.text,
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: input.source,
        threadId: input.threadId ?? `${input.source}_thread_1`,
        threadIsDirect: input.threadIsDirect ?? true,
      },
      occurredAt: timestamp,
      receivedAt: timestamp,
      sourceRef: {
        dedupeKey: `dedupe_${input.laneSeq}`,
        eventId: `evt_${input.laneSeq}`,
        itemId: `mailbox_item_${input.laneSeq}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.laneSeq,
        payloadSchema: 'murph.hosted-payload.v1',
        payloadSource: 'sidecar',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-wake.v1',
      },
    },
    vault: input.vault,
  })
}

async function readAnsweredCoveragePendingSeqCount(vault: string): Promise<number> {
  const statePath = path.join(
    resolveAssistantStatePaths(vault).assistantStateRoot,
    'auto-reply',
    'answered-coverage.json',
  )
  const parsed = JSON.parse(await readFile(statePath, 'utf8')) as {
    pendingLaneRanges?: Array<{ endSeq?: unknown; startSeq?: unknown }>
  }
  return (parsed.pendingLaneRanges ?? []).reduce((count, range) => {
    if (typeof range.startSeq !== 'string' || typeof range.endSeq !== 'string') {
      return count
    }
    const start = Number.parseInt(range.startSeq, 10)
    const end = Number.parseInt(range.endSeq, 10)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return count
    }
    return count + end - start + 1
  }, 0)
}

function coverageTimestamp(laneSeq: string): string {
  const offsetSeconds = Number.parseInt(laneSeq, 10)
  const safeOffsetSeconds = Number.isFinite(offsetSeconds) ? offsetSeconds : 0
  return new Date(Date.UTC(2026, 3, 26, 0, 0, safeOffsetSeconds)).toISOString()
}

function coverageContext(input: {
  autoReply?: readonly {
    channel: string
    eligibleAfter: ReturnType<typeof autoReplyCursor>['eligibleAfter'] | null
    enabledAt: string
  }[]
} = {}) {
  return {
    autoReply: input.autoReply ?? [
      {
        channel: 'linq',
        eligibleAfter: null,
        enabledAt: '2026-04-26T00:00:00.000Z',
      },
      {
        channel: 'telegram',
        eligibleAfter: null,
        enabledAt: '2026-04-26T00:00:00.000Z',
      },
    ],
  }
}

function autoReplyCursor(
  channel: string,
  event: AssistantInputEventRecord,
) {
  return {
    channel,
    eligibleAfter: event.cursor,
    enabledAt: '2026-04-26T00:00:00.000Z',
  }
}

async function writeReplyEvidence(input: {
  inputIds: readonly string[]
  vault: string
}): Promise<void> {
  await writeAssistantAutoReplyReplyTerminalEvidence({
    captureIds: [],
    deliveryIntentId: 'outbox_coverage_test',
    inputIds: input.inputIds,
    linqMessageIds: [],
    outcome: 'deferred',
    recordedAt: '2026-04-26T00:00:00.000Z',
    sessionId: 'session_coverage_test',
    terminalKind: 'reply_intent_committed',
    vault: input.vault,
  })
}
