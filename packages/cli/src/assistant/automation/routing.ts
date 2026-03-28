import type { AssistantAutomationCursor } from '../../assistant-cli-contracts.js'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { InboxCliServices } from '../../inbox-services.js'
import { routeInboxCaptureWithModel } from '../../inbox-model-harness.js'
import { shouldBypassParserWaitForRouting } from '../../inbox-routing-vision.js'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultCliServices } from '../../vault-cli-services.js'
import { errorMessage } from '../shared.js'
import { assistantResultArtifactExists } from './artifacts.js'
import {
  compareAssistantCaptureOrder,
  createEmptyInboxScanResult,
  cursorFromCapture,
  normalizeScanLimit,
  type AssistantInboxScanResult,
  type AssistantRunEvent,
} from './shared.js'

type AssistantInboxCaptureSummary = Awaited<
  ReturnType<InboxCliServices['list']>
>['items'][number]

export interface AssistantRoutingCaptureOutcome {
  advanceCursor: boolean
  details?: string
  status: 'failed' | 'noop' | 'routed' | 'skipped'
  tools?: string[]
}

export async function routeAssistantInboxCapture(input: {
  capture: AssistantInboxCaptureSummary
  inboxServices: InboxCliServices
  modelSpec: AssistantModelSpec
  requestId?: string | null
  vault: string
  vaultServices?: VaultCliServices
}): Promise<AssistantRoutingCaptureOutcome> {
  const capture = input.capture

  try {
    const existingArtifact = await assistantResultArtifactExists(
      input.vault,
      capture.captureId,
    )
    if (existingArtifact) {
      return {
        advanceCursor: true,
        details: 'assistant result already exists',
        status: 'skipped',
      }
    }

    if (capture.promotions.length > 0) {
      return {
        advanceCursor: true,
        details: 'capture already promoted',
        status: 'skipped',
      }
    }

    const shown = await input.inboxServices.show({
      vault: input.vault,
      requestId: input.requestId ?? null,
      captureId: capture.captureId,
    })

    const waitingForParser = shown.capture.attachments.some(
      (attachment: InboxShowResult['capture']['attachments'][number]) => {
        if (
          attachment.parseState !== 'pending' &&
          attachment.parseState !== 'running'
        ) {
          return false
        }

        return !shouldBypassParserWaitForRouting(attachment)
      },
    )
    if (waitingForParser) {
      return {
        advanceCursor: false,
        details: 'waiting for parser completion',
        status: 'skipped',
      }
    }

    const result = await routeInboxCaptureWithModel({
      inboxServices: input.inboxServices,
      requestId: input.requestId ?? undefined,
      captureId: capture.captureId,
      vault: input.vault,
      vaultServices: input.vaultServices,
      apply: true,
      modelSpec: input.modelSpec,
    })

    if (result.plan.actions.length === 0) {
      return {
        advanceCursor: true,
        details: 'model chose no canonical writes',
        status: 'noop',
      }
    }

    return {
      advanceCursor: true,
      status: 'routed',
      tools: result.plan.actions.map((action: { tool: string }) => action.tool),
    }
  } catch (error) {
    return {
      advanceCursor: true,
      details: errorMessage(error),
      status: 'failed',
    }
  }
}

export async function scanAssistantInboxOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  oldestFirst?: boolean
  onCursorProgress?: (
    cursor: AssistantAutomationCursor | null,
  ) => Promise<void> | void
  onEvent?: (event: AssistantRunEvent) => void
  requestId?: string | null
  signal?: AbortSignal
  vault: string
  vaultServices?: VaultCliServices
}): Promise<AssistantInboxScanResult> {
  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
    afterOccurredAt: input.afterCursor?.occurredAt ?? null,
    afterCaptureId: input.afterCursor?.captureId ?? null,
    oldestFirst: input.oldestFirst ?? false,
  })
  const captures = [...listed.items].sort(compareAssistantCaptureOrder)
  input.onEvent?.({
    type: 'scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary = createEmptyInboxScanResult()
  summary.considered = captures.length

  for (const capture of captures) {
    if (input.signal?.aborted) {
      break
    }

    const outcome = await routeAssistantInboxCapture({
      capture,
      inboxServices: input.inboxServices,
      modelSpec: input.modelSpec,
      requestId: input.requestId,
      vault: input.vault,
      vaultServices: input.vaultServices,
    })
    applyRoutingOutcome({
      captureId: capture.captureId,
      onEvent: input.onEvent,
      outcome,
      summary,
    })
  }

  await input.onCursorProgress?.(
    captures.length > 0
      ? cursorFromCapture(captures[captures.length - 1]!)
      : input.afterCursor ?? null,
  )

  return summary
}

export function applyRoutingOutcome(input: {
  captureId: string
  onEvent?: (event: AssistantRunEvent) => void
  outcome: AssistantRoutingCaptureOutcome
  summary: AssistantInboxScanResult
}): void {
  switch (input.outcome.status) {
    case 'failed':
      input.summary.failed += 1
      input.onEvent?.({
        type: 'capture.failed',
        captureId: input.captureId,
        details: input.outcome.details,
      })
      return
    case 'noop':
      input.summary.noAction += 1
      input.onEvent?.({
        type: 'capture.noop',
        captureId: input.captureId,
        details: input.outcome.details,
      })
      return
    case 'routed':
      input.summary.routed += 1
      input.onEvent?.({
        type: 'capture.routed',
        captureId: input.captureId,
        tools: input.outcome.tools,
      })
      return
    case 'skipped':
      input.summary.skipped += 1
      input.onEvent?.({
        type: 'capture.skipped',
        captureId: input.captureId,
        details: input.outcome.details,
      })
  }
}
