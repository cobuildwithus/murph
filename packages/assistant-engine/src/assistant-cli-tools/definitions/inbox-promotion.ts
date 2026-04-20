import {
  eventSourceSchema,
  mealNutritionSchema,
} from '@murphai/contracts'
import { z } from 'zod'
import type { AssistantToolContext } from '../shared.js'
import { defineHandAuthoredHelperTool } from '../definition-factory.js'

const isoTimestampSchema = z.string().min(1)
const mealIngredientSchema = z.string().trim().min(1).max(4000)
const mealIngredientsSchema = z
  .array(mealIngredientSchema)
  .max(100)

export function createInboxPromotionToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.inboxServices || !input.captureId) {
    return []
  }

  const captureIdSchema = z.object({
    captureId: z.literal(input.captureId),
  })
  const mealPromotionInputSchema = captureIdSchema.extend({
    note: z.string().trim().min(1).optional(),
    occurredAt: isoTimestampSchema.optional(),
    source: eventSourceSchema.optional(),
    ingredients: mealIngredientsSchema.optional(),
    nutrition: mealNutritionSchema.optional(),
  })

  return [
    defineHandAuthoredHelperTool({
      name: 'inbox.promote.meal',
      description:
        'Promote the current inbox capture into canonical meal storage when it is primarily a meal, snack, or drink log. Preserve the capture-backed photo or audio context, and pass recovered note, time, source, ingredient, or nutrition details when you have them.',
      inputSchema: mealPromotionInputSchema,
      inputExample: {
        captureId: input.captureId,
        note: 'Only ate the sweet potatoes and green beans.',
        ingredients: ['sweet potatoes', 'green beans'],
        nutrition: {
          totals: {
            calories: 180,
          },
          provenance: {
            source: 'estimated',
            confidence: 'medium',
            sourceDetail: 'Estimated from the photo and note.',
          },
        },
      },
      execute: ({ captureId, note, occurredAt, source, ingredients, nutrition }) =>
        input.inboxServices!.promoteMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
          note,
          occurredAt,
          source,
          ingredients,
          nutrition,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'inbox.promote.document',
      description:
        'Promote the current inbox capture into canonical document storage when the primary value is a PDF, report, scan, screenshot, form, or other stored document attachment.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteDocument({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'inbox.promote.journal',
      description:
        'Promote the current inbox capture into the canonical journal day when it is best represented as a freeform note, workout note, symptom note, or reminder.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'inbox.promote.experimentNote',
      description:
        'Promote the current inbox capture into one matching experiment page when the capture is clearly an experiment checkpoint or experiment note.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteExperimentNote({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
  ]
}
