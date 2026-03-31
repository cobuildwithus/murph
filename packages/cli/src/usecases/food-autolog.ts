import type { AssistantCronSchedule } from '@murph/assistant-core/assistant-cli-contracts'
import { z } from 'incur'

export const dailyFoodTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Expected a 24-hour HH:MM time.')

export function slugifyFoodLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

export function buildDailyFoodCronExpression(time: string) {
  const normalizedTime = dailyFoodTimeSchema.parse(time)
  const [hour, minute] = normalizedTime.split(':')

  return `${Number.parseInt(minute ?? '0', 10)} ${Number.parseInt(hour ?? '0', 10)} * * *`
}

export function buildDailyFoodSchedule(
  time: string,
  timeZone: string,
): AssistantCronSchedule {
  return {
    kind: 'dailyLocal',
    localTime: dailyFoodTimeSchema.parse(time),
    timeZone,
  }
}

export function buildDailyFoodCronJobName(slug: string) {
  return `food-daily:${slug}`
}

export function buildDailyFoodCronPrompt(title: string) {
  return `Auto-log recurring food "${title}" as a note-only meal.`
}

export function renderAutoLoggedFoodMealNote(input: {
  title: string
  summary?: unknown
  serving?: unknown
  ingredients?: unknown
  note?: unknown
}) {
  const sections: string[] = [input.title.trim()]

  if (typeof input.summary === 'string' && input.summary.trim()) {
    sections.push(input.summary.trim())
  }

  if (typeof input.serving === 'string' && input.serving.trim()) {
    sections.push(`Serving: ${input.serving.trim()}`)
  }

  const ingredients = Array.isArray(input.ingredients)
    ? input.ingredients.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
    : []

  if (ingredients.length > 0) {
    sections.push(['Ingredients:', ...ingredients.map((entry) => `- ${entry}`)].join('\n'))
  }

  if (typeof input.note === 'string' && input.note.trim()) {
    sections.push(input.note.trim())
  }

  return sections.join('\n\n')
}
