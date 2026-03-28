import {
  compareCanonicalEntities,
  fallbackCurrentProfileEntity,
  projectAssessmentEntity,
  projectCurrentProfileEntity,
  projectHistoryEntity,
  projectProfileSnapshotEntity,
  type CanonicalEntity,
} from "../canonical-entities.ts";
import {
  resolveCurrentProfileDocument,
  resolveCurrentProfileSnapshot,
  type CurrentProfileDocumentOutcome,
  type CurrentProfileSnapshotSortFields,
} from "./current-profile-resolution.ts";
import {
  readJsonlRecordOutcomes,
  readJsonlRecordOutcomesSync,
  readJsonlRecords,
  type JsonlRecordOutcome,
  type MarkdownDocumentOutcome,
  type ParseFailure,
} from "./loaders.ts";
import { firstString, type MarkdownDocumentRecord } from "./shared.ts";

export interface EntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

export interface CurrentProfileCollection {
  entity: CanonicalEntity | null;
  failures: ParseFailure[];
}

export async function readAssessmentEntitiesStrict(
  vaultRoot: string,
): Promise<CanonicalEntity[]> {
  return readJsonlEntitiesStrict(vaultRoot, "ledger/assessments", projectAssessmentEntity);
}

export async function readHistoryEntitiesStrict(
  vaultRoot: string,
): Promise<CanonicalEntity[]> {
  return readJsonlEntitiesStrict(vaultRoot, "ledger/events", projectHistoryEntity);
}

export async function readProfileSnapshotEntitiesStrict(
  vaultRoot: string,
): Promise<CanonicalEntity[]> {
  return readJsonlEntitiesStrict(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
}

export async function readJsonlEntitiesStrict(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<CanonicalEntity[]> {
  return (await readJsonlRecords(vaultRoot, relativeRoot))
    .map((entry) => project(entry.value, entry.relativePath))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

export async function readJsonlEntitiesTolerant(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<EntityCollection> {
  return projectJsonlOutcomes(
    await readJsonlRecordOutcomes(vaultRoot, relativeRoot),
    project,
  );
}

export function readJsonlEntitiesTolerantSync(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  return projectJsonlOutcomes(readJsonlRecordOutcomesSync(vaultRoot, relativeRoot), project);
}

export async function readCurrentProfileCollectionAsync(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
  readDocument: (
    vaultRoot: string,
    relativePath: string,
  ) => Promise<MarkdownDocumentRecord | MarkdownDocumentOutcome | null>,
): Promise<CurrentProfileCollection> {
  return resolveCurrentProfileCollection(
    profileSnapshots,
    markdownByPath,
    await readDocument(vaultRoot, "bank/profile/current.md"),
  );
}

export function readCurrentProfileCollectionSync(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
  readDocument: (
    vaultRoot: string,
    relativePath: string,
  ) => MarkdownDocumentRecord | MarkdownDocumentOutcome | null,
): CurrentProfileCollection {
  return resolveCurrentProfileCollection(
    profileSnapshots,
    markdownByPath,
    readDocument(vaultRoot, "bank/profile/current.md"),
  );
}

function projectJsonlOutcomes(
  outcomes: JsonlRecordOutcome[],
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = project(outcome.value, outcome.relativePath);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
}

function resolveCurrentProfileCollection(
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
  currentProfileDocumentInput: MarkdownDocumentRecord | MarkdownDocumentOutcome | null,
): CurrentProfileCollection {
  const resolution = resolveCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
    fallbackCurrentProfileEntity,
  );
  const currentProfileDocument = buildCurrentProfileDocumentResolutionInput(
    currentProfileDocumentInput,
  );
  const resolvedCurrentProfile = resolveCurrentProfileDocument(
    resolution,
    currentProfileDocument.documentOutcome,
    currentProfileSnapshotId,
    buildCurrentProfileRetainOptions(markdownByPath, currentProfileDocument.markdown),
  );

  return {
    entity: resolvedCurrentProfile.currentProfile,
    failures: resolvedCurrentProfile.failures,
  };
}

function buildCurrentProfileDocumentResolutionInput(
  input: MarkdownDocumentRecord | MarkdownDocumentOutcome | null,
): {
  documentOutcome: CurrentProfileDocumentOutcome<CanonicalEntity, ParseFailure>;
  markdown: string | null;
} {
  if (!input) {
    return {
      documentOutcome: { status: "missing" },
      markdown: null,
    };
  }

  if ("ok" in input) {
    if (!input.ok) {
      return {
        documentOutcome: {
          status: "parse-failed",
          failure: input,
        },
        markdown: null,
      };
    }

    return buildCurrentProfileDocumentResolutionInput(input.document);
  }

  return {
    documentOutcome: {
      status: "ok",
      currentProfile: projectCurrentProfileEntity(input),
    },
    markdown: input.markdown,
  };
}

function buildCurrentProfileRetainOptions(
  markdownByPath: Map<string, string>,
  markdown: string | null,
):
  | {
      retainDocumentCurrentProfile: (currentProfile: CanonicalEntity) => void;
    }
  | undefined {
  if (!markdown) {
    return undefined;
  }

  return {
    retainDocumentCurrentProfile: (currentProfile) => {
      markdownByPath.set(currentProfile.path, markdown);
    },
  };
}

function canonicalProfileSnapshotSortFields(
  snapshot: CanonicalEntity,
): CurrentProfileSnapshotSortFields {
  return {
    snapshotId: snapshot.entityId,
    snapshotTimestamp: snapshot.occurredAt ?? snapshot.date,
  };
}

function currentProfileSnapshotId(
  entity: CanonicalEntity,
): string | null {
  return firstString(entity.attributes, ["snapshotId"]);
}
