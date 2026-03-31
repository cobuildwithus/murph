import { VaultCliError } from '@murph/assistant-core/vault-cli-errors'
import { toVaultCliError } from '../usecases/vault-usecase-helpers.js'
import type {
  InboxAppEnvironment,
  InboxServices,
} from './types.js'
import {
  documentCanonicalPromotionSpec,
  mealCanonicalPromotionSpec,
  persistPromotionEntry,
  promoteCanonicalAttachmentImport,
  readExperimentPromotionEntries,
  requireExperimentPromotionCore,
  requireExperimentPromotionEntry,
  requireJournalPromotionCore,
  resolveAttachmentSha256,
  resolveExperimentPromotionTarget,
  resolvePromotionAttachmentFilePath,
  withPromotionScope,
} from '@murph/assistant-core/inbox-services/promotions'
import {
  isStoredAudioAttachment,
  isStoredDocumentAttachment,
  isStoredImageAttachment,
} from '@murph/assistant-core/inbox-services/query'
import { occurredDayFromCapture } from '@murph/assistant-core/inbox-services/shared'

function unsupportedPromotion(target: 'journal' | 'experiment-note'): VaultCliError {
  return new VaultCliError(
    'INBOX_PROMOTION_UNSUPPORTED',
    `Canonical ${target} promotion is not available yet through a safe shared runtime boundary.`,
  )
}

export function createInboxPromotionOps(
  env: InboxAppEnvironment,
): Pick<
  InboxServices,
  'promoteMeal' | 'promoteDocument' | 'promoteJournal' | 'promoteExperimentNote'
