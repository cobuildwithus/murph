import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import {
  VAULT_LAYOUT,
  memoryDocumentRelativePath,
} from '@murphai/contracts'
import {
  AUTOMATION_REGISTRY_RESOURCE,
  archiveAutomationIfExactRevision,
  canonicalPathResource,
  forgetMemoryIfExactMatch,
  loadVault,
  readMemoryDocument,
  withCanonicalResourceLocks,
} from '@murphai/core'
import type {
  AssistantOutboxIntent,
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_LOG_PATH,
  showAutomation,
} from '@murphai/query'

import { buildKnowledgePageRelativePath } from '../../knowledge/documents.js'
import {
  appendActiveChallengePageSection,
  archiveKnowledgeChallenge,
  getKnowledgePage,
} from '../../knowledge/service.js'
import {
  resolveAssistantCronResolvedSchedule,
} from './canonical-jobs.js'
import { computeAssistantCronNextRunAt } from './schedule.js'

const GROUP_CHALLENGE_POINTER_SECTION = 'Context' as const
const GROUP_CHALLENGE_DELIVERY_HEADING_PREFIX = 'Delivered dispatch '

export interface AssistantGroupChallengeDeliveryCommitResult {
  closeoutApplied: boolean
  dispatchRecord: 'not_recorded' | 'recorded' | 'reused'
  pointerRecordsRemoved: number
}

/**
 * Promote one terminally-sent group challenge intent into its canonical page.
 * The outbox remains the exact delivery evidence. The page receives the
 * model-authored private run record, exact accepted text, and locator-free
 * media descriptors so future scheduled turns never receive provider ids,
 * attachment ids, URLs, hashes, or vault paths.
 */
