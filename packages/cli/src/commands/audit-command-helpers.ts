import { VaultCliError } from '../vault-cli-errors.js'
import {
  applyLimit,
  compareByLatest,
  firstString,
  loadQueryRuntime,
  matchesDateRange,
  matchesOptionalString,
  toAuditCommandListItem,
  toCommandShowEntity,
  type AuditCommandListItem,
  type CommandShowEntity,
} from './query-record-command-helpers.js'

export type { AuditCommandListItem } from './query-record-command-helpers.js'

export type AuditSortOrder = 'asc' | 'desc'

export interface AuditListOptions {
  action?: string
  actor?: string
  from?: string
  limit?: number
  sort?: AuditSortOrder
  status?: string
  to?: string
}

export async function showAudit(
  vaultRoot: string,
  auditId: string,
): Promise<CommandShowEntity> {
  const query = await loadQueryRuntime()
  const vault = await query.readVault(vaultRoot)
  const record = query.lookupRecordById(vault, auditId)

  if (!record || record.recordType !== 'audit') {
    throw new VaultCliError('not_found', `No audit record found for "${auditId}".`)
  }

  return toCommandShowEntity(record, ['targetIds'])
}

export async function listAudits(
  vaultRoot: string,
  options: AuditListOptions = {},
): Promise<AuditCommandListItem[]> {
  const query = await loadQueryRuntime()
  const vault = await query.readVault(vaultRoot)
  const sorted = [...vault.audits]
    .filter((record) => matchesOptionalString(firstString(record.data, ['action']), options.action))
    .filter((record) => matchesOptionalString(firstString(record.data, ['actor']), options.actor))
    .filter((record) => matchesOptionalString(record.status ?? null, options.status))
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .sort(compareByLatest)

  const items = options.sort === 'asc' ? [...sorted].reverse() : sorted
  return applyLimit(items, options.limit).map(toAuditCommandListItem)
}
