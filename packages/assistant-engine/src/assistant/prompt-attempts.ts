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
      /(?:^|\n)(?:(?:Input|Capture) \d+:\n)?(?:Reply context:\n[\s\S]*?\n\n)?Message text:\n([\s\S]*?)(?=\n\n(?:(?:Input|Capture) \d+:|Attachment context:|Reply context:|$)|$)/gu,
    ),
    (match) => match[1]?.trim() ?? '',
  ).filter((value) => value.length > 0)

  if (matched.length === 0) {
    return prompt
      .split('\n')
      .filter((line) =>
        !/^(?:Appointment source ref: ais_|Message ref: ain_)[0-9a-f]{32}$/u.test(line)
      )
      .join('\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim()
  }

  return matched.length === 1 ? matched[0] : matched.join('\n\n')
}
