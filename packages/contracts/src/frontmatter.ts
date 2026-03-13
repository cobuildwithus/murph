export type FrontmatterScalar = string | number | boolean | null;

export type FrontmatterValue =
  | FrontmatterScalar
  | FrontmatterObject
  | FrontmatterValue[];

export interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

export interface ParsedFrontmatterDocument {
  attributes: FrontmatterObject;
  body: string;
  rawFrontmatter: string | null;
}

export type FrontmatterParseProblemCode =
  | "missing_closing_delimiter"
  | "unexpected_array_indentation"
  | "unexpected_nested_array_indentation"
  | "unexpected_object_indentation"
  | "expected_key_value"
  | "unexpected_nested_object_indentation"
  | "unexpected_trailing_content";

export interface FrontmatterParseProblem {
  code: FrontmatterParseProblemCode;
  message: string;
  index?: number;
  line?: string;
}

export interface ParseFrontmatterDocumentOptions<TError extends Error = Error> {
  mode?: "strict" | "tolerant";
  bodyNormalization?: "preserve" | "trim";
  createError?: (problem: FrontmatterParseProblem) => TError;
  isIgnorableLine?: (line: string) => boolean;
  parseScalar?: (value: string) => FrontmatterValue;
  allowSameIndentArrayItems?: boolean;
}

interface MeaningfulLine {
  index: number;
  line: string;
  indent: number;
  text: string;
}

interface ParseResult<TValue> {
  value: TValue;
  index: number;
}

class FrontmatterParseFailure extends Error {
  constructor(readonly problem: FrontmatterParseProblem) {
    super(problem.message);
    this.name = "FrontmatterParseFailure";
  }
}

function countIndentation(line: string): number {
  const match = line.match(/^ */u);
  return match ? match[0].length : 0;
}

function shouldSkipLine(
  line: string,
  isIgnorableLine: ((line: string) => boolean) | undefined,
): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || isIgnorableLine?.(trimmed) === true;
}

function createProblem(
  code: FrontmatterParseProblemCode,
  line?: string,
  index?: number,
): FrontmatterParseProblem {
  switch (code) {
    case "missing_closing_delimiter":
      return {
        code,
        message: "Frontmatter block is missing a closing delimiter.",
      };
    case "unexpected_array_indentation":
      return {
        code,
        message: "Unexpected array indentation.",
        line,
        index,
      };
    case "unexpected_nested_array_indentation":
      return {
        code,
        message: "Unexpected nested array indentation.",
        line,
        index,
      };
    case "unexpected_object_indentation":
      return {
        code,
        message: "Unexpected object indentation.",
        line,
        index,
      };
    case "expected_key_value":
      return {
        code,
        message: "Expected a \"key: value\" frontmatter line.",
        line,
        index,
      };
    case "unexpected_nested_object_indentation":
      return {
        code,
        message: "Unexpected nested object indentation.",
        line,
        index,
      };
    case "unexpected_trailing_content":
      return {
        code,
        message: "Unexpected trailing frontmatter content.",
        line,
        index,
      };
  }
}

function fail(problem: FrontmatterParseProblem): never {
  throw new FrontmatterParseFailure(problem);
}

export function parseFrontmatterScalar(value: string): FrontmatterValue {
  if (value === "null") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "[]") {
    return [];
  }

  if (value === "{}") {
    return {};
  }

  if (/^-?\d+(\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  if (value.startsWith("\"")) {
    return JSON.parse(value) as string;
  }

  return value;
}

function nextMeaningfulLine(
  lines: string[],
  startIndex: number,
  isIgnorableLine: ((line: string) => boolean) | undefined,
): MeaningfulLine | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (shouldSkipLine(line, isIgnorableLine)) {
      continue;
    }

    return {
      index,
      line,
      indent: countIndentation(line),
      text: line.trimStart(),
    };
  }

  return null;
}

function parseArray(
  lines: string[],
  startIndex: number,
  indent: number,
  isIgnorableLine: ((line: string) => boolean) | undefined,
  parseScalar: (value: string) => FrontmatterValue,
  allowSameIndentArrayItems: boolean,
): ParseResult<FrontmatterValue[]> {
  const value: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (shouldSkipLine(line, isIgnorableLine)) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);

    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      fail(createProblem("unexpected_array_indentation", line, index));
    }

    const trimmed = line.slice(indent);

    if (!trimmed.startsWith("-")) {
      break;
    }

    const remainder = trimmed.slice(1).trimStart();

    if (remainder) {
      value.push(parseScalar(remainder));
      index += 1;
      continue;
    }

    index += 1;

    const nested = nextMeaningfulLine(lines, index, isIgnorableLine);

    if (!nested || nested.indent <= indent) {
      value.push({});
      continue;
    }

    if (nested.indent !== indent + 2) {
      fail(createProblem("unexpected_nested_array_indentation", nested.line, nested.index));
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(
        lines,
        nested.index,
        nested.indent,
        isIgnorableLine,
        parseScalar,
        allowSameIndentArrayItems,
      );
      value.push(result.value);
      index = result.index;
      continue;
    }

    const result = parseObject(
      lines,
      nested.index,
      nested.indent,
      isIgnorableLine,
      parseScalar,
      allowSameIndentArrayItems,
    );
    value.push(result.value);
    index = result.index;
  }

  return { value, index };
}

