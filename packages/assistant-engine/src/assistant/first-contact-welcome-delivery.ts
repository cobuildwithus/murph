import { createHash } from 'node:crypto'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { finalizeAssistantTurnFromDeliveryOutcome } from './delivery-service.js'
import {
  hasAssistantSeenFirstContact,
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from './first-contact-welcome.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { buildResolveAssistantSessionInput } from './session-resolution.js'
import type { AssistantSessionResolutionFields } from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

export interface AssistantFirstContactWelcomeInput extends Pick<
  AssistantSessionResolutionFields,
  'channel' | 'identityId' | 'threadId' | 'threadIsDirect'
> {
  abortSignal?: AbortSignal
  vault: string
}

export interface AssistantFirstContactWelcomeResult {
  reason: 'already-seen' | 'existing-session' | 'queued' | 'sent'
  session: AssistantSession
  turnId: string | null
}

type AssistantFirstContactWelcomeMode = 'queue' | 'send'

export async function sendAssistantFirstContactWelcomeLocal(
  input: AssistantFirstContactWelcomeInput,
): Promise<AssistantFirstContactWelcomeResult> {
  return runAssistantFirstContactWelcomeLocal(input, 'send')
}

export async function queueAssistantFirstContactWelcomeLocal(
  input: AssistantFirstContactWelcomeInput,
): Promise<AssistantFirstContactWelcomeResult> {
  return runAssistantFirstContactWelcomeLocal(input, 'queue')
}

async function runAssistantFirstContactWelcomeLocal(
  input: AssistantFirstContactWelcomeInput,
  mode: AssistantFirstContactWelcomeMode,
): Promise<AssistantFirstContactWelcomeResult> {
  const defaults = await resolveAssistantOperatorDefaults()

  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const state = createAssistantRuntimeStateService(input.vault)
      const sessionInput = buildResolveAssistantSessionInput({
        channel: input.channel,
        identityId: input.identityId,
        threadId: input.threadId,
        threadIsDirect: input.threadIsDirect,
        vault: input.vault,
      }, defaults, createDefaultLocalAssistantModelTarget())
      const resolveInput = (({ vault: _vault, ...rest }) => rest)(sessionInput)
      const resolved = await state.sessions.resolve(resolveInput)
      const firstContactStateDocIds = resolveAssistantFirstContactStateDocIds({
        actorId: resolved.session.binding.actorId,
        channel: resolved.session.binding.channel,
        identityId: resolved.session.binding.identityId,
        threadId: resolved.session.binding.threadId,
        threadIsDirect: resolved.session.binding.threadIsDirect,
      })

      if (await hasAssistantSeenFirstContact({
        docIds: firstContactStateDocIds,
        vault: input.vault,
      })) {
        return {
          reason: 'already-seen',
          session: resolved.session,
          turnId: null,
        }
      }

      const transcriptEntries = await state.transcripts.list(resolved.session.sessionId)
      const welcomeAlreadyPersisted = transcriptEntries.some(
        (entry) =>
          entry.kind === 'assistant' &&
          entry.text === ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      )

      if (welcomeAlreadyPersisted) {
        const recoveredAt = new Date().toISOString()
        const session =
          resolved.session.turnCount > 0
            ? resolved.session
            : await state.sessions.save({
                ...resolved.session,
                updatedAt: recoveredAt,
                lastTurnAt: resolved.session.lastTurnAt ?? recoveredAt,
                turnCount: 1,
              })
        await markAssistantFirstContactSeen({
          docIds: firstContactStateDocIds,
          seenAt: session.lastTurnAt ?? session.updatedAt,
          vault: input.vault,
        })
        return {
          reason: 'already-seen',
          session,
          turnId: buildAssistantFirstContactWelcomeTurnId(resolved.session.sessionId),
        }
      }

      if (resolved.session.turnCount > 0) {
        await markAssistantFirstContactSeen({
          docIds: firstContactStateDocIds,
          seenAt: new Date().toISOString(),
          vault: input.vault,
        })
        return {
          reason: 'existing-session',
          session: resolved.session,
          turnId: null,
        }
      }

      const turnId = buildAssistantFirstContactWelcomeTurnId(resolved.session.sessionId)
      const receipt = await state.turns.readReceipt(turnId)
        ?? await state.turns.createReceipt({
          deliveryRequested: true,
          metadata: {
            kind: 'assistant-first-contact-welcome',
          },
          prompt: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
          provider: resolved.session.provider,
          providerModel: resolved.session.providerOptions.model ?? null,
          sessionId: resolved.session.sessionId,
          turnId,
        })
      const outboxInput = {
        bindingDelivery: resolved.session.binding.delivery,
        channel: resolved.session.binding.channel,
        dedupeToken: 'assistant-first-contact-welcome',
        deliveryIdempotencyKey: buildAssistantFirstContactWelcomeDeliveryIdempotencyKey(
          resolved.session.sessionId,
        ),
        identityId: resolved.session.binding.identityId,
        message: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
        sessionId: resolved.session.sessionId,
        threadId: resolved.session.binding.threadId,
        threadIsDirect: resolved.session.binding.threadIsDirect,
        turnId: receipt.turnId,
      }

      if (mode === 'queue') {
        const intent = await state.outbox.createIntent(outboxInput)
        await state.transcripts.append(
          resolved.session.sessionId,
          [
            {
              kind: 'assistant',
              text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
              createdAt: intent.createdAt,
            },
          ],
        )
        const session = await state.sessions.save({
          ...resolved.session,
          updatedAt: intent.createdAt,
          lastTurnAt: intent.createdAt,
          turnCount: resolved.session.turnCount + 1,
        })

        await finalizeAssistantTurnFromDeliveryOutcome({
          outcome: {
            kind: 'queued',
            error: null,
            intentId: intent.intentId,
            session,
          },
          response: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
          turnId: receipt.turnId,
          vault: input.vault,
        })
        await markAssistantFirstContactSeen({
          docIds: firstContactStateDocIds,
          seenAt: session.lastTurnAt ?? session.updatedAt,
          vault: input.vault,
        })
        await state.status.refreshSnapshot()

        return {
          reason: 'queued',
          session,
          turnId: receipt.turnId,
        }
      }

      const outcome = await state.outbox.deliverMessage(outboxInput)

      if (outcome.kind !== 'sent') {
        throw outcome.deliveryError ?? new VaultCliError(
          'ASSISTANT_DELIVERY_FAILED',
          'Assistant first-contact welcome did not deliver successfully.',
        )
      }

      await state.transcripts.append(
        resolved.session.sessionId,
        [
          {
            kind: 'assistant',
            text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
            createdAt: outcome.delivery.sentAt,
          },
        ],
      )
      const session = await state.sessions.save({
        ...resolved.session,
        updatedAt: outcome.delivery.sentAt,
        lastTurnAt: outcome.delivery.sentAt,
        turnCount: resolved.session.turnCount + 1,
      })

      await finalizeAssistantTurnFromDeliveryOutcome({
        firstTurnCheckInInjected: true,
        firstTurnCheckInStateDocIds: firstContactStateDocIds,
        outcome: {
          kind: 'sent',
          delivery: outcome.delivery,
          intentId: outcome.intent.intentId,
          session,
        },
        response: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
        turnId: receipt.turnId,
        vault: input.vault,
      })
      await state.status.refreshSnapshot()

      return {
        reason: 'sent',
        session,
        turnId: receipt.turnId,
      }
    },
  })
}

function buildAssistantFirstContactWelcomeTurnId(sessionId: string): string {
  return `turn_first_contact_${createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}`
}

function buildAssistantFirstContactWelcomeDeliveryIdempotencyKey(
  sessionId: string,
): string {
  return `assistant-first-contact:${sessionId}`
}
