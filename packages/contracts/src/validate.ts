import type { ZodType } from "zod";
import { ZodError } from "zod";

type FrontmatterValue = string | string[];

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

export function parseFrontmatterMarkdown(markdown: string): Record<string, FrontmatterValue> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new TypeError("Frontmatter must start with ---");
  }

  const result: Record<string, FrontmatterValue> = {};
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "---") {
      return result;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9]+):(?:\s(.*))?$/.exec(line);
    if (!keyMatch) {
      throw new TypeError(`Unsupported frontmatter line: ${line}`);
    }

    const [, key, rawValue = ""] = keyMatch;

    if (rawValue === "") {
      const values: string[] = [];
      index += 1;
      while (index < lines.length && /^  - /.test(lines[index])) {
        values.push(lines[index].slice(4));
        index += 1;
      }
      result[key] = values;
      continue;
    }

    result[key] = rawValue;
    index += 1;
  }

  throw new TypeError("Frontmatter terminator --- not found");
}