function parseObject(
  lines: string[],
  startIndex: number,
  indent: number,
  isIgnorableLine: ((line: string) => boolean) | undefined,
  parseScalar: (value: string) => FrontmatterValue,
  allowSameIndentArrayItems: boolean,
): ParseResult<FrontmatterObject> {
  const value: FrontmatterObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (shouldSkipLine(line, isIgnorableLine)) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);

    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      fail(createProblem("unexpected_object_indentation", line, index));
    }

    const trimmed = line.slice(indent);

    if (trimmed.startsWith("-")) {
      break;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex <= 0) {
      fail(createProblem("expected_key_value", line, index));
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder) {
      value[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    index += 1;

    const nested = nextMeaningfulLine(lines, index, isIgnorableLine);

    if (!nested || nested.indent < indent) {
      value[key] = {};
      continue;
    }

    if (allowSameIndentArrayItems && nested.text.startsWith("-") && nested.indent === indent) {
      const result = parseArray(
        lines,
        nested.index,
        nested.indent,
        isIgnorableLine,
        parseScalar,
        allowSameIndentArrayItems,
      );
      value[key] = result.value;
      index = result.index;
      continue;
    }

    if (nested.indent <= indent) {
      value[key] = {};
      continue;
    }

    if (nested.indent !== indent + 2) {
      fail(createProblem("unexpected_nested_object_indentation", nested.line, nested.index));
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(
        lines,
        nested.index,
        nested.indent,
        isIgnorableLine,
        parseScalar,
        allowSameIndentArrayItems,
      );
      value[key] = result.value;
      index = result.index;
      continue;
    }

    const result = parseObject(
      lines,
      nested.index,
      nested.indent,
      isIgnorableLine,
      parseScalar,
      allowSameIndentArrayItems,
    );
    value[key] = result.value;
    index = result.index;
  }

  return { value, index };
}

function normalizeBody(body: string, mode: "preserve" | "trim"): string {
  return mode === "trim" ? body.trim() : body;
}

export function parseFrontmatterDocument<TError extends Error = Error>(
  documentText: string,
  {
    mode = "strict",
    bodyNormalization = "preserve",
    createError,
    isIgnorableLine,
    parseScalar = parseFrontmatterScalar,
    allowSameIndentArrayItems = false,
  }: ParseFrontmatterDocumentOptions<TError> = {},
): ParsedFrontmatterDocument {
  const normalizedText = String(documentText ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n");
  const createThrownError = (problem: FrontmatterParseProblem): TError =>
    createError ? createError(problem) : (new Error(problem.message) as TError);
  const tolerantFallback = (): ParsedFrontmatterDocument => ({
    attributes: {},
    body: normalizeBody(normalizedText, bodyNormalization),
    rawFrontmatter: null,
  });

  if (lines[0] !== "---") {
    return tolerantFallback();
  }

  const closingIndex = lines.indexOf("---", 1);

  if (closingIndex === -1) {
    if (mode === "tolerant") {
      return tolerantFallback();
    }

    throw createThrownError(createProblem("missing_closing_delimiter"));
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = normalizeBody(lines.slice(closingIndex + 1).join("\n"), bodyNormalization);

  if (frontmatterLines.length === 0 || frontmatterLines.every((line) => shouldSkipLine(line, isIgnorableLine))) {
    return {
      attributes: {},
      body,
      rawFrontmatter: frontmatterLines.join("\n"),
    };
  }

  try {
    const parsed = parseObject(
      frontmatterLines,
      0,
      0,
      isIgnorableLine,
      parseScalar,
      allowSameIndentArrayItems,
    );
    const remaining = nextMeaningfulLine(frontmatterLines, parsed.index, isIgnorableLine);

    if (remaining) {
      fail(createProblem("unexpected_trailing_content", remaining.line, remaining.index));
    }

    return {
      attributes: parsed.value,
      body,
      rawFrontmatter: frontmatterLines.join("\n"),
    };
  } catch (error) {
    if (error instanceof FrontmatterParseFailure) {
      if (mode === "tolerant") {
        return tolerantFallback();
      }

      throw createThrownError(error.problem);
    }

    throw error;
  }
}
