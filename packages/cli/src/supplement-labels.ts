import type * as z from '@murphai/contracts/zod-runtime'

import {
  createHostedDataApiLabelsClient,
  hostedDataApiLabelBatchSearchInputSchema,
  hostedDataApiLabelSearchInputSchema,
  hostedDataApiLabelSearchItemSchema,
  type HostedDataApiLabelsDependencies,
} from './hosted-data-api-labels.js'

const SUPPLEMENT_LABELS_API_PATH = '/api/supplements'
const SUPPLEMENT_LABELS_RESULT_SOURCE = 'murph-data-api'

const supplementLabelsClient = createHostedDataApiLabelsClient({
  apiPath: SUPPLEMENT_LABELS_API_PATH,
  errorCodePrefix: 'supplement_labels_api',
  resultSource: SUPPLEMENT_LABELS_RESULT_SOURCE,
  searchDescription: 'Supplement label search',
})

export const supplementLabelSearchInputSchema = hostedDataApiLabelSearchInputSchema
export const supplementLabelSearchItemSchema = hostedDataApiLabelSearchItemSchema
export const supplementLabelSearchResultSchema = supplementLabelsClient.searchResultSchema
export const supplementLabelBatchSearchInputSchema = hostedDataApiLabelBatchSearchInputSchema
export const supplementLabelBatchSearchResultSchema =
  supplementLabelsClient.batchSearchResultSchema

export type SupplementLabelSearchInput = z.infer<typeof supplementLabelSearchInputSchema>
export type SupplementLabelSearchResult = z.infer<typeof supplementLabelSearchResultSchema>
export type SupplementLabelBatchSearchInput = z.infer<typeof supplementLabelBatchSearchInputSchema>
export type SupplementLabelBatchSearchResult =
  z.infer<typeof supplementLabelBatchSearchResultSchema>

export async function searchSupplementLabels(
  rawInput: SupplementLabelSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<SupplementLabelSearchResult> {
  return await supplementLabelsClient.searchLabels(rawInput, dependencies)
}

export async function searchSupplementLabelsBatch(
  rawInput: SupplementLabelBatchSearchInput,
  dependencies: HostedDataApiLabelsDependencies = {},
): Promise<SupplementLabelBatchSearchResult> {
  return await supplementLabelsClient.searchLabelsBatch(rawInput, dependencies)
}
