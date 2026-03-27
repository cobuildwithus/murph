import type { JournalDayFrontmatter } from "@healthybob/contracts";
import {
  journalDayFrontmatterSchema,
  safeParseContract,
} from "@healthybob/contracts";

import { VAULT_LAYOUT } from "./constants.js";
import { VaultError } from "./errors.js";
import { readExperimentFrontmatterDocument } from "./domains/experiments.js";
import {
  ensureJournalDay as ensureJournalDayInternal,
  readJournalDayFrontmatterDocument,
} from "./domains/journal.js";
import { stringifyFrontmatterDocument } from "./frontmatter.js";
import { runCanonicalWrite } from "./operations/write-batch.js";

interface InboxPromotionCaptureAttachment {
  attachmentId?: string | null;
  ordinal: number;
  externalId?: string | null;
  kind: "image" | "audio" | "video" | "document" | "other";
  originalPath?: string | null;
  storedPath?: string | null;
  fileName?: string | null;
}

interface InboxPromotionCapture {
  captureId: string;
  eventId: string;
  source: string;
  occurredAt: string;
  text: string | null;
  thread: {
    id: string;
    title?: string | null;
  };
  actor: {
    id?: string | null;
    displayName?: string | null;
  };
  attachments: InboxPromotionCaptureAttachment[];
}

interface PromoteInboxJournalInput {
  vaultRoot: string;
  date: string;
  capture: InboxPromotionCapture;
}

interface PromoteInboxJournalResult {
  lookupId: string;
  relatedId: string;
  journalPath: string;
  created: boolean;
  appended: boolean;
  linked: boolean;
}

interface PromoteInboxExperimentNoteInput {
  vaultRoot: string;
  relativePath: string;
  capture: InboxPromotionCapture;
}

interface PromoteInboxExperimentNoteResult {
  experimentId: string;
  relatedId: string;
  experimentPath: string;
  experimentSlug: string;
  appended: boolean;
}

