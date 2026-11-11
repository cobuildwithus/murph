import * as z from './zod-runtime.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
export const RECAP_REFERENCE_MAX_EDGE = 1024
export const RECAP_REFERENCE_MAX_COUNT = 3
export const RECAP_IMAGE_PROMPT_MAX_BYTES = 16_384
// Conservative reservation estimate using the documented legacy high-fidelity
// envelope: 65 base + 129 per 512px tile + the larger 6240 fidelity surcharge.
// Deliberately omit its additional shortest-side downscale. Flare does not
// publish a dimension-to-input-token rule; this is not a guaranteed Flare cap.
// https://developers.openai.com/api/docs/guides/images-vision#gpt-image-model-inputs
export const RECAP_REFERENCE_INPUT_TOKEN_ESTIMATE = 65 + 129 * Math.ceil(RECAP_REFERENCE_MAX_EDGE / 512) ** 2 + 6240
export const RECAP_IMAGE_INPUT_TOKEN_CEILING = RECAP_IMAGE_PROMPT_MAX_BYTES + RECAP_REFERENCE_MAX_COUNT * RECAP_REFERENCE_INPUT_TOKEN_ESTIMATE
export const recapProviderRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), model: z.literal('gpt-image-2.6-flare'), requestHash: hash,
    promptBytes: z.number().int().min(1).max(RECAP_IMAGE_PROMPT_MAX_BYTES), size: z.enum(['1024x1024', '1024x1536', '1536x1024']),
    quality: z.enum(['low', 'medium', 'high']), outputFormat: z.literal('jpeg'), referenceHashes: z.array(hash).max(RECAP_REFERENCE_MAX_COUNT) }).strict(),
  z.object({ kind: z.literal('song'), model: z.literal('music_v2'), requestHash: hash,
    promptBytes: z.number().int().min(1).max(16_400), durationMs: z.literal(20_000) }).strict(),
])
/** Signed Worker callback, decoded by Web and exercised at the egress boundary. */
export const recapMediaAccessRequestSchema = z.object({
  attemptId: z.string().min(1).max(191), generation: z.string().regex(/^\d+$/u),
  token: hash.nullable(), providerRequest: recapProviderRequestSchema.nullable(),
  opaque: z.boolean(), nativeImage: z.boolean(),
}).strict()
export type RecapMediaAccessRequest = z.infer<typeof recapMediaAccessRequestSchema>
export type RecapProviderRequest = z.infer<typeof recapProviderRequestSchema>
export const RECAP_IMAGE_ATTEMPTS = 6
export const RECAP_MEDIA_CAP_MICRODOLLARS = 3_000_000
export const RECAP_DEADLINE_MS = 20 * 60_000
export const RECAP_FINALIZATION_MS = 30_000
export const RECAP_MEDIA_PRICING_VERSION = '2026-11-11-flare-2.6-music-v2'

/** Text is bounded by UTF-8 bytes. Reference inputs use the conservative default
 * above unless the operator provides a verified total input-token override.
 * Output: official GPT-Image-2.6 calculator, explicit low/medium/high sizes only.
 * https://developers.openai.com/api/docs/guides/image-generation#calculating-costs
 */
export function recapReservationMicrodollars(request: RecapProviderRequest, inputTokenCeilingOverride?: number | null): number | null {
  if (request.kind === 'song') return 50_000 // Existing music-generation rate: $0.15/minute.
  const [width, height] = request.size.split('x').map(Number) as [number, number]
  const longAxis = { low: 16, medium: 24, high: 48 }[request.quality]
  // Allowed aspect ratios produce an integer short axis (square or 3:2).
  const shortAxis = longAxis * Math.min(width, height) / Math.max(width, height)
  const outputTokens = Math.ceil(Math.ceil(longAxis * shortAxis * (2_000_000 + width * height) / 4_000_000) * { low: 4.2, medium: 3.3, high: 1 }[request.quality])
  if (!request.referenceHashes.length) return request.promptBytes * 5 + outputTokens * 30
  const inputTokenCeiling = inputTokenCeilingOverride ?? RECAP_IMAGE_INPUT_TOKEN_CEILING
  if (!Number.isSafeInteger(inputTokenCeiling) || inputTokenCeiling < request.promptBytes) return null
  // Charge every input token at the higher uncached image rate.
  return inputTokenCeiling * 8 + outputTokens * 30
}

