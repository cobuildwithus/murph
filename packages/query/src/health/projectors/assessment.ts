import {
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeUniqueStringArray,
  relatedToLinks,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
} from "../../canonical-entities.ts";
import {
  asObject,
  firstObject,
  firstString,
} from "../shared.ts";

export function projectAssessmentEntity(
  value: unknown,
  relativePath: string,
): CanonicalEntity | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  if (!id?.startsWith("asmt_")) {
    return null;
  }

  const recordedAt = firstString(source, ["recordedAt", "occurredAt", "importedAt"]);
  const importedAt = firstString(source, ["importedAt"]);
  const questionnaireSlug = firstString(source, ["questionnaireSlug"]);
  const links = relatedToLinks(normalizeUniqueStringArray(source.relatedIds));

  return {
    entityId: id,
    primaryLookupId: id,
    lookupIds: uniqueStrings([id, questionnaireSlug]),
    family: "assessment",
    recordClass: resolveCanonicalRecordClass("assessment"),
    kind: "assessment",
    status: null,
    occurredAt: recordedAt ?? importedAt,
    date: normalizeCanonicalDate(recordedAt ?? importedAt),
    path: relativePath,
    title: firstString(source, ["title"]),
    body: null,
    attributes: {
      ...source,
      recordedAt,
      importedAt,
      questionnaireSlug,
      responses: firstObject(source, ["responses", "response"]) ?? {},
    },
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
    stream: null,
    experimentSlug: null,
    tags: normalizeUniqueStringArray(source.tags),
  };
}
