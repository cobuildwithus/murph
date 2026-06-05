import {
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  createStoreBackedAssistantInputSource,
  readAssistantInputEvent,
  type AssistantInputCandidateBatch,
  type AssistantInputCandidate,
  type AssistantInputCandidateQuery,
  type AssistantInputSource,
} from "@murphai/assistant-engine";

export function createHostedAssistantInputSource(input: {
  foregroundReplayPromptInputIds?: readonly string[] | null;
  foregroundReplayInputIds?: readonly string[] | null;
  preferredInputIds?: readonly string[] | null;
  vaultRoot: string;
}): AssistantInputSource {
  const baseSource = createStoreBackedAssistantInputSource({
    vault: input.vaultRoot,
  });
  const foregroundReplayInputIds = [...new Set(input.foregroundReplayInputIds ?? [])];
  const foregroundReplayPromptInputIds = new Set(input.foregroundReplayPromptInputIds ?? []);
  const preferredInputIds = [...new Set(input.preferredInputIds ?? [])];
  let source: AssistantInputSource = baseSource;

  if (preferredInputIds.length > 0) {
    const preferredBaseSource = source;
    source = {
      ...preferredBaseSource,
      async listInputCandidates(query) {
        const base = await preferredBaseSource.listInputCandidates(query);
        const preferred = await listPreferredAssistantInputCandidates({
          preferredInputIds,
          query,
          vaultRoot: input.vaultRoot,
        });
        return preferred.length === 0
          ? base
          : mergePreferredAssistantInputCandidates({
            base,
            preferred,
            query,
          });
      },
    };
  }

  if (foregroundReplayInputIds.length === 0) {
    return source;
  }

  const foregroundReplayBaseSource = source;
  const foregroundReplayInputIdSet = new Set(foregroundReplayInputIds);
  return {
    ...foregroundReplayBaseSource,
    async listInputCandidates(query) {
      const base = await foregroundReplayBaseSource.listInputCandidates(query);
      const replayLimit = normalizePreferredAssistantInputLimit(query.limit);
      const replay = await listPreferredAssistantInputCandidates({
        includeBoundaryInputIds: foregroundReplayInputIdSet,
        preferredInputIds: foregroundReplayInputIds.slice(-replayLimit),
        query,
        vaultRoot: input.vaultRoot,
      });
      return replay.length === 0
        ? base
        : buildForegroundReplayCandidateBatch({
          base,
          foregroundReplayPromptInputIds,
          query,
          replay,
        });
    },
  };
}

function buildForegroundReplayCandidateBatch(input: {
  base: AssistantInputCandidateBatch;
  foregroundReplayPromptInputIds: ReadonlySet<string>;
  query: AssistantInputCandidateQuery;
  replay: readonly AssistantInputCandidate[];
}): AssistantInputCandidateBatch {
  const limit = normalizePreferredAssistantInputLimit(input.query.limit);
  const replayInputIds = new Set(
    input.replay.map((candidate) => candidate.event.inputId),
  );
  const latestReplayCursor = latestAssistantInputCursor(
    input.replay.map((candidate) => candidate.event.cursor),
    input.query.afterCursor ?? null,
  );
  const replayCandidates = uniqueAssistantInputCandidates(input.replay)
    .sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    )
    .slice(-limit);
  const remainingBaseLimit = Math.max(0, limit - replayCandidates.length);
  const baseCandidates = remainingBaseLimit === 0
    ? []
    : uniqueAssistantInputCandidates(
      input.base.inputs.filter((candidate) => {
        if (replayInputIds.has(candidate.event.inputId)) {
          return false;
        }
        return !latestReplayCursor
          || compareAssistantInputCursors(candidate.event.cursor, latestReplayCursor) <= 0;
      }),
    )
      .sort((left, right) =>
        compareAssistantInputCursors(left.event.cursor, right.event.cursor)
      )
      .slice(-remainingBaseLimit);
  const selected = [...baseCandidates, ...replayCandidates]
    .sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    );

  return {
    inputs: selected.map((candidate) =>
      !replayInputIds.has(candidate.event.inputId) ||
      input.foregroundReplayPromptInputIds.has(candidate.event.inputId)
        ? candidate
        : maskForegroundReplayCandidatePromptContent(candidate)
    ),
    nextCursor: latestAssistantInputCursor(
      selected.map((candidate) => candidate.event.cursor),
      input.query.afterCursor ?? null,
    ),
  };
}