export type RecapAdmissionState = {
  v: 1; deadline: string; runs: string[];
  operations: { id: string; kind: 'image' | 'song'; requestHash: string; reserved: number; active: boolean; consumed: boolean }[];
}
export function reserveRecapOperation(state: RecapAdmissionState, input: {
  id: string; runId: string; request: RecapProviderRequest; reserved: number | null; now: Date;
}): RecapAdmissionState {
  if (!state.runs.includes(input.runId) || input.now.getTime() >= Date.parse(state.deadline) - RECAP_FINALIZATION_MS) throw new Error('Recap generation deadline reached.')
  const prior = state.operations.find(operation => operation.id === input.id)
  if (prior) throw new Error('This operation was already attempted; use its existing file or omit it.')
  if (input.reserved === null || !Number.isSafeInteger(input.reserved) || input.reserved < 0) throw new Error('Provider cost cannot be bounded for this request.')
  if (state.operations.filter(operation => operation.kind === input.request.kind).length >= (input.request.kind === 'image' ? RECAP_IMAGE_ATTEMPTS : 1)) throw new Error('Recap media attempt limit reached.')
  if (input.request.kind === 'image' && state.operations.filter(operation => operation.kind === 'image' && operation.active).length >= 2) throw new Error('Two recap images are already in progress.')
  if (state.operations.reduce((sum, operation) => sum + operation.reserved, 0) + input.reserved > RECAP_MEDIA_CAP_MICRODOLLARS) throw new Error('Recap media budget exhausted.')
  return { ...state, operations: [...state.operations, { id: input.id, kind: input.request.kind,
    requestHash: input.request.requestHash, reserved: input.reserved, active: true, consumed: false }] }
}

const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, '0')).join('')

/** Both the tool host and outbound Worker inspect the actual final request.
 * Unknown fields are denied rather than silently excluding billable options.
 */
export async function inspectRecapProviderRequest(request: Pick<Request, 'url' | 'method' | 'headers' | 'formData' | 'json'>): Promise<RecapProviderRequest> {
  const url = new URL(request.url)
  const endpoint = url.pathname.slice(url.pathname.lastIndexOf('/v1/'))
  if (request.method !== 'POST') throw new TypeError('Recap media requires POST.')
  const { fields, references } = await readRecapRequestFields(request)
  const prompt = fields.prompt
  if (typeof prompt !== 'string') throw new TypeError('Missing recap prompt.')
  const promptBytes = new TextEncoder().encode(prompt).length
  if (endpoint === '/v1/images/generations' || endpoint === '/v1/images/edits') {
    const allowed = ['model', 'prompt', 'size', 'quality', 'output_format']
    if (Object.keys(fields).some(key => !allowed.includes(key)) || url.search) throw new TypeError('Unsupported recap image settings.')
    const canonical = [fields.model, prompt, fields.size, fields.quality, fields.output_format, references]
    return recapProviderRequestSchema.parse({ kind: 'image', model: fields.model, promptBytes,
      size: fields.size, quality: fields.quality, outputFormat: fields.output_format, referenceHashes: references,
      requestHash: await digest(new TextEncoder().encode(JSON.stringify(canonical))) })
  }
  if (endpoint === '/v1/music') {
    const allowed = ['model_id', 'prompt', 'music_length_ms', 'force_instrumental']
    if (Object.keys(fields).some(key => !allowed.includes(key)) || url.search !== '?output_format=mp3_48000_192'
      || typeof fields.force_instrumental !== 'boolean') throw new TypeError('Unsupported recap song settings.')
    return recapProviderRequestSchema.parse({ kind: 'song', model: fields.model_id, promptBytes, durationMs: fields.music_length_ms,
      requestHash: await digest(new TextEncoder().encode(JSON.stringify([fields.model_id, prompt, fields.music_length_ms, fields.force_instrumental, url.search]))) })
  }
  throw new TypeError('Unsupported recap provider endpoint.')
}

async function readRecapRequestFields(request: Pick<Request, 'headers' | 'formData' | 'json'>) {
  let fields: Record<string, unknown>
  const references: string[] = []
  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    fields = {}
    const form = await request.formData()
    for (const [key, value] of form.entries()) {
      if (key === 'image[]' || key === 'image') {
        if (typeof value === 'string' || value.size > 2 * 1024 * 1024 || references.length >= RECAP_REFERENCE_MAX_COUNT) throw new TypeError('Invalid recap photo input.')
        references.push(await digest(new Uint8Array(await value.arrayBuffer())))
      } else {
        if (typeof value !== 'string' || key in fields) throw new TypeError('Invalid recap media field.')
        fields[key] = value
      }
    }
  } else {
    const raw: unknown = await request.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid recap media request.')
    fields = raw as Record<string, unknown>
  }
  return { fields, references }
}