export async function commitAssistantGroupChallengeSentDelivery(input: {
  dependencies?: {
    archiveAutomation?: typeof archiveAutomationIfExactRevision
    archiveChallenge?: typeof archiveKnowledgeChallenge
  }
  expectedAutomationId: string
  intent: AssistantOutboxIntent
  pendingOccurrenceAt: string
  vault: string
}): Promise<AssistantGroupChallengeDeliveryCommitResult> {
  const dispatch = input.intent.groupChallengeDispatch
  const automationAuthority = input.intent.automationAuthority
  if (
    input.intent.status !== 'sent' ||
    input.intent.sentAt === null ||
    !dispatch ||
    !automationAuthority ||
    automationAuthority.automationId !== input.expectedAutomationId ||
    dispatch.scheduledTask.kind !== 'group_challenge' ||
    dispatch.occurrenceAt !== input.pendingOccurrenceAt
  ) {
    throw new VaultCliError(
      'scheduled_challenge_delivery_commit_invalid',
      'The terminal group-challenge delivery does not match its pending occurrence authority.',
    )
  }

  const heading = `${GROUP_CHALLENGE_DELIVERY_HEADING_PREFIX}${dispatch.occurrenceAt}`
  const section = buildAssistantGroupChallengeDeliveredSection(input.intent)
  const slug = dispatch.scheduledTask.knowledgeSlug
  return await withCanonicalResourceLocks({
    vaultRoot: input.vault,
    resources: [
      AUTOMATION_REGISTRY_RESOURCE,
      canonicalPathResource(memoryDocumentRelativePath),
      canonicalPathResource(VAULT_LAYOUT.metadata),
      canonicalPathResource(buildKnowledgePageRelativePath(slug)),
      canonicalPathResource(DERIVED_KNOWLEDGE_INDEX_PATH),
      canonicalPathResource(DERIVED_KNOWLEDGE_LOG_PATH),
    ],
    run: async () => {
      const current = await showAutomation(
        input.vault,
        automationAuthority.automationId,
      )
      if (
        !current ||
        (current.status !== 'active' && current.status !== 'archived') ||
        current.continuityPolicy !== 'preserve' ||
        current.schedule.kind === 'deviceActivity' ||
        current.route.threadIsDirect !== false ||
        current.activeUntil === null ||
        !Number.isFinite(Date.parse(current.activeUntil)) ||
        !isDeepStrictEqual(current.scheduledTask, dispatch.scheduledTask)
      ) {
        return {
          closeoutApplied: false,
          dispatchRecord: 'not_recorded',
          pointerRecordsRemoved: 0,
        }
      }

      let page: Awaited<ReturnType<typeof getKnowledgePage>>['page']
      try {
        page = (await getKnowledgePage({ slug, vault: input.vault })).page
        assertGroupChallengePage(page.pageType, page.status)
      } catch (error) {
        if (
          error instanceof VaultCliError &&
          (
            error.code === 'knowledge_page_not_found' ||
            error.code === 'scheduled_challenge_not_active'
          )
        ) {
          return {
            closeoutApplied: false,
            dispatchRecord: 'not_recorded',
            pointerRecordsRemoved: 0,
          }
        }
        throw error
      }
      const exactDispatchRecorded = challengePageHasExactDeliveryCommit({
        body: page.body,
        commitMarker: section.commitMarker,
        heading,
      })
      let dispatchRecord: AssistantGroupChallengeDeliveryCommitResult['dispatchRecord'] =
        exactDispatchRecorded ? 'reused' : 'not_recorded'

      if (current.status === 'archived') {
        const pointerRecords = await readAssistantGroupChallengePointerRecords({
          slug,
          vault: input.vault,
        })
        return {
          closeoutApplied:
            exactDispatchRecorded &&
            page.status === 'archived' &&
            pointerRecords.length === 0,
          dispatchRecord,
          pointerRecordsRemoved: 0,
        }
      }

      if (current.updatedAt !== automationAuthority.expectedUpdatedAt) {
        return {
          closeoutApplied: false,
          dispatchRecord,
          pointerRecordsRemoved: 0,
        }
      }

      if (!exactDispatchRecorded) {
        if (page.status !== 'active') {
          return {
            closeoutApplied: false,
            dispatchRecord,
            pointerRecordsRemoved: 0,
          }
        }
        dispatchRecord = await appendOrReuseAssistantGroupChallengeDelivery({
          body: section.body,
          commitMarker: section.commitMarker,
          heading,
          slug,
          vault: input.vault,
        })
      }

      const { metadata } = await loadVault({ vaultRoot: input.vault })
      const nextOccurrenceAt = computeAssistantCronNextRunAt(
        resolveAssistantCronResolvedSchedule({
          schedule: current.schedule,
          timeZone: metadata.timezone,
        }),
        new Date(dispatch.occurrenceAt),
      )
      if (
        nextOccurrenceAt !== null &&
        Date.parse(nextOccurrenceAt) < Date.parse(current.activeUntil)
      ) {
        return {
          closeoutApplied: false,
          dispatchRecord,
          pointerRecordsRemoved: 0,
        }
      }

      // The page is the effect gate checked before provider, media, and
      // delivery work. Archive it first so an interrupted close-out fails
      // closed while the exact active source remains replay authority.
      await (input.dependencies?.archiveChallenge ?? archiveKnowledgeChallenge)({
        slug,
        vault: input.vault,
      })

      const pointerText = buildAssistantGroupChallengePointerText(slug)
      const pointerRecords = await readAssistantGroupChallengePointerRecords({
        slug,
        vault: input.vault,
      })
      let pointerRecordsRemoved = 0
      for (const pointer of pointerRecords) {
        const forgotten = await forgetMemoryIfExactMatch(input.vault, {
          recordId: pointer.id,
          section: GROUP_CHALLENGE_POINTER_SECTION,
          text: pointerText,
        })
        if (forgotten.reason === 'mismatch') {
          throw new VaultCliError(
            'scheduled_challenge_pointer_changed',
            'The active challenge pointer changed during terminal close-out.',
          )
        }
        if (forgotten.forgotten) {
          pointerRecordsRemoved += 1
        }
      }

      const archived = await (
        input.dependencies?.archiveAutomation ?? archiveAutomationIfExactRevision
      )({
        expectedUpdatedAt: automationAuthority.expectedUpdatedAt,
        lookup: current.automationId,
        vaultRoot: input.vault,
      })
      if (!archived.archived) {
        throw new VaultCliError(
          'scheduled_challenge_source_changed',
          'The group-challenge automation changed during terminal close-out.',
        )
      }

      return {
        closeoutApplied: true,
        dispatchRecord,
        pointerRecordsRemoved,
      }
    },
  })
}

