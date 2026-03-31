type RegistryMetadataDefaultsInput = {
  idField?: string;
  idKeys?: readonly string[];
  slugKeys?: readonly string[];
};

type RegistryMetadataWithDefaults<TRegistry extends RegistryMetadataDefaultsInput> = Omit<
  TRegistry,
  "idField" | "idKeys" | "slugKeys"
> & {
  idField: string;
  idKeys: readonly string[];
  slugKeys: readonly string[];
};

interface RegistryRelationDefinition {
  type: string;
  cardinality: "one" | "many";
  keys: readonly string[];
}

interface RegistryLink {
  type: string;
  targetId: string;
  sourceKeys: readonly string[];
}

export function applyRegistryMetadataDefaults<
  TRegistry extends RegistryMetadataDefaultsInput,
>(registry: TRegistry & { idField: string }): RegistryMetadataWithDefaults<TRegistry> {
  return {
    ...registry,
    idField: registry.idField,
    idKeys: registry.idKeys ?? [registry.idField],
    slugKeys: registry.slugKeys ?? ["slug"],
  } as RegistryMetadataWithDefaults<TRegistry>;
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

export function extractRegistryLinks(
  source: Record<string, unknown>,
  relations: readonly RegistryRelationDefinition[],
): RegistryLink[] {
  return relations.flatMap((relation) =>
    extractRegistryRelationTargets(source, relation).map((targetId) => ({
      type: relation.type,
      targetId,
      sourceKeys: relation.keys,
    })),
  );
}

export function extractRegistryRelatedIds<TLink extends { targetId: string }>(
  links: readonly TLink[],
): string[] {
  return [...new Set(links.map((link) => link.targetId))];
}
