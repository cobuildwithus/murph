/**
 * Keep the query lookup-family helpers local so public helper barrels stay loader-free.
 */
interface IdFamilyDefinition {
  entityKind: string
  prefix?: string
  exactIds?: readonly string[]
  queryable: boolean
  lookupConstraint?: string
}

const ID_FAMILY_REGISTRY = Object.freeze<IdFamilyDefinition[]>([
  {
    entityKind: "core",
    exactIds: ["core", "current"],
    queryable: true,
  },
  {
    entityKind: "audit",
    prefix: "aud_",
    queryable: true,
  },
  {
    entityKind: "event",
    prefix: "evt_",
    queryable: true,
  },
  {
    entityKind: "experiment",
    prefix: "exp_",
    queryable: true,
  },
  {
    entityKind: "food",
    prefix: "food_",
    queryable: true,
  },
  {
    entityKind: "recipe",
    prefix: "rcp_",
    queryable: true,
  },
  {
    entityKind: "provider",
    prefix: "prov_",
    queryable: true,
  },
  {
    entityKind: "protocol",
    prefix: "prot_",
    queryable: true,
  },
  {
    entityKind: "sample",
    prefix: "smp_",
    queryable: true,
  },
  {
    entityKind: "workout_format",
    prefix: "wfmt_",
    queryable: true,
  },
  {
    entityKind: "journal",
    prefix: "journal:",
    queryable: true,
  },
  {
    entityKind: "meal",
    prefix: "meal_",
    queryable: true,
  },
  {
    entityKind: "document",
    prefix: "doc_",
    queryable: true,
  },
  {
    entityKind: "transform",
    prefix: "xfm_",
    queryable: false,
    lookupConstraint:
      "Transform ids identify an import batch, not a query-layer record. Use the returned lookupIds or `list --kind sample` instead.",
  },
  {
    entityKind: "export_pack",
    prefix: "pack_",
    queryable: false,
    lookupConstraint:
      "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.",
  },
])

export function inferQueryIdEntityKind(id: string): string {
  return findIdFamily(id)?.entityKind ?? "entity"
}

export function isQueryableQueryLookupId(id: string): boolean {
  return findIdFamily(id)?.queryable ?? false
}

export function describeQueryLookupConstraint(id: string): string | null {
  return findIdFamily(id)?.lookupConstraint ?? null
}

function findIdFamily(id: string): IdFamilyDefinition | null {
  const normalizedId = id.trim()
  if (!normalizedId) {
    return null
  }

  for (const family of ID_FAMILY_REGISTRY) {
    if (family.exactIds?.includes(normalizedId)) {
      return family
    }

    if (family.prefix && normalizedId.startsWith(family.prefix)) {
      return family
    }
  }

  return null
}
