import {
  extractBankEntityRegistryLinks,
  type BankEntityKind,
  type BankEntityRegistryLink,
} from "@murphai/contracts";

import {
  linkTargetIds,
  normalizeCanonicalDate,
  normalizeCanonicalLinks,
  normalizeUniqueStringArray,
  resolveCanonicalRecordClass,
  uniqueStrings,
  type CanonicalEntity,
  type CanonicalEntityLinkType,
} from "../../canonical-entities.ts";
import { firstString } from "../shared.ts";

import type { RegistryMarkdownRecord } from "../registries.ts";

const REGISTRY_LINK_TYPE_MAP = {
  parent_goal: "parent_of",
  related_goal: "related_to",
  related_experiment: "related_to",
  related_protocol: "related_to",
  related_condition: "related_to",
  related_variant: "related_to",
  related_to: "related_to",
  supports_goal: "supports_goal",
  addresses_condition: "addresses_condition",
  source_family_member: "source_family_member",
} as const satisfies Record<string, CanonicalEntityLinkType>;

function normalizeTags(value: unknown): string[] {
  return normalizeUniqueStringArray(value);
}

function normalizeRegistryLinkType(
  link: BankEntityRegistryLink,
): CanonicalEntityLinkType {
  return link.type in REGISTRY_LINK_TYPE_MAP
    ? REGISTRY_LINK_TYPE_MAP[
        link.type as keyof typeof REGISTRY_LINK_TYPE_MAP
      ]
    : "related_to";
}

function buildRegistryLinks(
  family: BankEntityKind,
  attributes: Record<string, unknown>,
) {
  const protocolSelfId =
    family === "protocol" ? firstString(attributes, ["protocolId"]) : null;

  return normalizeCanonicalLinks(
    extractBankEntityRegistryLinks(family, attributes)
      .filter((link) =>
        !(
          family === "protocol" &&
          protocolSelfId &&
          link.type === "related_protocol" &&
          link.targetId === protocolSelfId &&
          link.sourceKeys.length === 1 &&
          link.sourceKeys[0] === "protocolId"
        )
      )
      .map((link) => ({
        type: normalizeRegistryLinkType(link),
        targetId: link.targetId,
      })),
  );
}

export function projectRegistryEntity(
  family: BankEntityKind,
  record: RegistryMarkdownRecord,
): CanonicalEntity {
  const attributes = record.document.attributes;
  const occurredAt =
    firstString(attributes, [
      "updatedAt",
      "recordedAt",
      "capturedAt",
      "assertedOn",
      "resolvedOn",
    ]) ?? null;
  const links = buildRegistryLinks(family, attributes);
  const relatedIds = uniqueStrings(linkTargetIds(links));

  return {
    entityId: record.entity.id,
    primaryLookupId: record.entity.id,
    lookupIds: uniqueStrings([record.entity.id, record.entity.slug]),
    family,
    recordClass: resolveCanonicalRecordClass(family),
    kind: firstString(attributes, ["docType", "kind"]) ?? family,
    status: record.entity.status,
    occurredAt,
    date: firstString(attributes, ["dayKey"]) ?? normalizeCanonicalDate(occurredAt),
    path: record.document.relativePath,
    title: record.entity.title,
    body: record.document.body,
    attributes,
    frontmatter: attributes,
    links,
    relatedIds,
    stream: null,
    experimentSlug: firstString(attributes, ["experimentSlug"]),
    tags: normalizeTags(attributes.tags),
  };
}
