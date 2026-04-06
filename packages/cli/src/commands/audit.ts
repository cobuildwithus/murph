import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  listItemSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  type AuditSortOrder,
  type AuditCommandListItem,
  listAudits,
  showAudit,
} from './audit-command-helpers.js'
import type { VaultServices } from '@murphai/vault-inbox/vault-services'

const auditIdSchema = z
  .string()
  .regex(/^aud_[0-9A-Za-z]+$/u, 'Expected a canonical audit id in aud_* form.')

const auditListItemSchema = listItemSchema.extend({
  action: z.string().min(1).nullable(),
  actor: z.string().min(1).nullable(),
  status: z.string().min(1).nullable(),
  commandName: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
})

const auditListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    action: z.string().min(1).nullable(),
    actor: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    sort: z.enum(['asc', 'desc']),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(auditListItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerAuditCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const audit = Cli.create('audit', {
    description: 'Audit inspection commands routed through the query read model.',
  })

  audit.command('show', {
    description: 'Show one audit record by canonical audit id.',
    args: z.object({
      id: auditIdSchema.describe('Audit record id such as aud_<ULID>.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return {
        vault: options.vault,
        entity: await showAudit(options.vault, args.id),
      }
    },
  })

  audit.command('list', {
    description: 'List audit records with optional action, actor, status, and date filters.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      action: z.string().min(1).optional(),
      actor: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
      from: localDateSchema.optional(),
      to: localDateSchema.optional(),
      sort: z.enum(['asc', 'desc']).default('desc'),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: auditListResultSchema,
    async run({ options }) {
      return listAuditRecords(options.vault, {
        action: options.action,
        actor: options.actor,
        from: options.from,
        limit: options.limit,
        sort: options.sort as AuditSortOrder,
        status: options.status,
        to: options.to,
      })
    },
  })

  audit.command('tail', {
    description: 'Show the latest audit records in descending occurredAt order.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      limit: z.number().int().positive().max(200).default(20),
    }),
    output: auditListResultSchema,
    async run({ options }) {
      return listAuditRecords(options.vault, {
        limit: options.limit,
        sort: 'desc',
      })
    },
  })

  cli.command(audit)
}

async function listAuditRecords(
  vaultRoot: string,
  filters: {
    action?: string
    actor?: string
    from?: string
    limit: number
    sort: AuditSortOrder
    status?: string
    to?: string
  },
) {
  const items = await listAudits(vaultRoot, filters)

  return {
    vault: vaultRoot,
    filters: {
      action: filters.action ?? null,
      actor: filters.actor ?? null,
      status: filters.status ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      sort: filters.sort,
      limit: filters.limit,
    },
    items: items satisfies AuditCommandListItem[],
    count: items.length,
    nextCursor: null,
  }
}
