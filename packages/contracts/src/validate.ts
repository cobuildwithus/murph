import type { ZodType } from "zod";
import { ZodError } from "zod";

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