function uniqueAssistantInputCandidates(
  candidates: readonly AssistantInputCandidate[],
): AssistantInputCandidate[] {
  const candidatesByInputId = new Map<string, AssistantInputCandidate>();
  for (const candidate of candidates) {
    if (!candidatesByInputId.has(candidate.event.inputId)) {
      candidatesByInputId.set(candidate.event.inputId, candidate);
    }
  }
  return [...candidatesByInputId.values()];
}

function maskForegroundReplayCandidatePromptContent(
  candidate: AssistantInputCandidate,
): AssistantInputCandidate {
  return {
    ...candidate,
    event: {
      ...candidate.event,
      attachmentCount: 0,
      attachmentDescriptors: [],
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: null,
        reasonCode: null,
        source: null,
        status: "not_attempted",
        updatedAt: null,
      },
      sourceMetadata: null,
      text: null,
      transcriptText: null,
      userMessageContent: null,
    },
  };
}

function mergePreferredAssistantInputCandidates(input: {
  base: AssistantInputCandidateBatch;
  preferred: readonly AssistantInputCandidate[];
  query: AssistantInputCandidateQuery;
}): AssistantInputCandidateBatch {
  const limit = normalizePreferredAssistantInputLimit(input.query.limit);
  const baseNextCursor = input.base.nextCursor;
  const safePreferred = baseNextCursor
    ? input.preferred.filter(
        (candidate) =>
          compareAssistantInputCursors(candidate.event.cursor, baseNextCursor) <= 0,
      )
    : input.base.inputs.length === 0
      ? input.preferred
      : [];
  const candidatesByInputId = new Map<string, AssistantInputCandidate>();

  for (const candidate of [...safePreferred, ...input.base.inputs]) {
    const inputId = candidate.event.inputId;
    if (!candidatesByInputId.has(inputId)) {
      candidatesByInputId.set(inputId, candidate);
    }
  }

  const selected = [...candidatesByInputId.values()]
    .sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    )
    .slice(0, limit);

  return {
    inputs: selected,
    nextCursor: latestAssistantInputCursor(
      selected.map((candidate) => candidate.event.cursor),
      input.query.afterCursor ?? null,
    ),
  };
}

function latestAssistantInputCursor(
  cursors: readonly AssistantInputCandidate["event"]["cursor"][],
  fallback: AssistantInputCandidate["event"]["cursor"] | null,
): AssistantInputCandidate["event"]["cursor"] | null {
  return cursors.reduce<AssistantInputCandidate["event"]["cursor"] | null>(
    (latest, cursor) =>
      !latest || compareAssistantInputCursors(cursor, latest) > 0
        ? cursor
        : latest,
    fallback,
  );
}

async function listPreferredAssistantInputCandidates(input: {
  includeBoundaryInputIds?: ReadonlySet<string> | null;
  preferredInputIds: readonly string[];
  query: AssistantInputCandidateQuery;
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const includeBoundaryInputIds = input.includeBoundaryInputIds ?? null;
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const limit = normalizePreferredAssistantInputLimit(input.query.limit);
  const candidates: AssistantInputCandidate[] = [];

  for (const inputId of input.preferredInputIds) {
    const isBoundaryCandidate = includeBoundaryInputIds?.has(inputId) === true;
    if (knownInputIds.has(inputId) && !isBoundaryCandidate) {
      continue;
    }
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (!event) {
      continue;
    }
    const candidate = assistantInputCandidateFromStoredEvent(event);
    if (
      input.query.sourceId
      && candidate.event.source !== input.query.sourceId
    ) {
      continue;
    }
    if (
      input.query.afterCursor
      && !isPreferredBoundaryCandidate({
        afterCursor: input.query.afterCursor,
        candidate,
        includeBoundaryInputIds,
      })
    ) {
      continue;
    }
    candidates.push(candidate);
  }

  return candidates
    .sort((left, right) => compareAssistantInputCursors(left.event.cursor, right.event.cursor))
    .slice(0, limit);
}

function isPreferredBoundaryCandidate(input: {
  afterCursor: AssistantInputCandidateQuery["afterCursor"];
  candidate: AssistantInputCandidate;
  includeBoundaryInputIds: ReadonlySet<string> | null;
}): boolean {
  if (!input.afterCursor) {
    return true;
  }

  const order = compareAssistantInputCursors(
    input.candidate.event.cursor,
    input.afterCursor,
  );
  if (order > 0) {
    return true;
  }
  return order === 0
    && input.includeBoundaryInputIds?.has(input.candidate.event.inputId) === true;
}

function normalizePreferredAssistantInputLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  return Math.max(1, Math.trunc(value));
}
