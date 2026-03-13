export interface ParsedMarkdownDocument {
  attributes: Record<string, unknown>;
  body: string;
  rawFrontmatter: string | null;
}

// Parse a minimal frontmatter block without external dependencies.
export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  if (!source.startsWith("---\n")) {
    return {
      attributes: {},
      body: source.trim(),
      rawFrontmatter: null,
    };
  }

  const closingIndex = source.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return {
      attributes: {},
      body: source.trim(),
      rawFrontmatter: null,
    };
  }

  const rawFrontmatter = source.slice(4, closingIndex);
  const body = source.slice(closingIndex + 5).trim();

  return {
    attributes: parseFrontmatterBlock(rawFrontmatter),
    body,
    rawFrontmatter,
  };
}

function parseFrontmatterBlock(rawFrontmatter: string): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const lines = rawFrontmatter.split("\n");

  let activeListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("- ") && activeListKey) {
      const existingValue = attributes[activeListKey];
      const list = Array.isArray(existingValue) ? [...existingValue] : [];

      list.push(parseScalar(trimmed.slice(2)));
      attributes[activeListKey] = list;
      continue;
    }

    activeListKey = null;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (!rawValue) {
      attributes[key] = [];
      activeListKey = key;
      continue;
    }

    attributes[key] = parseScalar(rawValue);
  }

  return attributes;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "[]") {
    return [];
  }

  if (trimmed === "{}") {
    return {};
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}
