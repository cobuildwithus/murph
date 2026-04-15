import type { AssistantTurnReceipt } from '@murphai/operator-config/assistant-cli-contracts'

const ASSISTANT_FIRST_CONTACT_WELCOME_KIND = 'assistant-first-contact-welcome'
const ASSISTANT_FIRST_CONTACT_WELCOME_FROM_PHONE_METADATA_KEY =
  'firstContactFromPhone'

export function buildAssistantFirstContactWelcomeTurnMetadata(input: {
  fromPhoneNumber?: string | null
} = {}): Record<string, string> {
  const metadata: Record<string, string> = {
    kind: ASSISTANT_FIRST_CONTACT_WELCOME_KIND,
  }
  const fromPhoneNumber = normalizeMetadataValue(input.fromPhoneNumber)
  if (fromPhoneNumber) {
    metadata[ASSISTANT_FIRST_CONTACT_WELCOME_FROM_PHONE_METADATA_KEY] =
      fromPhoneNumber
  }
  return metadata
}

export function readAssistantFirstContactWelcomeFromPhoneNumber(
  receipt: Pick<AssistantTurnReceipt, 'timeline'> | null | undefined,
): string | null {
  for (const event of receipt?.timeline ?? []) {
    const value = normalizeMetadataValue(
      event.metadata[ASSISTANT_FIRST_CONTACT_WELCOME_FROM_PHONE_METADATA_KEY],
    )
    if (value) {
      return value
    }
  }

  return null
}

function normalizeMetadataValue(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}
