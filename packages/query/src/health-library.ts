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

export interface HealthLibraryParseIssue {
  kind: "parse";
  lineNumber?: number;
  parser: "frontmatter" | "json";
  reason: string;
  relativePath: string;
}

export interface HealthLibraryValidationIssue {
  field: "key" | "slug" | "entityType";
  kind: "validation";
  parser: "frontmatter";
  reason: string;
  relativePath: string;
}

export type HealthLibraryGraphIssue =
  | HealthLibraryParseIssue
  | HealthLibraryValidationIssue;

export interface HealthLibraryGraphReadResult {
  graph: HealthLibraryGraph;
  issues: HealthLibraryGraphIssue[];
}

const HEALTH_LIBRARY_ROOT = "bank/library";
const HEALTH_LIBRARY_ENTITY_TYPES = new Set<HealthLibraryEntityType>(HEALTH_COMMONS_ENTITY_TYPES);
type HealthLibraryLookupField = "key" | "slug";

export async function readHealthLibraryGraph(
  vaultRoot: string,
): Promise<HealthLibraryGraph> {
  const relativePaths = await walkRelativeFiles(vaultRoot, HEALTH_LIBRARY_ROOT, ".md");
  const nodes: HealthLibraryNode[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const outcome = toHealthLibraryNode(
      document.relativePath,
      document.body,
      document.attributes,
    );
    if (!outcome.ok) {
      throw toStrictHealthLibraryError(outcome.issue);
    }

    nodes.push(outcome.node);
  }

  nodes.sort(compareHealthLibraryNodes);

  return buildHealthLibraryGraph(nodes, false).graph;
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
    if (!node.ok) {
      issues.push(node.issue);
      continue;
    }

    nodes.push(node.node);
  }

  nodes.sort(compareHealthLibraryNodes);
  const graphResult = buildHealthLibraryGraph(nodes, true);
  issues.push(...graphResult.issues);

  return {
    graph: graphResult.graph,
    issues,
  };
}

function toHealthLibraryNode(
  relativePath: string,
  body: string,
  attributes: FrontmatterObject,
): { ok: true; node: HealthLibraryNode } | { ok: false; issue: HealthLibraryValidationIssue } {
  const slug = firstString(attributes, ["slug"]);
  if (!slug) {
    return {
      ok: false,
      issue: buildHealthLibraryValidationIssue(
        relativePath,
        "slug",
        "Health library page must declare a non-empty slug.",
      ),
    };
  }

  const entityTypeValue = firstString(attributes, ["entityType", "entity_type"]);
  const entityType = parseHealthLibraryEntityType(
    entityTypeValue,
  );

  if (!entityTypeValue) {
    return {
      ok: false,
      issue: buildHealthLibraryValidationIssue(
        relativePath,
        "entityType",
        "Health library page must declare a valid entityType.",
      ),
    };
  }

  if (!entityType) {
    return {
      ok: false,
      issue: buildHealthLibraryValidationIssue(
        relativePath,
        "entityType",
        `Health library entityType "${entityTypeValue}" is not supported.`,
      ),
    };
  }

  return {
    ok: true,
    node: {
      aliases: firstStringArray(attributes, ["aliases"]),
      attributes,
      body,
      categories: firstStringArray(attributes, ["categories"]),
      entityType,
      key: firstString(attributes, ["key"]) ?? `${entityType}:${slug}`,
      relativePath,
      relations: parseRelations(attributes.relations),
      slug,
      status: firstString(attributes, ["status"]),
      summary: firstString(attributes, ["summary"]) ?? summarizeBody(body),
      title: firstString(attributes, ["title"]) ?? humanizeSlug(slug),
    },
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

function buildHealthLibraryGraph(
  nodes: readonly HealthLibraryNode[],
  tolerateDuplicates: boolean,
): HealthLibraryGraphReadResult {
  const keyLookup = buildHealthLibraryLookup(nodes, "key");
  const slugLookup = buildHealthLibraryLookup(nodes, "slug");
  const issues = [...slugLookup.issues, ...keyLookup.issues];
  const firstIssue = issues[0];

  if (!tolerateDuplicates && firstIssue) {
    throw toStrictHealthLibraryError(firstIssue);
  }

  return {
    graph: {
      byKey: keyLookup.map,
      bySlug: slugLookup.map,
      nodes: [...nodes],
    },
    issues,
  };
}

function buildHealthLibraryLookup(
  nodes: readonly HealthLibraryNode[],
  field: HealthLibraryLookupField,
): {
  issues: HealthLibraryValidationIssue[];
  map: ReadonlyMap<string, HealthLibraryNode>;
} {
  const groups = new Map<string, HealthLibraryNode[]>();

  for (const node of nodes) {
    const value = node[field];
    const current = groups.get(value);
    if (current) {
      current.push(node);
      continue;
    }

    groups.set(value, [node]);
  }

  const map = new Map<string, HealthLibraryNode>();
  const issues: HealthLibraryValidationIssue[] = [];

  for (const [value, group] of groups) {
    if (group.length === 1) {
      const soleNode = group[0];
      if (soleNode) {
        map.set(value, soleNode);
      }
      continue;
    }

    issues.push(
      buildHealthLibraryValidationIssue(
        group[0]?.relativePath ?? HEALTH_LIBRARY_ROOT,
        field,
        `Duplicate health library ${field} "${value}" found in ${group
          .map((node) => node.relativePath)
          .join(", ")}; omitted from ${field === "slug" ? "bySlug" : "byKey"}.`,
      ),
    );
  }

  return {
    issues,
    map,
  };
}

function compareHealthLibraryNodes(
  left: HealthLibraryNode,
  right: HealthLibraryNode,
): number {
  const slugComparison = left.slug.localeCompare(right.slug);
  if (slugComparison !== 0) {
    return slugComparison;
  }

  const keyComparison = left.key.localeCompare(right.key);
  if (keyComparison !== 0) {
    return keyComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function parseFailureToIssue(failure: ParseFailure): HealthLibraryGraphIssue {
  return {
    kind: "parse",
    lineNumber: failure.lineNumber,
    parser: failure.parser,
    reason: failure.reason,
    relativePath: failure.relativePath,
  };
}

function buildHealthLibraryValidationIssue(
  relativePath: string,
  field: HealthLibraryValidationIssue["field"],
  reason: string,
): HealthLibraryValidationIssue {
  return {
    field,
    kind: "validation",
    parser: "frontmatter",
    reason,
    relativePath,
  };
}

function toStrictHealthLibraryError(
  issue: HealthLibraryValidationIssue,
): Error {
  return new Error(
    `Failed to validate frontmatter at ${issue.relativePath}: ${issue.reason}`,
  );
}
