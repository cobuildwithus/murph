import {
  parseFrontmatterDocument,
  parseFrontmatterScalar,
  type FrontmatterParseProblem,
  type FrontmatterValue,
} from "@murphai/contracts";

import { QueryVaultSourceError } from "./source-errors.ts";

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

export function parseMarkdownDocument(
  source: string,
  options: { relativePath?: string } = {},
): ParsedMarkdownDocument {
  const parsed = parseFrontmatterDocument(source, {
    mode: options.relativePath ? "strict" : "tolerant",
    bodyNormalization: "trim",
    allowSameIndentArrayItems: true,
    ...(options.relativePath
      ? {
          createError: (problem: FrontmatterParseProblem) =>
            new QueryVaultSourceError({
              issue: "frontmatter_invalid",
              relativePath: options.relativePath ?? "<vault-source>",
              ...(problem.index === undefined
                ? {}
                : { lineNumber: problem.index + 2 }),
            }),
        }
      : {}),
    isIgnorableLine: (line: string) => line.startsWith("#"),
    parseScalar: (value: string) => parseMarkdownScalar(value),
  });

  return {
    attributes: parsed.attributes,
    body: parsed.body,
    rawFrontmatter: parsed.rawFrontmatter,
  };
}
