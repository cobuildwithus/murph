import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
} from '@murphai/vault-inbox/commands/query-record-command-helpers'

export type { AuditCommandListItem } from '@murphai/vault-inbox/commands/query-record-command-helpers'

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
  const record = query.lookupEntityById(vault, auditId)

  if (!record || record.family !== 'audit') {
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
    .filter((record) => matchesOptionalString(firstString(record.attributes, ['action']), options.action))
    .filter((record) => matchesOptionalString(firstString(record.attributes, ['actor']), options.actor))
    .filter((record) => matchesOptionalString(record.status ?? null, options.status))
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .sort(compareByLatest)

  const items = options.sort === 'asc' ? [...sorted].reverse() : sorted
  return applyLimit(items, options.limit).map(toAuditCommandListItem)
}
