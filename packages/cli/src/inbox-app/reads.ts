import { VaultCliError } from '../vault-cli-errors.js'
import type {
  InboxAppEnvironment,
  InboxCliServices,
  InboxPaths,
  RuntimeStore,
} from './types.js'
import {
  buildAttachmentParseStatus,
  createParserServiceContext,
  isParseableAttachment,
  requireAttachmentParseJobs,
  requireAttachmentReparseSupport,
  summarizeParserDrain,
} from '../inbox-services/parser.js'
import {
  detailCapture,
  requireAttachmentRecord,
  requireCapture,
  resolveSourceFilter,
  summarizeCapture,
  toCliAttachment,
} from '../inbox-services/query.js'
import {
  readPromotionsByCapture,
} from '../inbox-services/promotions.js'
import {
  readConfig,
  withInitializedInboxRuntime,
} from '../inbox-services/state.js'
import {
  normalizeLimit,
} from '../inbox-services/shared.js'

export function createInboxReadOps(
  env: InboxAppEnvironment,
): Pick<
  InboxCliServices,
  | 'list'
  | 'listAttachments'
  | 'showAttachment'
  | 'showAttachmentStatus'
  | 'parseAttachment'
  | 'reparseAttachment'
  | 'show'
  | 'search'
> {
  const withInboxRuntime = async <TResult>(
    input: { vault: string },
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInitializedInboxRuntime(env.loadInbox, input.vault, fn)

  const withInboxRuntimePromotions = async <TResult>(
    input: { vault: string },
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
      promotionsByCapture: Awaited<ReturnType<typeof readPromotionsByCapture>>
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInboxRuntime(input, async ({ paths, runtime }) =>
      fn({
        paths,
        runtime,
        promotionsByCapture: await readPromotionsByCapture(paths),
      }),
    )

  const withInboxRuntimeConfigPromotions = async <TResult>(
    input: { vault: string },
    fn: (input: {
      paths: InboxPaths
      runtime: RuntimeStore
      config: Awaited<ReturnType<typeof readConfig>>
      promotionsByCapture: Awaited<ReturnType<typeof readPromotionsByCapture>>
    }) => Promise<TResult>,
  ): Promise<TResult> =>
    withInboxRuntime(input, async ({ paths, runtime }) => {
      const [config, promotionsByCapture] = await Promise.all([
        readConfig(paths),
        readPromotionsByCapture(paths),
      ])

      return fn({
        paths,
        runtime,
        config,
        promotionsByCapture,
      })
    })

  const requireInboxAttachmentMatch = (
    runtime: RuntimeStore,
    attachmentId: string,
  ) => requireAttachmentRecord(runtime, attachmentId)

  const requireParseableInboxAttachmentMatch = (
    runtime: RuntimeStore,
    attachmentId: string,
  ) => {
    const match = requireInboxAttachmentMatch(runtime, attachmentId)
    if (!isParseableAttachment(match.attachment)) {
      throw new VaultCliError(
        'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
        `Attachment "${attachmentId}" is not supported by the current runtime parse queue.`,
      )
    }

    return match
  }

  const buildInboxAttachmentStatus = (input: {
    runtime: RuntimeStore
    attachmentId: string
    listAttachmentParseJobs: NonNullable<RuntimeStore['listAttachmentParseJobs']>
    match: ReturnType<typeof requireInboxAttachmentMatch>
  }) =>
    buildAttachmentParseStatus({
      runtime: input.runtime,
      listAttachmentParseJobs: input.listAttachmentParseJobs,
      captureId: input.match.capture.captureId,
      attachmentId: input.attachmentId,
      fallbackAttachment: input.match.attachment,
    })

  return {
    async list(input) {
      return withInboxRuntimeConfigPromotions(
        input,
        async ({ paths, runtime, config, promotionsByCapture }) => {
          const sourceFilter = resolveSourceFilter(config, input.sourceId ?? null)
          const limit = normalizeLimit(input.limit, 50, 200)
          const afterOccurredAt = input.afterOccurredAt?.trim() || null
          const afterCaptureId = input.afterCaptureId?.trim() || null
          const oldestFirst = input.oldestFirst ?? false
          const items = runtime.listCaptures({
            source: sourceFilter?.source,
            accountId: sourceFilter?.accountId,
            limit,
            afterOccurredAt,
            afterCaptureId,
            oldestFirst,
          })

          return {
            vault: paths.absoluteVaultRoot,
            filters: {
              sourceId: input.sourceId ?? null,
              limit,
              afterOccurredAt,
              afterCaptureId,
              oldestFirst,
            },
            items: items.map((capture) =>
              summarizeCapture(capture, promotionsByCapture.get(capture.captureId) ?? []),
            ),
          }
        },
      )
    },

    async listAttachments(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const capture = requireCapture(runtime, input.captureId)
        return {
          vault: paths.absoluteVaultRoot,
          captureId: capture.captureId,
          attachmentCount: capture.attachments.length,
          attachments: capture.attachments.map(toCliAttachment),
        }
      })
    },

    async showAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const match = requireInboxAttachmentMatch(runtime, input.attachmentId)
        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachment: toCliAttachment(match.attachment),
        }
      })
    },

    async showAttachmentStatus(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const match = requireInboxAttachmentMatch(runtime, input.attachmentId)
        const listAttachmentParseJobs = requireAttachmentParseJobs(
          runtime,
          'show status',
        )
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: isParseableAttachment(match.attachment),
          ...status,
        }
      })
    },

    async parseAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const listAttachmentParseJobs = requireAttachmentParseJobs(runtime, 'parse')
        const match = requireParseableInboxAttachmentMatch(
          runtime,
          input.attachmentId,
        )

        const parserService = await createParserServiceContext(
          paths.absoluteVaultRoot,
          runtime,
          await env.requireParsers('attachment-level inbox parser drains'),
        )
        const results = await parserService.drain({
          attachmentId: input.attachmentId,
          maxJobs: 1,
        })
        const summary = summarizeParserDrain(paths.absoluteVaultRoot, results)
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: true,
          attempted: summary.attempted,
          succeeded: summary.succeeded,
          failed: summary.failed,
          ...status,
          results: summary.results,
        }
      })
    },

    async reparseAttachment(input) {
      return withInboxRuntime(input, async ({ paths, runtime }) => {
        const {
          listAttachmentParseJobs,
          requeueAttachmentParseJobs,
        } = requireAttachmentReparseSupport(runtime)
        const match = requireParseableInboxAttachmentMatch(
          runtime,
          input.attachmentId,
        )

        const existingJobs = listAttachmentParseJobs({
          attachmentId: input.attachmentId,
          limit: 20,
        })
        if (existingJobs.length === 0) {
          throw new VaultCliError(
            'INBOX_ATTACHMENT_PARSE_MISSING',
            `Attachment "${input.attachmentId}" does not have a runtime parse job to requeue.`,
          )
        }

        const requeuedJobs = requeueAttachmentParseJobs({
          attachmentId: input.attachmentId,
        })
        const status = buildInboxAttachmentStatus({
          runtime,
          attachmentId: input.attachmentId,
          listAttachmentParseJobs,
          match,
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: match.capture.captureId,
          attachmentId: input.attachmentId,
          parseable: true,
          requeuedJobs,
          ...status,
        }
      })
    },

    async show(input) {
      return withInboxRuntimePromotions(
        input,
        async ({ paths, runtime, promotionsByCapture }) => {
          const capture = requireCapture(runtime, input.captureId)
          return {
            vault: paths.absoluteVaultRoot,
            capture: detailCapture(
              capture,
              promotionsByCapture.get(capture.captureId) ?? [],
            ),
          }
        },
      )
    },

    async search(input) {
      return withInboxRuntimeConfigPromotions(
        input,
        async ({ paths, runtime, config, promotionsByCapture }) => {
          const sourceFilter = resolveSourceFilter(config, input.sourceId ?? null)
          const limit = normalizeLimit(input.limit, 20, 200)
          const hits = runtime.searchCaptures({
            text: input.text,
            source: sourceFilter?.source,
            accountId: sourceFilter?.accountId,
            limit,
          })

          return {
            vault: paths.absoluteVaultRoot,
            filters: {
              text: input.text,
              sourceId: input.sourceId ?? null,
              limit,
            },
            hits: hits.map((hit) => ({
              captureId: hit.captureId,
              source: hit.source,
              accountId: hit.accountId ?? null,
              threadId: hit.threadId,
              threadTitle: hit.threadTitle ?? null,
              occurredAt: hit.occurredAt,
              text: hit.text,
              snippet: hit.snippet,
              score: hit.score,
              envelopePath: hit.envelopePath,
              promotions: promotionsByCapture.get(hit.captureId) ?? [],
            })),
          }
        },
      )
    },
  }
}
