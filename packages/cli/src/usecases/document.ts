import { z } from 'incur'
import type {
  ListResult,
  ShowResult,
} from '../vault-cli-contracts.js'
import {
  rawImportManifestResultSchema,
  showDocumentManifest,
  showDocumentRecord,
  listDocumentRecords,
} from '../commands/document-meal-read-helpers.js'

export type RawImportManifestResult = z.infer<
  typeof rawImportManifestResultSchema
>

export async function showDocument(input: {
  vault: string
  id: string
}): Promise<ShowResult> {
  return showDocumentRecord(input.vault, input.id)
}

export async function listDocuments(input: {
  vault: string
  from?: string
  to?: string
}): Promise<ListResult> {
  return listDocumentRecords(input)
}

export async function showDocumentImportManifest(input: {
  vault: string
  id: string
}): Promise<RawImportManifestResult> {
  return showDocumentManifest(input.vault, input.id)
}
