import { createHash } from 'node:crypto'
import { parseAssistantSessionRecord, type AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { buildCodexResumeState } from '@murphai/operator-config/assistant/codex-resume-state'
import { createAssistantBinding } from './bindings.js'
import { getAssistantSession, isAssistantSessionNotFoundError, saveAssistantSession } from './store.js'
import { readCodexThreadCompatibilityFingerprint, readCodexThreadRouteFingerprint } from './codex-thread-route.js'
import type { AssistantCodexTurnRecoveryOutcome } from './codex-turn-runner.js'
import type { AssistantHostedExecutionContext } from './execution-context.js'
import type { AssistantProviderServiceTier } from './providers/types.js'

const RECAP_FLEX_CAPACITY_BUDGET_MS = 20 * 60_000

/** The existing session store retains the generation's native rollout across checkpoints.
 * No route binding: this execution session must never become the room's reply session. */
export async function prepareRecapExecution(input: {
  vault: string; hosted: AssistantHostedExecutionContext | null; session: AssistantSession
  serviceTier: AssistantProviderServiceTier | null | undefined
}) {
  const scope = input.hosted?.gameRecapScope
  if (!scope?.show) return {
    providerSession: input.session, serviceTier: input.serviceTier,
    restoreRoomSession: (_outcome: AssistantCodexTurnRecoveryOutcome) => {},
    retain: async (_outcome: AssistantCodexTurnRecoveryOutcome) => {},
  }
  const sessionId = `asess_${createHash('sha256').update(`recap-execution:${scope.eventId}`).digest('hex').slice(0, 32)}`
  let session: AssistantSession
  try {
    session = await getAssistantSession(input.vault, sessionId)
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) throw error
    const now = new Date().toISOString()
    session = await saveAssistantSession(input.vault, parseAssistantSessionRecord({
      schema: 'murph.assistant-conversation.v2', conversationId: sessionId,
      codexTarget: input.session.target, codexResume: null, alias: null,
      binding: createAssistantBinding({}), createdAt: now, updatedAt: now,
      lastTurnAt: null, turnCount: 0,
    }))
  }
  // A missing retained rollout is not permission to repeat media work.
  if (session.turnCount > 0 && !session.codexResume) throw new Error('Recap continuation is unavailable.')
  return {
    serviceTier: Date.now() - Date.parse(session.createdAt) < RECAP_FLEX_CAPACITY_BUDGET_MS ? 'flex' as const : null,
    providerSession: { ...input.session, codexResume: session.codexResume, resumeState: session.codexResume },
    restoreRoomSession(outcome: AssistantCodexTurnRecoveryOutcome) {
      // Continuation belongs to the recap; delivery preserves the room binding.
      if (outcome.kind === 'succeeded') outcome.providerTurn.session = input.session
      else outcome.session = input.session
    },
    retain: (outcome: AssistantCodexTurnRecoveryOutcome) => retainRecapExecution({ vault: input.vault, session, outcome }),
  }
}

async function retainRecapExecution(input: {
  vault: string; session: AssistantSession; outcome: AssistantCodexTurnRecoveryOutcome
}): Promise<void> {
  const result = input.outcome.kind === 'succeeded' ? input.outcome.providerTurn : input.outcome
  const resume = buildCodexResumeState({
    assistantContractFingerprint: result.assistantContractFingerprint,
    rolloutRelativePath: result.codexRolloutRelativePath,
    routeFingerprint: readCodexThreadRouteFingerprint(result.route),
    threadCompatibilityFingerprint: readCodexThreadCompatibilityFingerprint(result.route),
    threadId: result.codexThreadId,
    transcriptSeenThrough: result.transcriptBoundary,
  })
  if (!resume) return
  const now = new Date().toISOString()
  await saveAssistantSession(input.vault, { ...input.session, codexResume: resume, resumeState: resume,
    updatedAt: now, lastTurnAt: now, turnCount: input.session.turnCount + 1 })
}