interface PromotionMarkdownTargetSpec<TContext> {
  sectionHeading: string;
  sectionStartMarker: string;
  sectionEndMarker: string;
  blockHeading(capture: InboxPromotionCapture, context: TContext): string;
  blockExtraLines?(capture: InboxPromotionCapture, context: TContext): string[];
}
const JOURNAL_PROMOTION_SECTION_START = "<!-- inbox-journal-captures:start -->";
const JOURNAL_PROMOTION_SECTION_END = "<!-- inbox-journal-captures:end -->";
const EXPERIMENT_NOTE_SECTION_START = "<!-- inbox-experiment-notes:start -->";
const EXPERIMENT_NOTE_SECTION_END = "<!-- inbox-experiment-notes:end -->";
const JOURNAL_PROMOTION_MARKDOWN_SPEC = {
  sectionHeading: "## Inbox Captures",
  sectionStartMarker: JOURNAL_PROMOTION_SECTION_START,
  sectionEndMarker: JOURNAL_PROMOTION_SECTION_END,
  blockHeading(capture: InboxPromotionCapture): string {
    return `### Inbox Capture ${capture.captureId}`;
  },
} satisfies PromotionMarkdownTargetSpec<undefined>;
const EXPERIMENT_PROMOTION_MARKDOWN_SPEC = {
  sectionHeading: "## Inbox Experiment Notes",
  sectionStartMarker: EXPERIMENT_NOTE_SECTION_START,
  sectionEndMarker: EXPERIMENT_NOTE_SECTION_END,
  blockHeading(capture: InboxPromotionCapture): string {
    return `### Inbox Note ${capture.captureId}`;
  },
  blockExtraLines(
    _capture: InboxPromotionCapture,
    context: {
      experimentSlug: string;
    },
  ): string[] {
    return [`Experiment: ${context.experimentSlug}`];
  },
} satisfies PromotionMarkdownTargetSpec<{
  experimentSlug: string;
}>;

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validateJournalFrontmatter(
  value: unknown,
  relativePath = "journal",
): JournalDayFrontmatter {
  const result = safeParseContract(journalDayFrontmatterSchema, value);
  if (!result.success) {
    throw new VaultError(
      "JOURNAL_FRONTMATTER_INVALID",
      `Journal frontmatter for "${relativePath}" is invalid.`,
      {
        relativePath,
        errors: result.errors,
      },
    );
  }

  return result.data;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCapturePromotionBlock<TContext>(input: {
  capture: InboxPromotionCapture;
  marker: string;
  context: TContext;
  spec: PromotionMarkdownTargetSpec<TContext>;
}): string {
  const { capture, marker, context, spec } = input;
  const lines = [
    marker,
    spec.blockHeading(capture, context),
    ...(spec.blockExtraLines?.(capture, context) ?? []),
    `Occurred at: ${capture.occurredAt}`,
    `Source: ${capture.source}`,
    `Thread: ${capture.thread.title ?? capture.thread.id}`,
    `Event: ${capture.eventId}`,
  ];

  const actorName = normalizeNullableString(capture.actor.displayName);
  const actorId = normalizeNullableString(capture.actor.id);
  if (actorName || actorId) {
    lines.push(`Actor: ${actorName ?? actorId ?? "unknown"}`);
  }

  if (capture.attachments.length > 0) {
    lines.push("Attachments:");
    for (const attachment of capture.attachments) {
      const attachmentLabel =
        attachment.fileName ??
        attachment.storedPath ??
        attachment.originalPath ??
        attachment.externalId ??
        `attachment-${attachment.ordinal}`;
      lines.push(
        `- ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`} | ${attachment.kind} | ${attachmentLabel}`,
      );
    }
  }

  const text = normalizeNullableString(capture.text);
  if (text) {
    lines.push("", text);
  }

  return lines.join("\n");
}

function upsertMarkdownSectionBlock<TContext>(
  body: string,
  block: string,
  spec: PromotionMarkdownTargetSpec<TContext>,
): {
  body: string;
  appended: boolean;
} {
  const normalizedBody = body.replace(/\s*$/, "");

  if (
    normalizedBody.includes(spec.sectionStartMarker) &&
    normalizedBody.includes(spec.sectionEndMarker)
  ) {
    return {
      body: normalizedBody.replace(
        spec.sectionEndMarker,
        `${block}\n\n${spec.sectionEndMarker}`,
      ),
      appended: true,
    };
  }

  const separator = normalizedBody.length > 0 ? "\n\n" : "";
  return {
    body:
      `${normalizedBody}${separator}${spec.sectionHeading}\n\n` +
      `${spec.sectionStartMarker}\n\n${block}\n\n${spec.sectionEndMarker}\n`,
    appended: true,
  };
}

function upsertPromotionBody<TContext>(input: {
  body: string;
  capture: InboxPromotionCapture;
  context: TContext;
  spec: PromotionMarkdownTargetSpec<TContext>;
}): {
  body: string;
  appended: boolean;
} {
  const { body, capture, context, spec } = input;
  const marker = `<!-- inbox-capture:${capture.captureId} -->`;
  if (body.includes(marker)) {
    return {
      body,
      appended: false,
    };
  }

  const block = buildCapturePromotionBlock({
    capture,
    marker,
    context,
    spec,
  });
  return upsertMarkdownSectionBlock(body, block, spec);
}

export async function promoteInboxJournal(
  input: PromoteInboxJournalInput,
): Promise<PromoteInboxJournalResult> {
  const ensured = await ensureJournalDayInternal({
    vaultRoot: input.vaultRoot,
    date: input.date,
  });
  const { rawDocument, document } = await readJournalDayFrontmatterDocument(
    input.vaultRoot,
    ensured.relativePath,
  );
  const currentEventIds = [...document.attributes.eventIds];
  const bodyUpdate = upsertPromotionBody({
    body: document.body,
    capture: input.capture,
    context: undefined,
    spec: JOURNAL_PROMOTION_MARKDOWN_SPEC,
  });
  const nextDocument = stringifyFrontmatterDocument({
    attributes: validateJournalFrontmatter(
      {
        ...document.attributes,
        eventIds: uniqueStrings([...currentEventIds, input.capture.eventId]),
      },
      ensured.relativePath,
    ),
    body: bodyUpdate.body,
  });

  if (nextDocument !== rawDocument) {
    await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "inbox_promote_journal",
      summary: `Promote inbox capture ${input.capture.captureId} into journal ${input.date}`,
      occurredAt: new Date(),
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(ensured.relativePath, nextDocument, {
          overwrite: true,
        });
        return undefined;
      },
    });
  }

  return {
    lookupId: `journal:${input.date}`,
    relatedId: input.capture.eventId,
    journalPath: ensured.relativePath,
    created: ensured.created,
    appended: bodyUpdate.appended,
    linked: !currentEventIds.includes(input.capture.eventId),
  };
}

export async function promoteInboxExperimentNote(
  input: PromoteInboxExperimentNoteInput,
): Promise<PromoteInboxExperimentNoteResult> {
  const { rawDocument, document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const bodyUpdate = upsertPromotionBody({
    body: document.body,
    capture: input.capture,
    context: {
      experimentSlug: document.attributes.slug,
    },
    spec: EXPERIMENT_PROMOTION_MARKDOWN_SPEC,
  });
  const nextDocument = stringifyFrontmatterDocument({
    attributes: document.attributes,
    body: bodyUpdate.body,
  });

  if (nextDocument !== rawDocument) {
    await runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: "inbox_promote_experiment_note",
      summary: `Promote inbox capture ${input.capture.captureId} into experiment ${document.attributes.experimentId}`,
      occurredAt: new Date(),
      mutate: async ({ batch }) => {
        await batch.stageTextWrite(input.relativePath, nextDocument, {
          overwrite: true,
        });
        return undefined;
      },
    });
  }

  return {
    experimentId: document.attributes.experimentId,
    relatedId: input.capture.eventId,
    experimentPath: input.relativePath,
    experimentSlug: document.attributes.slug,
    appended: bodyUpdate.appended,
  };
}
