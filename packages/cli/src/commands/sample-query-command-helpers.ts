import { VaultCliError } from '../vault-cli-errors.js'
import {
  applyLimit,
  compareByLatest,
  loadQueryRuntime,
  toCommandShowEntity,
  toSampleCommandListItem,
  type CommandShowEntity,
  type SampleCommandListItem,
} from './query-record-command-helpers.js'

export interface SampleListOptions {
  from?: string
  limit?: number
  quality?: string
  stream?: string
  to?: string
}

export async function showSample(
  vaultRoot: string,
  sampleId: string,
): Promise<CommandShowEntity> {
  const query = await loadQueryRuntime()
  const vault = await query.readVault(vaultRoot)
  const record = query.lookupRecordById(vault, sampleId)

  if (!record || record.recordType !== 'sample') {
    throw new VaultCliError('not_found', `No sample found for "${sampleId}".`)
  }

  return toCommandShowEntity(record)
}

export async function listSamples(
  vaultRoot: string,
  options: SampleListOptions = {},
): Promise<SampleCommandListItem[]> {
  const query = await loadQueryRuntime()
  const vault = await query.readVault(vaultRoot)
  const items = query
    .listRecords(vault, {
      from: options.from,
      recordTypes: ['sample'],
      streams: options.stream ? [options.stream] : undefined,
      to: options.to,
    })
    .filter((record) => (options.quality ? record.status === options.quality : true))
    .sort(compareByLatest)

  return applyLimit(items, options.limit).map(toSampleCommandListItem)
}