async function readAssistantGroupChallengePointerRecords(input: {
  slug: string
  vault: string
}) {
  const pointerText = buildAssistantGroupChallengePointerText(input.slug)
  const memory = await readMemoryDocument(input.vault)
  return memory.records.filter((record) =>
    record.section === GROUP_CHALLENGE_POINTER_SECTION &&
    record.text === pointerText,
  )
}

export function buildAssistantGroupChallengePointerText(slug: string): string {
  return `active challenge: ${slug}; read that knowledge page before any challenge action`
}

function buildAssistantGroupChallengeDeliveredSection(
  intent: AssistantOutboxIntent,
): { body: string; commitMarker: string } {
  const dispatch = intent.groupChallengeDispatch
  if (!dispatch) {
    throw new VaultCliError(
      'scheduled_challenge_delivery_commit_invalid',
      'The terminal delivery has no group-challenge run record.',
    )
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      automationAuthority: intent.automationAuthority ?? null,
      dispatch,
      media: intent.media,
      message: intent.message,
    }))
    .digest('hex')
  const commitMarker = `Delivery commit: \`sha256:${fingerprint}\``
  const acceptedDelivery = JSON.stringify({
    media: intent.media.map(toSafeGroupChallengeMediaDescriptor),
    message: intent.message,
  }, null, 2)

  return {
    body: [
      '### Prepared run record',
      renderAssistantGroupChallengePreparedBody(dispatch.preparedBody),
      '### Accepted delivery evidence',
      'The outbox reached terminal `sent`; this does not prove handset receipt or reading.',
      '```json',
      acceptedDelivery,
      '```',
      commitMarker,
    ].join('\n\n'),
    commitMarker,
  }
}

function renderAssistantGroupChallengePreparedBody(body: string): string {
  return body
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.length > 0 ? `> ${line}` : '>')
    .join('\n')
}

function toSafeGroupChallengeMediaDescriptor(
  media: AssistantResponseMedia,
): Record<string, string | number | null> {
  switch (media.kind) {
    case 'image':
      return {
        alt: media.alt,
        kind: media.kind,
        source: media.source === null ? null : 'accepted-image',
      }
    case 'voice_memo':
      return {
        kind: media.kind,
      }
    case 'vault_file':
      return {
        contentType: media.contentType,
        kind: media.kind,
        sizeBytes: media.sizeBytes,
      }
  }
}

async function appendOrReuseAssistantGroupChallengeDelivery(input: {
  body: string
  commitMarker: string
  heading: string
  slug: string
  vault: string
}): Promise<'recorded' | 'reused'> {
  const current = (await getKnowledgePage({
    slug: input.slug,
    vault: input.vault,
  })).page
  assertGroupChallengePage(current.pageType, current.status)
  if (challengePageHasExactDeliveryCommit({
    body: current.body,
    commitMarker: input.commitMarker,
    heading: input.heading,
  })) {
    return 'reused'
  }

  try {
    await appendActiveChallengePageSection({
      body: input.body,
      heading: input.heading,
      position: 'prepend',
      slug: input.slug,
      vault: input.vault,
    })
    return 'recorded'
  } catch (error) {
    if (
      !(error instanceof VaultCliError) ||
      error.code !== 'knowledge_section_already_exists'
    ) {
      throw error
    }
    const afterConflict = (await getKnowledgePage({
      slug: input.slug,
      vault: input.vault,
    })).page
    if (challengePageHasExactDeliveryCommit({
      body: afterConflict.body,
      commitMarker: input.commitMarker,
      heading: input.heading,
    })) {
      return 'reused'
    }
    throw new VaultCliError(
      'scheduled_challenge_delivery_commit_conflict',
      'The challenge already has a different delivery record for this occurrence.',
    )
  }
}

function assertGroupChallengePage(
  pageType: string | null,
  status: string | null,
): void {
  if (pageType !== 'challenge' || (status !== 'active' && status !== 'archived')) {
    throw new VaultCliError(
      'scheduled_challenge_not_active',
      'The bound knowledge page is not an active or archived challenge.',
    )
  }
}

function challengePageHasExactDeliveryCommit(input: {
  body: string
  commitMarker: string
  heading: string
}): boolean {
  return input.body.includes(`## ${input.heading}`) &&
    input.body.includes(input.commitMarker)
}
