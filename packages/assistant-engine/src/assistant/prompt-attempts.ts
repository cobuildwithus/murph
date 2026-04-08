import type {
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
} from './store.js'

export async function persistFailedAssistantPromptAttempt(input: {
  persistUserPromptOnFailure: boolean
  prompt: string
  session: AssistantSession
  turnCreatedAt: string
  turnTrigger: AssistantTurnTrigger
  vault: string
}): Promise<void> {
  if (input.persistUserPromptOnFailure) {
    return
  }

  const text = buildFailedAssistantPromptAttemptText({
    prompt: input.prompt,
    turnTrigger: input.turnTrigger,
  })
  const existing = await listAssistantTranscriptEntries(
    input.vault,
    input.session.sessionId,
  )
  const lastEntry = existing.at(-1)
  if (lastEntry?.kind === 'error' && lastEntry.text === text) {
    return
  }

  await appendAssistantTranscriptEntries(
    input.vault,
    input.session.sessionId,
    [
      {
        kind: 'error',
        text,
        createdAt: input.turnCreatedAt,
      },
    ],
  )
}

export function buildFailedAssistantPromptAttemptText(input: {
  prompt: string
  turnTrigger: AssistantTurnTrigger
}): string {
  const prompt =
    input.turnTrigger === 'automation-auto-reply'
      ? extractAssistantAutoReplyFailedPromptText(input.prompt)
      : input.prompt
  return `Failed assistant prompt attempt [${input.turnTrigger}]: ${prompt}`
}

export function extractAssistantAutoReplyFailedPromptText(prompt: string): string {
  const matched = Array.from(
    prompt.matchAll(
      /(?:^|\n)(?:Capture \d+:\n)?(?:Reply context:\n[\s\S]*?\n\n)?Message text:\n([\s\S]*?)(?=\n\n(?:Capture \d+:|Attachment context:|Reply context:|$)|$)/gu,
    ),
    (match) => match[1]?.trim() ?? '',
  ).filter((value) => value.length > 0)

  if (matched.length === 0) {
    return prompt
  }

  return matched.length === 1 ? matched[0] : matched.join('\n\n')
}
