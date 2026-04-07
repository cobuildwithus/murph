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

function readExplicitRegistryLinks(
  source: Record<string, unknown>,
  allowedTypes: ReadonlySet<string>,
): RegistryLink[] | null {
  if (!Object.prototype.hasOwnProperty.call(source, "links")) {
    return null;
  }

  const rawLinks = source.links;
  if (!Array.isArray(rawLinks)) {
    return [];
  }

  const links: RegistryLink[] = [];

  for (const rawLink of rawLinks) {
    if (!rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) {
      continue;
    }

    const candidate = rawLink as Record<string, unknown>;
    const type = normalizeRegistryString(candidate.type);
    const targetId = normalizeRegistryString(candidate.targetId);

    if (!type || !targetId || !allowedTypes.has(type)) {
      continue;
    }

    links.push({
      type,
      targetId,
      sourceKeys: ["links"],
    });
  }

  return links;
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
  const allowedTypes = new Set(relations.map((relation) => relation.type));
  const explicitLinks = readExplicitRegistryLinks(source, allowedTypes);
  const links: RegistryLink[] =
    explicitLinks ??
    relations.flatMap((relation) =>
      extractRegistryRelationTargets(source, relation).map((targetId) => ({
        type: relation.type,
        targetId,
        sourceKeys: relation.keys,
      })),
    );
  const deduped: RegistryLink[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const dedupeKey = `${link.type}:${link.targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(link);
  }

  return deduped;
}

export function extractRegistryRelatedIds<TLink extends { targetId: string }>(
  links: readonly TLink[],
): string[] {
  return [...new Set(links.map((link) => link.targetId))];
}
