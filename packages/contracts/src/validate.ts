import type { ZodType } from "zod";
import { ZodError } from "zod";

import type { FrontmatterParseProblem } from "./frontmatter.ts";
import { parseFrontmatterDocument } from "./frontmatter.ts";

type FrontmatterObjectValue = Record<string, string>;
type FrontmatterValue = string | string[] | FrontmatterObjectValue;

export type ContractSchema<TOutput = unknown> = ZodType<TOutput>;

export type ContractParseResult<TOutput> =
  | { success: true; data: TOutput }
  | { success: false; errors: string[] };

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "$";
  }

  return path.reduce<string>((current, segment) => {
    if (typeof segment === "number") {
      return `${current}[${segment}]`;
    }

    return `${current}.${String(segment)}`;
  }, "$");
}

function flattenError(error: ZodError): string[] {
  const messages: string[] = [];

  for (const issue of error.issues) {
    if (issue.code === "invalid_union") {
      for (const branch of issue.errors) {
        messages.push(...flattenError(new ZodError(branch)));
      }
      continue;
    }

    messages.push(`${formatPath(issue.path)}: ${issue.message}`);
  }

  return messages;
}

export function formatContractIssues(error: ZodError): string[] {
  return flattenError(error);
}

export function safeParseContract<TOutput>(
  schema: ContractSchema<TOutput>,
  value: unknown,
): ContractParseResult<TOutput> {
  const result = schema.safeParse(value);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: formatContractIssues(result.error),
  };
}

export function assertContract<TOutput>(
  schema: ContractSchema<TOutput>,
  value: unknown,
  label = "value",
): TOutput {
  const result = safeParseContract(schema, value);

  if (!result.success) {
    throw new TypeError(`${label} failed validation:\n${result.errors.join("\n")}`);
  }

  return result.data;
}

class FrontmatterMarkdownParseError extends TypeError {
  constructor(readonly problem: FrontmatterParseProblem) {
    super(problem.message);
    this.name = "FrontmatterMarkdownParseError";
  }
}

function projectLegacyFrontmatterAttributes(
  rawFrontmatter: string,
): Record<string, FrontmatterValue> {
  const lines = rawFrontmatter.split("\n");
  const result: Record<string, FrontmatterValue> = {};
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9]+):(?:\s(.*))?$/u.exec(line);
    if (!keyMatch) {
      throw new TypeError(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, rawValue = ""] = keyMatch;

    if (rawValue !== "") {
      result[key] = rawValue;
      index += 1;
      continue;
    }

    const objectEntries: FrontmatterObjectValue = {};
    const values: string[] = [];
    index += 1;

    while (index < lines.length && /^  - /u.test(lines[index] ?? "")) {
      values.push((lines[index] ?? "").slice(4));
      index += 1;
    }

    if (values.length > 0) {
      result[key] = values;
      continue;
    }

    while (index < lines.length) {
      const objectLine = lines[index] ?? "";
      const objectMatch = /^  ([A-Za-z0-9]+):\s(.*)$/u.exec(objectLine);
      if (!objectMatch) {
        break;
      }

      const [, objectKey, objectValue] = objectMatch;
      objectEntries[objectKey] = objectValue;
      index += 1;
    }

    result[key] = Object.keys(objectEntries).length > 0 ? objectEntries : values;
  }

  return result;
}

export function parseFrontmatterMarkdown(markdown: string): Record<string, FrontmatterValue> {
  const normalizedMarkdown = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");

  if (lines[0] !== "---") {
    throw new TypeError("Frontmatter must start with ---");
  }

  try {
    const parsed = parseFrontmatterDocument(normalizedMarkdown, {
      mode: "strict",
      parseScalar: (value) => value,
      createError: (problem) => new FrontmatterMarkdownParseError(problem),
    });

    return projectLegacyFrontmatterAttributes(parsed.rawFrontmatter ?? "");
  } catch (error) {
    if (error instanceof FrontmatterMarkdownParseError) {
      if (error.problem.code === "missing_closing_delimiter") {
        throw new TypeError("Frontmatter terminator --- not found");
      }

      if (error.problem.line) {
        throw new TypeError(`Unsupported frontmatter line: ${error.problem.line}`);
      }
    }

    throw error;
  }
}
