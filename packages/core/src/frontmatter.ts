import { VaultError } from "./errors.js";

import { isPlainRecord } from "./types.js";

import type {
  FrontmatterDocument,
  FrontmatterObject,
  FrontmatterValue,
} from "./types.js";

interface MeaningfulLine {
  index: number;
  line: string;
  indent: number;
  text: string;
}

interface ParseResult<T> {
  value: T;
  index: number;
}

function isFrontmatterObject(value: unknown): value is FrontmatterObject {
  return isPlainRecord(value);
}

function countIndentation(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function stringifyScalar(value: FrontmatterValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    if (!value) {
      return "\"\"";
    }

    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value;
    }

    return JSON.stringify(value);
  }

  throw new VaultError(
    "VAULT_UNSUPPORTED_FRONTMATTER",
    "Frontmatter supports only scalars, arrays, and plain objects.",
    {
      valueType: typeof value,
    },
  );
}

function serializeNode(value: FrontmatterValue, indent = 0): string {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${padding}[]`;
    }

    return value
      .map((item) => {
        if (Array.isArray(item) || isFrontmatterObject(item)) {
          const nested = serializeNode(item, indent + 2);
          return `${padding}-\n${nested}`;
        }

        return `${padding}- ${stringifyScalar(item)}`;
      })
      .join("\n");
  }

  if (isFrontmatterObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return `${padding}{}`;
    }

    return entries
      .map(([key, entryValue]) => {
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          throw new VaultError("VAULT_INVALID_FRONTMATTER_KEY", `Invalid frontmatter key "${key}".`, {
            key,
          });
        }

        if (Array.isArray(entryValue) || isFrontmatterObject(entryValue)) {
          const nested = serializeNode(entryValue, indent + 2);

          if (nested.trim() === "[]") {
            return `${padding}${key}: []`;
          }

          if (nested.trim() === "{}") {
            return `${padding}${key}: {}`;
          }

          return `${padding}${key}:\n${nested}`;
        }

        return `${padding}${key}: ${stringifyScalar(entryValue)}`;
      })
      .join("\n");
  }

  return `${padding}${stringifyScalar(value)}`;
}

function parseScalar(value: string): FrontmatterValue {
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

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith("\"")) {
    return JSON.parse(value) as string;
  }

  return value;
}

function nextMeaningfulLine(lines: string[], startIndex: number): MeaningfulLine | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line?.trim()) {
      return {
        index,
        line,
        indent: countIndentation(line),
        text: line.trimStart(),
      };
    }
  }

  return null;
}

function parseArray(lines: string[], startIndex: number, indent: number): ParseResult<FrontmatterValue[]> {
  const value: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);

    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      throw new VaultError("VAULT_INVALID_FRONTMATTER", "Unexpected array indentation.", {
        line,
        index,
      });
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

    const nested = nextMeaningfulLine(lines, index);

    if (!nested || nested.indent <= indent) {
      value.push({});
      continue;
    }

    if (nested.indent !== indent + 2) {
      throw new VaultError("VAULT_INVALID_FRONTMATTER", "Unexpected nested array indentation.", {
        line: nested.line,
        index: nested.index,
      });
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(lines, nested.index, nested.indent);
      value.push(result.value);
      index = result.index;
      continue;
    }

    const result = parseObject(lines, nested.index, nested.indent);
    value.push(result.value);
    index = result.index;
  }

  return { value, index };
}

function parseObject(lines: string[], startIndex: number, indent: number): ParseResult<FrontmatterObject> {
  const value: FrontmatterObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndentation(line);

    if (currentIndent < indent) {
      break;
    }

    if (currentIndent !== indent) {
      throw new VaultError("VAULT_INVALID_FRONTMATTER", "Unexpected object indentation.", {
        line,
        index,
      });
    }

    const trimmed = line.slice(indent);

    if (trimmed.startsWith("-")) {
      break;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex <= 0) {
      throw new VaultError("VAULT_INVALID_FRONTMATTER", "Expected a \"key: value\" frontmatter line.", {
        line,
        index,
      });
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder) {
      value[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    index += 1;

    const nested = nextMeaningfulLine(lines, index);

    if (!nested || nested.indent <= indent) {
      value[key] = {};
      continue;
    }

    if (nested.indent !== indent + 2) {
      throw new VaultError("VAULT_INVALID_FRONTMATTER", "Unexpected nested object indentation.", {
        line: nested.line,
        index: nested.index,
      });
    }

    if (nested.text.startsWith("-")) {
      const result = parseArray(lines, nested.index, nested.indent);
      value[key] = result.value;
      index = result.index;
      continue;
    }

    const result = parseObject(lines, nested.index, nested.indent);
    value[key] = result.value;
    index = result.index;
  }

  return { value, index };
}

export function stringifyFrontmatterDocument(
  { attributes = {}, body = "" }: Partial<FrontmatterDocument> = {},
): string {
  if (!isFrontmatterObject(attributes)) {
    throw new VaultError("VAULT_INVALID_FRONTMATTER", "Frontmatter attributes must be a plain object.");
  }

  const header = Object.keys(attributes).length === 0 ? "" : serializeNode(attributes);
  const normalizedBody = String(body ?? "");
  return header ? `---\n${header}\n---\n${normalizedBody}` : `---\n---\n${normalizedBody}`;
}

export function parseFrontmatterDocument(documentText: string): FrontmatterDocument {
  const normalizedText = String(documentText ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n");

  if (lines[0] !== "---") {
    return {
      attributes: {},
      body: normalizedText,
    };
  }

  const closingIndex = lines.indexOf("---", 1);

  if (closingIndex === -1) {
    throw new VaultError("VAULT_INVALID_FRONTMATTER", "Frontmatter block is missing a closing delimiter.");
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n");

  if (frontmatterLines.length === 0 || frontmatterLines.every((line) => !line.trim())) {
    return {
      attributes: {},
      body,
    };
  }

  const parsed = parseObject(frontmatterLines, 0, 0);
  const remaining = nextMeaningfulLine(frontmatterLines, parsed.index);

  if (remaining) {
    throw new VaultError("VAULT_INVALID_FRONTMATTER", "Unexpected trailing frontmatter content.", {
      line: remaining.line,
      index: remaining.index,
    });
  }

  return {
    attributes: parsed.value,
    body,
  };
}
