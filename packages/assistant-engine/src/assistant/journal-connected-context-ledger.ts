import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { parseFrontmatterDocument } from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import * as z from '@murphai/contracts/zod-runtime'
import { buildKnowledgePageRelativePath, normalizeKnowledgeBody } from '../knowledge/documents.js'
import { getKnowledgePage, getKnowledgePageIfExists, upsertKnowledgePage } from '../knowledge/service.js'

export const CONNECTED_CONTEXT_LEDGER_SLUG = 'journal-connected-context'
const POLICY_MAX_BYTES = 64 * 1024

const policySchema = z.object({
  version: z.literal(1),
  optOuts: z.object({
    global: z.boolean(), accounts: z.array(z.string()),
    providers: z.array(z.string()), categories: z.array(z.string()),
    calendars: z.array(z.string()).default([]),
  }).passthrough(),
  activeAccounts: z.array(z.object({ id: z.string(), provider: z.string() })),
}).passthrough()
export type ConnectedContextPolicy = z.infer<typeof policySchema>

// Controls are the first JSON line; source mappings follow in the same page.
// A compact legacy JSON object remains readable, including its source mappings.
export function parseConnectedContextLedgerBody(body: string) {
  const newline = body.indexOf('\n')
  const prefix = newline < 0 ? body : body.slice(0, newline)
  try {
    return { policy: policySchema.parse(JSON.parse(prefix)), suffix: newline < 0 ? '' : body.slice(newline) }
  } catch {
    return { policy: policySchema.parse(JSON.parse(body)), suffix: '' }
  }
}

export async function readConnectedContextPolicy(vaultRoot: string): Promise<ConnectedContextPolicy | null> {
  const result = await readConnectedContextPolicyState(vaultRoot)
  return result.kind === 'readable' ? result.policy : null
}

export type ConnectedContextPolicyState =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'readable'; policy: ConnectedContextPolicy }

/** Only a missing page is absence; path, read, status and parse failures are unknown. */
export async function readConnectedContextPolicyState(vaultRoot: string): Promise<ConnectedContextPolicyState> {
  try {
    const filePath = await resolveAssistantVaultPath(vaultRoot, buildKnowledgePageRelativePath(CONNECTED_CONTEXT_LEDGER_SLUG), 'file path')
    const file = await open(filePath, 'r').catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    })
    if (file === null) return { kind: 'absent' }
    try {
      const buffer = Buffer.alloc(POLICY_MAX_BYTES)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const document = parseFrontmatterDocument(buffer.subarray(0, bytesRead).toString('utf8'))
      if (document.attributes.slug !== CONNECTED_CONTEXT_LEDGER_SLUG || document.attributes.status !== 'active') return { kind: 'unreadable' }
      return { kind: 'readable', policy: parseConnectedContextLedgerBody(normalizeKnowledgeBody(document.body)).policy }
    } finally { await file.close() }
  } catch { return { kind: 'unreadable' } }
}

export async function removeConnectedContextAccount(vaultRoot: string, accountId: string): Promise<void> {
  // Unknown/missing policy already excludes connected plans. Do not replace it
  // with default permissions or discard legacy opt-outs and source mappings.
  if (!await readConnectedContextPolicy(vaultRoot)) return
  const { page } = await getKnowledgePage({ vault: vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG })
  const { policy, suffix } = parseConnectedContextLedgerBody(normalizeKnowledgeBody(page.body))
  if (!policy.activeAccounts.some(account => account.id === accountId)) return
  policy.activeAccounts = policy.activeAccounts.filter(account => account.id !== accountId)
  await upsertKnowledgePage({
    vault: vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG,
    body: JSON.stringify(policy) + suffix, expectedMarkdown: page.markdown,
  })
}

export const emptyConnectedContextPolicy = (): ConnectedContextPolicy => ({
  version: 1, optOuts: { global: false, accounts: [], providers: [], categories: [], calendars: [] }, activeAccounts: [],
})

/** Only a complete inventory may replace activeAccounts. Guard both creation
 * and updates; a racing member opt-out must never be overwritten. */
export async function reconcileConnectedContextAccounts(input: {
  vaultRoot: string
  previous: ConnectedContextPolicyState
  accounts: ConnectedContextPolicy['activeAccounts']
}): Promise<void> {
  if (input.previous.kind === 'unreadable') return
  const accounts = [...input.accounts].sort((a, b) => a.id.localeCompare(b.id))
  if (input.previous.kind === 'absent') {
    await upsertKnowledgePage({ vault: input.vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG,
      body: JSON.stringify({ ...emptyConnectedContextPolicy(), activeAccounts: accounts }), expectedMarkdown: null })
    return
  }
  const { page } = await getKnowledgePage({ vault: input.vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG })
  const { policy, suffix } = parseConnectedContextLedgerBody(normalizeKnowledgeBody(page.body))
  if (JSON.stringify(policy) !== JSON.stringify(input.previous.policy)) throw new Error('Connected policy changed.')
  if (policy.optOuts.global || JSON.stringify(policy.activeAccounts) === JSON.stringify(accounts)) return
  await upsertKnowledgePage({ vault: input.vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG,
    body: JSON.stringify({ ...policy, activeAccounts: accounts }) + suffix, expectedMarkdown: page.markdown })
}

const sourceSchema = z.object({
  accountId: z.string().min(1), sourceId: z.string().min(1), eventId: z.string().min(1),
  revision: z.number().int().nullable().default(null),
})
export async function readConnectedContextSources(vaultRoot: string) {
  const sources: z.infer<typeof sourceSchema>[] = []
  try {
    const { page } = await getKnowledgePageIfExists({ vault: vaultRoot, slug: CONNECTED_CONTEXT_LEDGER_SLUG })
    if (!page) return { sources, unreadable: false }
    const { policy, suffix } = parseConnectedContextLedgerBody(normalizeKnowledgeBody(page.body))
    const section = suffix.split(/^## Sources\s*$/mu)[1]?.split(/^## /mu)[0]?.trim()
    const entries: unknown = section ? JSON.parse(section) : policy.sources ?? []
    if (!Array.isArray(entries)) return { sources, unreadable: true }
    let unreadable = false
    for (const entry of entries) {
      const parsed = sourceSchema.safeParse(entry)
      if (parsed.success) sources.push(parsed.data)
      else unreadable = true
    }
    return { sources, unreadable }
  } catch { return { sources, unreadable: true } }
}
