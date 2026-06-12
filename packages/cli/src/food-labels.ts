import { z } from 'zod'

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
  numericExactIdPrefix: 'fdc:',
  resultSource: FOOD_LABELS_RESULT_SOURCE,
  searchDescription: 'Food label search',
})

export const foodLabelSearchInputSchema = hostedDataApiLabelSearchInputSchema
export const foodLabelSearchItemSchema = hostedDataApiLabelSearchItemSchema
export const foodLabelSearchResultSchema = foodLabelsClient.searchResultSchema
export const foodLabelBatchSearchInputSchema = hostedDataApiLabelBatchSearchInputSchema
export const foodLabelBatchSearchResultSchema = foodLabelsClient.batchSearchResultSchema

export type FoodLabelSearchInput = z.infer<typeof foodLabelSearchInputSchema>
export type FoodLabelSearchResult = z.infer<typeof foodLabelSearchResultSchema>
export type FoodLabelBatchSearchInput = z.infer<typeof foodLabelBatchSearchInputSchema>
export type FoodLabelBatchSearchResult = z.infer<typeof foodLabelBatchSearchResultSchema>

export async function searchFoodLabels(
  rawInput: FoodLabelSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<FoodLabelSearchResult> {
  return await foodLabelsClient.searchLabels(rawInput, dependencies)
}

export async function searchFoodLabelsBatch(
  rawInput: FoodLabelBatchSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<FoodLabelBatchSearchResult> {
  return await foodLabelsClient.searchLabelsBatch(rawInput, dependencies)
}
