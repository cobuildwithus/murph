import {
  parseFrontmatterDocument,
  parseFrontmatterScalar,
  type FrontmatterValue,
} from "@murph/contracts";

export interface ParsedMarkdownDocument {
  attributes: Record<string, unknown>;
  body: string;
  rawFrontmatter: string | null;
}

function parseMarkdownScalar(value: string): FrontmatterValue {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return parseFrontmatterScalar(trimmed);
}

export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  const parsed = parseFrontmatterDocument(source, {
    mode: "tolerant",
    bodyNormalization: "trim",
    allowSameIndentArrayItems: true,
    isIgnorableLine: (line: string) => line.startsWith("#"),
    parseScalar: (value: string) => parseMarkdownScalar(value),
  });

  return {
    attributes: parsed.attributes,
    body: parsed.body,
    rawFrontmatter: parsed.rawFrontmatter,
  };
}
