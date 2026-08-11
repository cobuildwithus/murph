import * as z from '@murphai/contracts/zod-runtime'

import {
  createHostedDataApiLabelsClient,
  hostedDataApiLabelBatchSearchInputSchema,
  hostedDataApiLabelSearchInputSchema,
  hostedDataApiLabelSearchItemSchema,
  type HostedDataApiLabelsDependencies,
} from './hosted-data-api-labels.js'

const FOOD_LABELS_API_PATH = '/api/foods'
const FOOD_LABELS_RESULT_SOURCE = 'murph-data-api'

const foodLabelsClient = createHostedDataApiLabelsClient({
  apiPath: FOOD_LABELS_API_PATH,
  errorCodePrefix: 'food_labels_api',
  resultSource: FOOD_LABELS_RESULT_SOURCE,
  searchDescription: 'Food label search',
})

export const foodLabelSearchInputSchema = hostedDataApiLabelSearchInputSchema.extend({
  fullLabel: z.boolean().optional(),
  genericOnly: z.boolean().optional(),
})
export const foodLabelSearchItemSchema = hostedDataApiLabelSearchItemSchema
export const foodLabelSearchResultSchema = foodLabelsClient.searchResultSchema
export const foodLabelBatchSearchInputSchema = hostedDataApiLabelBatchSearchInputSchema.extend({
  fullLabel: z.boolean().optional(),
  genericOnly: z.boolean().optional(),
})
export const foodLabelBatchSearchResultSchema = foodLabelsClient.batchSearchResultSchema

export type FoodLabelSearchInput = z.infer<typeof foodLabelSearchInputSchema>
export type FoodLabelSearchResult = z.infer<typeof foodLabelSearchResultSchema>
export type FoodLabelBatchSearchInput = z.infer<typeof foodLabelBatchSearchInputSchema>
export type FoodLabelBatchSearchResult = z.infer<typeof foodLabelBatchSearchResultSchema>

export async function searchFoodLabels(
  rawInput: FoodLabelSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<FoodLabelSearchResult> {
  const input = foodLabelSearchInputSchema.parse(rawInput)
  return await foodLabelsClient.searchLabels({
    genericOnly: input.genericOnly,
    includeOffMarket: input.includeOffMarket,
    limit: input.limit ?? 1,
    nutritionOnly: input.fullLabel !== true,
    q: input.q,
  }, dependencies)
}

export async function searchFoodLabelsBatch(
  rawInput: FoodLabelBatchSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<FoodLabelBatchSearchResult> {
  const input = foodLabelBatchSearchInputSchema.parse(rawInput)
  return await foodLabelsClient.searchLabelsBatch({
    genericOnly: input.genericOnly,
    includeOffMarket: input.includeOffMarket,
    limit: input.limit ?? 1,
    nutritionOnly: input.fullLabel !== true,
    queries: input.queries,
  }, dependencies)
}
