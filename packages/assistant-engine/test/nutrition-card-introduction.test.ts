import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { initializeVault, listGoals, readMemoryDocument, upsertGoal } from '@murphai/core'
import {
  DAILY_NUTRITION_OPTIONAL_GOALS_INTRO,
  renderAssistantResponseCardText,
  type DailyNutritionResponseCardV2,
} from '@murphai/operator-config/assistant-response-cards'
import {
  containsNutritionGoalInvitation,
  NUTRITION_GOAL_INVITATION_SENT_MEMORY,
  recordSentNutritionGoalInvitation,
  resolveDailyNutritionIntroduction,
} from '../src/assistant/nutrition-card-introduction.ts'

const card: DailyNutritionResponseCardV2 = {
  kind: 'daily_nutrition', version: 2, localDate: '2026-09-11', mealCount: 1,
  totals: {
    calories: { total: 610, mealCount: 1 }, proteinGrams: { total: 28, mealCount: 1 },
    carbsGrams: { total: 84, mealCount: 1 }, fatGrams: { total: 17, mealCount: 1 },
    fiberGrams: { total: 14, mealCount: 1 },
  },
  goals: { calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null, fiberGrams: null },
}
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'nutrition-introduction-'))
  roots.push(root)
  await initializeVault({ vaultRoot: root, timezone: 'America/New_York' })
  return root
}

it('stages no offer state and records confirmed sent copy idempotently in canonical memory only', async () => {
  const root = await vault()
  const input = { card, message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO, vault: root }
  const before = await readMemoryDocument(root)
  expect(await resolveDailyNutritionIntroduction(input)).toBe(DAILY_NUTRITION_OPTIONAL_GOALS_INTRO)
  expect(await readMemoryDocument(root)).toMatchObject({ exists: before.exists, records: before.records })
  const message = renderAssistantResponseCardText(card, input.message)
  expect(containsNutritionGoalInvitation(message)).toBe(true)
  await recordSentNutritionGoalInvitation({ message, threadIsDirect: false, vault: root })
  expect(await readMemoryDocument(root)).toMatchObject({ exists: before.exists, records: before.records })
  await recordSentNutritionGoalInvitation({ message, threadIsDirect: true, vault: root })
  const sent = await readMemoryDocument(root)
  expect(sent.records.filter((record) => record.text === NUTRITION_GOAL_INVITATION_SENT_MEMORY)).toHaveLength(1)
  await recordSentNutritionGoalInvitation({ message, threadIsDirect: true, vault: root })
  expect(await readMemoryDocument(root)).toEqual(sent)
  expect(await resolveDailyNutritionIntroduction(input)).toBeNull()
  expect(await listGoals(root)).toEqual([])
})

it.each(['paused', 'abandoned', 'completed', 'active'] as const)(
  'does not reintroduce goal setup after a canonical %s proposal, without changing it', async (status) => {
    const root = await vault()
    await upsertGoal({ vaultRoot: root, slug: 'murph-daily-nutrition-starting-targets',
      title: 'Daily nutrition targets', status })
    const before = await listGoals(root)
    expect(await resolveDailyNutritionIntroduction({ card, message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO, vault: root })).toBeNull()
    expect(await listGoals(root)).toEqual(before)
  },
)

it('fails closed on unreadable optional preference evidence without inventing an offer receipt', async () => {
  const root = await vault()
  await writeFile(path.join(root, 'bank/memory.md'), '---\nnot: [valid\n---\n')
  expect(await resolveDailyNutritionIntroduction({ card, message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO, vault: root })).toBeNull()
  expect(renderAssistantResponseCardText(card)).toContain('610 calories')
  expect(containsNutritionGoalInvitation('ordinary meal confirmation')).toBe(false)
})
