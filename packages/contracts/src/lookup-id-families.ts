import { ID_PREFIXES } from "./constants.ts";

export interface LookupIdFamilyDefinition {
  family: string;
  entityKind: string;
  prefix?: string;
  exactIds?: readonly string[];
  queryable: boolean;
  lookupConstraint?: string;
}

export const LOOKUP_ID_FAMILY_REGISTRY = Object.freeze<LookupIdFamilyDefinition[]>([
  {
    family: "core",
    entityKind: "core",
    exactIds: ["core", "current"],
    queryable: true,
  },
  {
    family: "audit",
    entityKind: "audit",
    prefix: `${ID_PREFIXES.audit}_`,
    queryable: true,
  },
  {
    family: "event",
    entityKind: "event",
    prefix: `${ID_PREFIXES.event}_`,
    queryable: true,
  },
  {
    family: "experiment",
    entityKind: "experiment",
    prefix: `${ID_PREFIXES.experiment}_`,
    queryable: true,
  },
  {
    family: "food",
    entityKind: "food",
    prefix: `${ID_PREFIXES.food}_`,
    queryable: true,
  },
  {
    family: "habitat",
    entityKind: "habitat",
    prefix: `${ID_PREFIXES.habitat}_`,
    queryable: true,
  },
  {
    family: "recipe",
    entityKind: "recipe",
    prefix: `${ID_PREFIXES.recipe}_`,
    queryable: true,
  },
  {
    family: "provider",
    entityKind: "provider",
    prefix: `${ID_PREFIXES.provider}_`,
    queryable: true,
  },
  {
    family: "protocol",
    entityKind: "protocol",
    prefix: `${ID_PREFIXES.protocol}_`,
    queryable: true,
  },
  {
    family: "sample",
    entityKind: "sample",
    prefix: `${ID_PREFIXES.sample}_`,
    queryable: true,
  },
  {
    family: "workout_format",
    entityKind: "workout_format",
    prefix: `${ID_PREFIXES.workoutFormat}_`,
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
    prefix: `${ID_PREFIXES.meal}_`,
    queryable: true,
  },
  {
    family: "document",
    entityKind: "document",
    prefix: `${ID_PREFIXES.document}_`,
    queryable: true,
  },
  {
    family: "transform",
    entityKind: "transform",
    prefix: `${ID_PREFIXES.transform}_`,
    queryable: false,
    lookupConstraint:
      "Transform ids identify an import batch, not a query-layer record. Use returned sample ids with `samples show` or inspect them with `samples list` instead.",
  },
  {
    family: "pack",
    entityKind: "export_pack",
    prefix: `${ID_PREFIXES.pack}_`,
    queryable: false,
    lookupConstraint:
      "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.",
  },
]);

export function inferLookupIdEntityKind(id: string): string {
  return findLookupIdFamily(id)?.entityKind ?? "entity";
}

export function isQueryableLookupId(id: string): boolean {
  return findLookupIdFamily(id)?.queryable ?? false;
}

export function describeLookupIdConstraint(id: string): string | null {
  return findLookupIdFamily(id)?.lookupConstraint ?? null;
}

function findLookupIdFamily(id: string): LookupIdFamilyDefinition | null {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return null;
  }

  for (const family of LOOKUP_ID_FAMILY_REGISTRY) {
    if (family.exactIds?.includes(normalizedId)) {
      return family;
    }

    if (family.prefix && normalizedId.startsWith(family.prefix)) {
      return family;
    }
  }

  return null;
}
