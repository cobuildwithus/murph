import { createHash } from 'node:crypto'

import type { AssistantInputEventRecord } from './input-store.js'

export const ASSISTANT_APPOINTMENT_REMINDER_SOURCE_REF_PATTERN =
  /^ais_[0-9a-f]{32}$/u

type AssistantAppointmentReminderSourceEvent = Pick<
  AssistantInputEventRecord,
  'conversation' | 'inputId' | 'sourceMetadata'
>

export function createAssistantAppointmentReminderSourceRef(
  acceptedInputId: string,
): `ais_${string}` {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      acceptedInputId,
      schema: 'murph.appointment-reminder-source-ref.v1',
    }))
    .digest('hex')
    .slice(0, 32)
  return `ais_${digest}`
}

export function resolveAssistantAppointmentReminderSourceInputId(input: {
  acceptedInputIds: readonly string[]
  sourceRef: string
}): string | null {
  if (!ASSISTANT_APPOINTMENT_REMINDER_SOURCE_REF_PATTERN.test(input.sourceRef)) {
    return null
  }
  for (const acceptedInputId of new Set(input.acceptedInputIds)) {
    if (
      createAssistantAppointmentReminderSourceRef(acceptedInputId)
      === input.sourceRef
    ) {
      return acceptedInputId
    }
  }
  return null
}

export async function resolveAssistantAppointmentReminderSourceInputIds(input: {
  acceptedInputIds: readonly string[]
  readInputEvent(
    inputId: string,
  ): Promise<AssistantAppointmentReminderSourceEvent | null>
}): Promise<readonly string[]> {
  const sourceInputIds = new Set(input.acceptedInputIds)
  for (const acceptedInputId of input.acceptedInputIds) {
    const correction = await input.readInputEvent(acceptedInputId)
    const editedSourceInputId =
      readAssistantAppointmentReminderCorrectionSourceInputId(correction)
    if (!editedSourceInputId) {
      continue
    }
    const original = await input.readInputEvent(editedSourceInputId)
    if (
      original
      && correction
      && haveSameAssistantAppointmentReminderCorrectionAuthority({
        correction,
        original,
      })
    ) {
      sourceInputIds.add(editedSourceInputId)
    }
  }
  return [...sourceInputIds]
}

export function readAssistantAppointmentReminderCorrectionSourceInputId(
  input: Pick<AssistantAppointmentReminderSourceEvent, 'sourceMetadata'> | null,
): string | null {
  const metadata = input?.sourceMetadata
  return metadata?.kind === 'linq'
    && metadata.editedSourceInputId !== undefined
    && metadata.editedTextPartIndex !== undefined
    ? metadata.editedSourceInputId
    : null
}

function haveSameAssistantAppointmentReminderCorrectionAuthority(input: {
  correction: Pick<
    AssistantInputEventRecord,
    'conversation' | 'sourceMetadata'
  >
  original: Pick<
    AssistantInputEventRecord,
    'conversation' | 'inputId' | 'sourceMetadata'
  >
}): boolean {
  const correctionConversation = input.correction.conversation
  const originalConversation = input.original.conversation
  return (
    readAssistantAppointmentReminderCorrectionSourceInputId(input.correction)
      === input.original.inputId
    && input.correction.sourceMetadata?.kind === 'linq'
    && input.original.sourceMetadata?.kind === 'linq'
    && correctionConversation !== null
    && originalConversation !== null
    && correctionConversation.source === 'linq'
    && originalConversation.source === 'linq'
    && correctionConversation.accountId === originalConversation.accountId
    && correctionConversation.actorId === originalConversation.actorId
    && correctionConversation.actorIsSelf === originalConversation.actorIsSelf
    && correctionConversation.threadId === originalConversation.threadId
    && correctionConversation.threadIsDirect
      === originalConversation.threadIsDirect
    && input.correction.sourceMetadata?.service
      === input.original.sourceMetadata.service
  )
}
