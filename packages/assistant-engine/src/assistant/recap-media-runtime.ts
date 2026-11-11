import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import { inspectRecapProviderRequest } from '@murphai/contracts/recap-admission'
import type { GeneratedMediaFileRuntime } from '../assistant-codex/generated-media-file.js'
import type { GenerateImageToolArgs } from '../assistant-codex/generate-image-tool.js'
import type { GenerateSongToolArgs } from '../assistant-codex/generate-voice-memo-tool.js'
import type { AssistantHostedExecutionContext, AssistantHostedGroupTool } from './execution-context.js'
import { fetchRecapReference, type materializeRecapWorkspace } from './recap-workspace.js'
import { saveRecapMediaFile } from './recap-files.js'

export const recapRunAdmissionSchema = z.object({ admitted: z.literal(true), runId: z.string().uuid(),
  deadline: z.isoDateTime({ offset: true }), token: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
export type RecapRunAdmission = z.infer<typeof recapRunAdmissionSchema>

/** Host-only: finish admission before enabling shell or provider tools. */
export async function admitRecapRun(context: AssistantHostedExecutionContext): Promise<RecapRunAdmission | null> {
  const scope = context.gameRecapScope
  if (!scope?.show) return null
  if (!context.groupTool) throw new Error('Recap control is unavailable.')
  const response = await context.groupTool.request({ action: 'read_game',
    origin: { kind: 'game_recap', gameId: scope.gameId, eventId: scope.eventId }, recapRead: { kind: 'admit', runId: randomUUID() } })
  if (response.result.status !== 'ok' || !('recapGame' in response.result)) throw new Error('Recap admission is unavailable.')
  const admission = recapRunAdmissionSchema.safeParse(response.result.recapGame)
  if (!admission.success) throw new Error('Recap agent attempts or deadline exhausted.')
  return admission.data
}

export async function finishRecapRun(context: AssistantHostedExecutionContext | null): Promise<void> {
  const admission = context?.gameRecapAdmission
  const scope = context?.gameRecapScope
  if (!admission || !scope || !context.groupTool) return
  await context.groupTool.request({ action: 'read_game', origin: { kind: 'game_recap', gameId: scope.gameId, eventId: scope.eventId },
    recapRead: { kind: 'end', runId: admission.runId, token: admission.token } })
}

export function createRecapMediaRuntime(input: {
  vault: string; workspace: Awaited<ReturnType<typeof materializeRecapWorkspace>>;
  scope: NonNullable<AssistantHostedExecutionContext['gameRecapScope']>;
  admission: RecapRunAdmission; tool: AssistantHostedGroupTool; fetchImpl: typeof fetch;
  request: { kind: 'image'; args: GenerateImageToolArgs } | { kind: 'song'; args: GenerateSongToolArgs };
}): GeneratedMediaFileRuntime {
  const operationId = input.request.args.operationId
  if (!operationId || !/^[a-zA-Z0-9_-]{1,80}$/u.test(operationId)) throw new TypeError('Use a stable operationId for file output.')
  if (input.request.kind === 'image' && (input.request.args.quality === 'high' || input.request.args.outputFormat !== 'jpeg')) throw new TypeError('Recap file images require low/medium quality and JPEG output.')
  if (input.request.kind === 'song' && input.request.args.durationSeconds !== 20) throw new TypeError('Recap songs are twenty seconds.')
  const origin = { kind: 'game_recap' as const, gameId: input.scope.gameId, eventId: input.scope.eventId }
  const referenceIds = input.request.kind === 'image' ? [...(input.request.args.referenceImageRefs ?? [])] : []
  if (referenceIds.length > 3 || new Set(referenceIds).size !== referenceIds.length) throw new TypeError('Use up to three distinct authorized reference IDs.')
  let token: string | null = null
  let finished = false
  const remaining = Date.parse(input.admission.deadline) - Date.now() - 30_000
  const signal = remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort(new Error('Recap generation deadline reached.'))
  return {
    signal,
    resolveReferences: async refs => {
      if (JSON.stringify(refs) !== JSON.stringify(referenceIds)) throw new Error('Reference request changed.')
      return Promise.all(referenceIds.map(async id => {
        const ref = await fetchRecapReference({ ...input.scope, id, material: input.workspace.material, tool: input.tool })
        return { bytes: ref.bytes, filename: `${id}.jpg`, mediaType: 'image/jpeg' as const,
          sha256: ref.hash, sourceRef: id, sourceRefSha256: createHash('sha256').update(id).digest('hex') }
      }))
    },
    fetchImpl: async (url, init) => {
      signal.throwIfAborted()
      if (token) throw new Error('This media request already used its reservation.')
      const request = new Request(url, init)
      const providerRequest = await inspectRecapProviderRequest(request.clone())
      if (providerRequest.kind !== input.request.kind) throw new Error('Wrong recap provider.')
      const response = await input.tool.request({ action: 'read_game', origin, recapRead: {
        kind: 'reserve', runId: input.admission.runId, operationId, providerRequest, referenceIds } })
      if (response.result.status !== 'ok' || !('recapGame' in response.result)) throw new Error('Recap reservation was rejected.')
      const reservation = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/u), deadline: z.string() }).strict().parse(response.result.recapGame)
      token = reservation.token
      request.headers.set('x-murph-recap-reservation', token)
      return input.fetchImpl(request, { signal: AbortSignal.any([request.signal, signal]) })
    },
    save: async (bytes, mediaType) => {
      if (!token) throw new Error('No recap reservation.')
      signal.throwIfAborted()
      const receipt = await saveRecapMediaFile({ vault: input.vault, relativeRoot: path.relative(input.vault, input.workspace.root), operationId, bytes, mediaType })
      const response = await input.tool.request({ action: 'read_game', origin, recapRead: { kind: 'finished', token, operationId, receipt } })
      if (response.result.status !== 'ok') throw new Error('Recap media receipt was rejected.')
      finished = true
      return receipt
    },
    finish: async () => {
      if (!token || finished) return
      // Uncertain results retain their spent reservation. Only release concurrency.
      await input.tool.request({ action: 'read_game', origin, recapRead: { kind: 'finished', token, operationId } }).catch(() => {})
    },
  }
}