> {
  return {
    async promoteMeal(input) {
      return promoteCanonicalAttachmentImport({
        input,
        target: 'meal',
        clock: env.clock,
        loadInbox: env.loadInbox,
        prepare: async () => ({
          core: await env.loadCore(),
        }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(isStoredImageAttachment),
        missingAttachmentError: () =>
          new VaultCliError(
            'INBOX_PROMOTION_REQUIRES_PHOTO',
            'Meal promotion requires an image attachment on the inbox capture.',
          ),
        canonicalPromotionSpec: mealCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({
          paths,
          capture,
          attachment,
        }) => {
          const audioAttachment = capture.attachments.find(isStoredAudioAttachment)
          return {
            photoSha256: await resolveAttachmentSha256(
              paths.absoluteVaultRoot,
              capture,
              attachment,
            ),
            audioSha256:
              audioAttachment && typeof audioAttachment.storedPath === 'string'
                ? await resolveAttachmentSha256(
                    paths.absoluteVaultRoot,
                    capture,
                    audioAttachment,
                  )
                : null,
          }
        },
        createPromotion: async ({ paths, capture, prepared, attachment }) => {
          const audioAttachment = capture.attachments.find(isStoredAudioAttachment)
          const result = await prepared.core.addMeal({
            vaultRoot: paths.absoluteVaultRoot,
            occurredAt: capture.occurredAt,
            note: capture.text ?? undefined,
            photoPath: await resolvePromotionAttachmentFilePath(
              paths.absoluteVaultRoot,
              capture,
              attachment,
            ),
            audioPath:
              typeof audioAttachment?.storedPath === 'string'
                ? await resolvePromotionAttachmentFilePath(
                    paths.absoluteVaultRoot,
                    capture,
                    audioAttachment,
                  )
                : undefined,
            source: 'import',
          })

          return {
            lookupId: result.event.id,
            relatedId: result.mealId,
          }
        },
      })
    },

    async promoteDocument(input) {
      return promoteCanonicalAttachmentImport({
        input,
        target: 'document',
        clock: env.clock,
        loadInbox: env.loadInbox,
        prepare: async () => ({
          importers: (await env.loadImporters()).createImporters(),
        }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(isStoredDocumentAttachment),
        missingAttachmentError: () =>
          new VaultCliError(
            'INBOX_PROMOTION_REQUIRES_DOCUMENT',
            'Document promotion requires a stored document attachment on the inbox capture.',
          ),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({
          paths,
          capture,
          attachment,
        }) => {
          return {
            documentSha256: await resolveAttachmentSha256(
              paths.absoluteVaultRoot,
              capture,
              attachment,
            ),
            title:
              typeof attachment.fileName === 'string' && attachment.fileName.trim()
                ? attachment.fileName.trim()
                : null,
          }
        },
        createPromotion: async ({ paths, capture, prepared, attachment }) => {
          const title =
            typeof attachment.fileName === 'string' && attachment.fileName.trim()
              ? attachment.fileName.trim()
              : undefined
          const note =
            typeof capture.text === 'string' && capture.text.trim()
              ? capture.text.trim()
              : undefined
          const result = await prepared.importers.importDocument({
            filePath: await resolvePromotionAttachmentFilePath(
              paths.absoluteVaultRoot,
              capture,
              attachment,
            ),
            vaultRoot: paths.absoluteVaultRoot,
            occurredAt: capture.occurredAt,
            title,
            note,
            source: 'import',
          })

          return {
            lookupId: result.event.id,
            relatedId: result.documentId,
          }
        },
      })
    },

    async promoteJournal(input) {
      if (!env.journalPromotionEnabled) {
        throw unsupportedPromotion('journal')
      }

      return withPromotionScope({
        input,
        target: 'journal',
        loadInbox: env.loadInbox,
        prepare: async () => ({
          core: requireJournalPromotionCore(await env.loadCore()),
        }),
        deriveBeforePromotionStore: ({ capture }) => {
          const journalDate = occurredDayFromCapture(capture)

          return {
            journalDate,
            lookupId: `journal:${journalDate}`,
          }
        },
        run: async ({
          paths,
          capture,
          prepared,
          derived,
          promotionStore,
          existing,
        }) => {
          if (
            existing &&
            ((existing.lookupId && existing.lookupId !== derived.lookupId) ||
              (existing.relatedId && existing.relatedId !== capture.eventId))
          ) {
            throw new VaultCliError(
              'INBOX_PROMOTION_STATE_INVALID',
              'Local journal promotion state does not match the deterministic canonical journal target.',
            )
          }

          let result: Awaited<ReturnType<typeof prepared.core.promoteInboxJournal>>
          try {
            result = await prepared.core.promoteInboxJournal({
              vaultRoot: paths.absoluteVaultRoot,
              date: derived.journalDate,
              capture,
            })
          } catch (error) {
            throw toVaultCliError(error)
          }

          await persistPromotionEntry({
            paths,
            promotionStore,
            captureId: input.captureId,
            target: 'journal',
            lookupId: derived.lookupId,
            promotedAt: env.clock().toISOString(),
            relatedId: capture.eventId,
            note: capture.text ?? null,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: input.captureId,
            target: 'journal',
            lookupId: derived.lookupId,
            relatedId: capture.eventId,
            journalPath: result.journalPath,
            created: result.created,
            appended: result.appended,
            linked: result.linked,
          }
        },
      })
    },

    async promoteExperimentNote(input) {
      return withPromotionScope({
        input,
        target: 'experiment-note',
        loadInbox: env.loadInbox,
        prepare: async () => ({
          core: requireExperimentPromotionCore(await env.loadCore()),
          query: await env.loadQuery(),
        }),
        deriveBeforePromotionStore: () => undefined,
        run: async ({
          paths,
          capture,
          prepared,
          promotionStore,
          existing,
        }) => {
          const experimentEntries = await readExperimentPromotionEntries(
            paths.absoluteVaultRoot,
            prepared.query,
          )
          const target = existing
            ? requireExperimentPromotionEntry(
                experimentEntries,
                existing.lookupId,
                existing.relatedId,
                capture,
              )
            : resolveExperimentPromotionTarget(experimentEntries)

          let result: Awaited<ReturnType<typeof prepared.core.promoteInboxExperimentNote>>
          try {
            result = await prepared.core.promoteInboxExperimentNote({
              vaultRoot: paths.absoluteVaultRoot,
              relativePath: target.relativePath,
              capture,
            })
          } catch (error) {
            throw toVaultCliError(error)
          }

          await persistPromotionEntry({
            paths,
            promotionStore,
            captureId: input.captureId,
            target: 'experiment-note',
            lookupId: result.experimentId,
            promotedAt: env.clock().toISOString(),
            relatedId: capture.eventId,
            note: capture.text ?? null,
          })

          return {
            vault: paths.absoluteVaultRoot,
            captureId: input.captureId,
            target: 'experiment-note',
            lookupId: result.experimentId,
            relatedId: capture.eventId,
            experimentPath: result.experimentPath,
            experimentSlug: result.experimentSlug,
            appended: result.appended,
          }
        },
      })
    },
  }
}
