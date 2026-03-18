type QueryRecordData = Record<string, unknown>;

type QueryRecordType = "audit" | "core" | "event" | "experiment" | "journal" | "sample";

export interface VaultRecordIdentity {
  displayId: string;
  primaryLookupId: string;
}

interface EventDisplayIdentityRule {
  eventKind: string;
  displayKind: string;
  payloadKeys: readonly string[];
}

interface IdFamilyDefinition {
  family: string;
  entityKind: string;
  prefix?: string;
  exactIds?: readonly string[];
  queryable: boolean;
  lookupConstraint?: string;
}

const EVENT_DISPLAY_IDENTITY_RULES = Object.freeze<EventDisplayIdentityRule[]>([
  {
    eventKind: "document",
    displayKind: "document",
    payloadKeys: ["documentId"],
  },
  {
    eventKind: "meal",
    displayKind: "meal",
    payloadKeys: ["mealId"],
  },
]);

export const ID_FAMILY_REGISTRY = Object.freeze<IdFamilyDefinition[]>([
  {
    family: "core",
    entityKind: "core",
    exactIds: ["core", "current"],
    queryable: true,
  },
  {
    family: "audit",
    entityKind: "audit",
    prefix: "aud_",
    queryable: true,
  },
  {
    family: "event",
    entityKind: "event",
    prefix: "evt_",
    queryable: true,
  },
  {
    family: "experiment",
    entityKind: "experiment",
    prefix: "exp_",
    queryable: true,
  },
  {
    family: "sample",
    entityKind: "sample",
    prefix: "smp_",
    queryable: true,
  },
  {
    family: "journal",
    entityKind: "journal",
    prefix: "journal:",
    queryable: true,
  },
  {
    family: "meal",
    entityKind: "meal",
    prefix: "meal_",
    queryable: false,
    lookupConstraint:
      "Meal ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead.",
  },
  {
    family: "document",
    entityKind: "document",
    prefix: "doc_",
    queryable: false,
    lookupConstraint:
      "Document ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead.",
  },
  {
    family: "transform",
    entityKind: "transform",
    prefix: "xfm_",
    queryable: false,
    lookupConstraint:
      "Transform ids identify an import batch, not a query-layer record. Use the returned lookupIds or `list --kind sample` instead.",
  },
  {
    family: "pack",
    entityKind: "export_pack",
    prefix: "pack_",
    queryable: false,
    lookupConstraint:
      "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.",
  },
]);

export function deriveVaultRecordIdentity(
  recordType: QueryRecordType,
  payload: QueryRecordData,
  fallbackId: string,
): VaultRecordIdentity {
  if (recordType !== "event") {
    return {
      displayId: fallbackId,
      primaryLookupId: fallbackId,
    };
  }

  const eventKind = pickString(payload, ["kind"]);
  const identityRule = eventKind
    ? EVENT_DISPLAY_IDENTITY_RULES.find((rule) => rule.eventKind === eventKind)
    : null;
  const displayId = identityRule ? pickString(payload, identityRule.payloadKeys) : null;

  return {
    displayId: displayId ?? fallbackId,
    primaryLookupId: fallbackId,
  };
}

export function inferIdEntityKind(id: string): string {
  return findIdFamily(id)?.entityKind ?? "entity";
}

export function isQueryableLookupId(id: string): boolean {
  const family = findIdFamily(id);
  return family ? family.queryable : false;
}

export function describeLookupConstraint(id: string): string | null {
  return findIdFamily(id)?.lookupConstraint ?? null;
}

function findIdFamily(id: string): IdFamilyDefinition | null {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return null;
  }

  for (const family of ID_FAMILY_REGISTRY) {
    if (family.exactIds?.includes(normalizedId)) {
      return family;
    }

    if (family.prefix && normalizedId.startsWith(family.prefix)) {
      return family;
    }
  }

  return null;
}

function pickString(
  payload: QueryRecordData | null | undefined,
  keys: readonly string[],
): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
