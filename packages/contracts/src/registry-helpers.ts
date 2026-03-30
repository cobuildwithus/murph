interface RegistryRelationDefinition {
  cardinality: "one" | "many";
  keys: readonly string[];
}

export function normalizeRegistryString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFirstRegistryString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeRegistryString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function readMergedRegistryStringArray(
  source: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  return [
    ...new Set(
      keys.flatMap((key) => {
        const value = source[key];
        if (!Array.isArray(value)) {
          return [];
        }

        return value
          .map((entry) => normalizeRegistryString(entry))
          .filter((entry): entry is string => Boolean(entry));
      }),
    ),
  ];
}

export function extractRegistryRelationTargets(
  source: Record<string, unknown>,
  relation: RegistryRelationDefinition,
): string[] {
  return relation.cardinality === "one"
    ? [readFirstRegistryString(source, relation.keys)].filter(
        (entry): entry is string => Boolean(entry),
      )
    : readMergedRegistryStringArray(source, relation.keys);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProjectedSupplementIngredient {
  compound: string;
  label: string | null;
  amount: number | null;
  unit: string | null;
  active: boolean;
  note: string | null;
}

export function projectSupplementIngredients(
  value: unknown,
): ProjectedSupplementIngredient[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }

    const compound = typeof entry.compound === "string" ? entry.compound.trim() : "";
    if (!compound) {
      return [];
    }

    return [{
      compound,
      label:
        typeof entry.label === "string" && entry.label.trim().length > 0
          ? entry.label.trim()
          : null,
      amount:
        typeof entry.amount === "number" && Number.isFinite(entry.amount)
          ? entry.amount
          : null,
      unit:
        typeof entry.unit === "string" && entry.unit.trim().length > 0
          ? entry.unit.trim()
          : null,
      active: typeof entry.active === "boolean" ? entry.active : true,
      note:
        typeof entry.note === "string" && entry.note.trim().length > 0
          ? entry.note.trim()
          : null,
    }];
  });
}
