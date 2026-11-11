import * as z from '@murphai/contracts/zod-runtime'

export const recapUsageSchema = z.object({ generationId: z.string().min(1).max(128), treatment: z.string().min(1).max(60), chatLine: z.string().max(160) }).strict()
export type RecapUsage = z.infer<typeof recapUsageSchema>
const PREFIX = 'Recap usage: '
const LIMIT = 64 * 1024
export function readRecapUsages(content: string): RecapUsage[] {
  return content.split(/\r?\n/u).flatMap(line => {
    if (!line.startsWith(PREFIX)) return []
    try { const parsed = recapUsageSchema.safeParse(JSON.parse(line.slice(PREFIX.length))); return parsed.success ? [parsed.data] : [] } catch { return [] }
  })
}
/** The model may replace narrative, never the trusted accepted-generation markers. */
export function replaceRecapNarrative(existing: string, narrative: string): string {
  const markers = existing.split(/\r?\n/u).filter(line => line.startsWith(PREFIX))
  const lines = narrative.split(/\r?\n/u).filter(line => !line.startsWith(PREFIX))
  let content = [...lines, ...markers].join('\n')
  while (Buffer.byteLength(content, 'utf8') > LIMIT && lines.length) { lines.shift(); content = [...lines, ...markers].join('\n') }
  if (Buffer.byteLength(content, 'utf8') > LIMIT) throw new Error('Recap usage history is full.')
  return content
}
export function appendRecapUsage(existing: string, usage: RecapUsage): string {
  const accepted = recapUsageSchema.parse(usage)
  if (readRecapUsages(existing).some(item => item.generationId === accepted.generationId)) return existing
  const marker = PREFIX + JSON.stringify(accepted)
  return replaceRecapNarrative(`${existing}\n${marker}`, existing)
}
