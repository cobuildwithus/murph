import { listGoals, readMemoryDocument, upsertMemory } from '@murphai/core'
import {
  DAILY_NUTRITION_OPTIONAL_GOALS_INTRO,
  readDailyNutritionIntroduction,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'

/** Existing canonical memory, not a new nutrition state or target owner. */
export const NUTRITION_GOAL_INVITATION_SENT_MEMORY =
  'Murph has sent the optional nutrition-goal setup invitation. Do not offer it again unless the member engages; silence and meal replies never accept goals.'

/**
 * Suitability and prior free-text declines remain the skill/instructions owner's
 * decision. The model must opt into exactly the fixed copy; ordinary final prose
 * cannot become an invitation or bypass the complete-card response rule.
 */
export async function resolveDailyNutritionIntroduction(input: {
  card: AssistantResponseCard | null
  message: string | null | undefined
  vault: string | null | undefined
}): Promise<string | null> {
  const introduction = readDailyNutritionIntroduction(input.card, input.message)
  if (!introduction || !input.vault) return null
  try {
    const memory = await readMemoryDocument(input.vault)
    if (memory.records.some((record) =>
      record.text === NUTRITION_GOAL_INVITATION_SENT_MEMORY)) return null
    // A prior canonical proposal (especially abandoned) is already engagement,
    // not a first introduction. Read-only all-status evidence also covers older
    // declines that predate the sent-memory note. Never create/change a Goal.
    const goals = await listGoals(input.vault)
    if (goals.length >= 200 || goals.some(({ entity }) =>
      entity.slug === 'murph-daily-nutrition-starting-targets')) return null
    return introduction
  } catch {
    // Optional copy fails closed; do not block an otherwise valid totals card.
    return null
  }
}

/** Also recognizes the frozen semantic message after definitive card fallback.
 * This does NOT authorize companion text: renderers do that against the card.
 */
export function containsNutritionGoalInvitation(message: string): boolean {
  return message === DAILY_NUTRITION_OPTIONAL_GOALS_INTRO ||
    message.endsWith(`\n\n${DAILY_NUTRITION_OPTIONAL_GOALS_INTRO}`)
}

/** Call only from successful outbox terminal confirmation. Never during attach. */
export async function recordSentNutritionGoalInvitation(input: {
  message: string
  threadIsDirect: boolean | null | undefined
  vault: string
}): Promise<void> {
  if (input.threadIsDirect !== true || !containsNutritionGoalInvitation(input.message)) return
  const memory = await readMemoryDocument(input.vault)
  if (memory.records.some((record) => record.text === NUTRITION_GOAL_INVITATION_SENT_MEMORY)) return
  await upsertMemory(input.vault, {
    section: 'Context',
    text: NUTRITION_GOAL_INVITATION_SENT_MEMORY,
  })
}
