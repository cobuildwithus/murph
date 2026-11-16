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
// Schema-owned names only; passthrough keys are member- or model-written.
const policyKeys = new Set(['version', 'optOuts', 'global', 'accounts', 'providers', 'categories', 'calendars', 'activeAccounts', 'id', 'provider'])

/** Which check failed, for diagnostics. Never carries a value from the page. */
export type ConnectedContextPolicyCheck = 'read' | 'size' | 'frontmatter' | 'slug' | 'status' | 'json' | 'schema'
export type ConnectedContextPolicyState =
  | { kind: 'absent' }
  | { kind: 'unreadable'; check: ConnectedContextPolicyCheck; structuralKeys?: string[] }
  | { kind: 'readable'; policy: ConnectedContextPolicy }
type Unreadable = Extract<ConnectedContextPolicyState, { kind: 'unreadable' }>

// Controls are the first JSON line; source mappings follow in the same page.
// A compact legacy JSON object remains readable, including its source mappings.
function readLedgerBody(body: string): { policy: ConnectedContextPolicy; suffix: string } | Unreadable {
  const newline = body.indexOf('\n')
  const attempts: [string, string][] = newline < 0 ? [[body, '']] : [[body.slice(0, newline), body.slice(newline)], [body, '']]
  let schemaError: z.ZodError | null = null
  for (const [text, suffix] of attempts) {
    let value: unknown
    try { value = JSON.parse(text) } catch { continue }
    const parsed = policySchema.safeParse(value)
    if (parsed.success) return { policy: parsed.data, suffix }
    schemaError ??= parsed.error
  }
  if (!schemaError) return { kind: 'unreadable', check: 'json' }
  return { kind: 'unreadable', check: 'schema', structuralKeys: [...new Set(schemaError.issues.map(issue =>
    issue.path.filter((key): key is string => typeof key === 'string' && policyKeys.has(key)).join('.')).filter(Boolean))].sort() }
}

export function parseConnectedContextLedgerBody(body: string) {
  const parsed = readLedgerBody(body)
  if ('kind' in parsed) throw new Error(`Connected-context ledger failed its ${parsed.check} check.`)
  return parsed
}

export async function readConnectedContextPolicy(vaultRoot: string): Promise<ConnectedContextPolicy | null> {
  const result = await readConnectedContextPolicyState(vaultRoot)
  return result.kind === 'readable' ? result.policy : null
}

/** Only a missing page is absence; path, read, status and parse failures are unknown. */
export async function readConnectedContextPolicyState(vaultRoot: string): Promise<ConnectedContextPolicyState> {
  let page: { text: string; truncated: boolean }
  try {
    const filePath = await resolveAssistantVaultPath(vaultRoot, buildKnowledgePageRelativePath(CONNECTED_CONTEXT_LEDGER_SLUG), 'file path')
    const file = await open(filePath, 'r').catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    })
    if (file === null) return { kind: 'absent' }
    try {
      // One byte past the cap tells a cut-off page from one that fits.
      const buffer = Buffer.alloc(POLICY_MAX_BYTES + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      page = { text: buffer.subarray(0, Math.min(bytesRead, POLICY_MAX_BYTES)).toString('utf8'), truncated: bytesRead > POLICY_MAX_BYTES }
    } finally { await file.close() }
  } catch { return { kind: 'unreadable', check: 'read' } }
  const state = readLedgerPage(page.text)
  // Only parse checks can fail because the read stopped at the cap.
  const cutOff = state.kind === 'unreadable' && page.truncated && (state.check === 'frontmatter' || state.check === 'json')
  return cutOff ? { kind: 'unreadable', check: 'size' } : state
}

function readLedgerPage(markdown: string): ConnectedContextPolicyState {
  let document: ReturnType<typeof parseFrontmatterDocument>
  try { document = parseFrontmatterDocument(markdown) } catch { return { kind: 'unreadable', check: 'frontmatter' } }
  if (document.attributes.slug !== CONNECTED_CONTEXT_LEDGER_SLUG) return { kind: 'unreadable', check: 'slug' }
  if (document.attributes.status !== 'active') return { kind: 'unreadable', check: 'status' }
  const parsed = readLedgerBody(normalizeKnowledgeBody(document.body))
  return 'kind' in parsed ? parsed : { kind: 'readable', policy: parsed.policy }
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
