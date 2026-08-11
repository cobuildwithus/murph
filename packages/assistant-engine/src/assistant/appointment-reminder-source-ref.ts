import { createHash } from 'node:crypto'

export const ASSISTANT_APPOINTMENT_REMINDER_SOURCE_REF_PATTERN =
  /^ais_[0-9a-f]{32}$/u

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
