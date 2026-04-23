import {
  HEALTH_COMMONS_ENTITY_TYPES,
  healthCommonsRelationSchema,
  type HealthCommonsEntityType,
  type HealthCommonsRelation,
} from "@murphai/contracts";
import {
  readMarkdownDocumentOutcome,
  readMarkdownDocument,
  walkRelativeFiles,
  type ParseFailure,
} from "./health/loaders.ts";
import {
  asObject,
  firstString,
  firstStringArray,
  type FrontmatterObject,
} from "./health/shared.ts";

export type HealthLibraryEntityType = HealthCommonsEntityType;

export interface HealthLibraryNode {
  aliases: string[];
  attributes: FrontmatterObject;
  body: string;
  categories: string[];
  entityType: HealthLibraryEntityType;
  key: string;
  relativePath: string;
  relations: HealthCommonsRelation[];
  slug: string;
  status: string | null;
  summary: string | null;
  title: string;
}

export interface HealthLibraryGraph {
  byKey: ReadonlyMap<string, HealthLibraryNode>;
  bySlug: ReadonlyMap<string, HealthLibraryNode>;
  nodes: HealthLibraryNode[];
}

export interface HealthLibraryGraphIssue {
  lineNumber?: number;
  parser: "frontmatter" | "json";
  reason: string;
  relativePath: string;
}

export interface HealthLibraryGraphReadResult {
  graph: HealthLibraryGraph;
  issues: HealthLibraryGraphIssue[];
}

const HEALTH_LIBRARY_ROOT = "bank/library";
const HEALTH_LIBRARY_ENTITY_TYPES = new Set<HealthLibraryEntityType>(HEALTH_COMMONS_ENTITY_TYPES);

export async function readHealthLibraryGraph(
  vaultRoot: string,
): Promise<HealthLibraryGraph> {
  const relativePaths = await walkRelativeFiles(vaultRoot, HEALTH_LIBRARY_ROOT, ".md");
  const nodes: HealthLibraryNode[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const node = toHealthLibraryNode(document.relativePath, document.body, document.attributes);
    if (node) {
      nodes.push(node);
    }
  }

  nodes.sort((left, right) => left.slug.localeCompare(right.slug));

  return {
    byKey: new Map(nodes.map((node) => [node.key, node])),
    bySlug: new Map(nodes.map((node) => [node.slug, node])),
    nodes,
  };
}

export async function readHealthLibraryGraphWithIssues(
  vaultRoot: string,
): Promise<HealthLibraryGraphReadResult> {
  const relativePaths = await walkRelativeFiles(vaultRoot, HEALTH_LIBRARY_ROOT, ".md");
  const nodes: HealthLibraryNode[] = [];
  const issues: HealthLibraryGraphIssue[] = [];

  for (const relativePath of relativePaths) {
    const outcome = await readMarkdownDocumentOutcome(vaultRoot, relativePath);
    if (!outcome.ok) {
      issues.push(parseFailureToIssue(outcome));
      continue;
    }

    const node = toHealthLibraryNode(
      outcome.document.relativePath,
      outcome.document.body,
      outcome.document.attributes,
    );
    if (node) {
      nodes.push(node);
    }
  }

  nodes.sort((left, right) => left.slug.localeCompare(right.slug));

  return {
    graph: {
      byKey: new Map(nodes.map((node) => [node.key, node])),
      bySlug: new Map(nodes.map((node) => [node.slug, node])),
      nodes,
    },
    issues,
  };
}

function toHealthLibraryNode(
  relativePath: string,
  body: string,
  attributes: FrontmatterObject,
): HealthLibraryNode | null {
  const source = asObject(attributes);
  if (!source) {
    return null;
  }

  const slug = firstString(source, ["slug"]);
  const entityType = parseHealthLibraryEntityType(
    firstString(source, ["entityType", "entity_type"]),
  );

  if (!slug || !entityType) {
    return null;
  }

  return {
    aliases: firstStringArray(source, ["aliases"]),
    attributes,
    body,
    categories: firstStringArray(source, ["categories"]),
    entityType,
    key: firstString(source, ["key"]) ?? `${entityType}:${slug}`,
    relativePath,
    relations: parseRelations(source.relations),
    slug,
    status: firstString(source, ["status"]),
    summary: firstString(source, ["summary"]) ?? summarizeBody(body),
    title: firstString(source, ["title"]) ?? humanizeSlug(slug),
  };
}

function parseRelations(value: unknown): HealthCommonsRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const parsed = healthCommonsRelationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseHealthLibraryEntityType(
  value: string | null,
): HealthLibraryEntityType | null {
  if (!value || !HEALTH_LIBRARY_ENTITY_TYPES.has(value as HealthLibraryEntityType)) {
    return null;
  }

  return value as HealthLibraryEntityType;
}

function summarizeBody(body: string): string | null {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFailureToIssue(failure: ParseFailure): HealthLibraryGraphIssue {
  return {
    lineNumber: failure.lineNumber,
    parser: failure.parser,
    reason: failure.reason,
    relativePath: failure.relativePath,
  };
}
