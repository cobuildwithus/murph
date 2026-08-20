import { pathToFileURL } from "node:url";

import {
  findRenderedListItem,
  readChangedPaths,
  readMergeBase,
  readRenderedSection,
  readTextFileAtRevision,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const FRONTEND_ASSET_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu;
const NEXT_ROUTE_MODULE_PATTERN =
  /^apps\/web\/app\/(?:.*\/)?(?:layout|page)\.tsx$/u;
const STATIC_METADATA_START_PATTERN =
  /^export const metadata(?:\s*:\s*Metadata)?\s*=\s*(?=\{)/gmu;
const TYPE_ONLY_IMPORT_PATTERN = /^import\s+type\b[^\n;]*;[ \t]*(?:\n|$)/gmu;
const DISALLOWED_PRESENTATION_METADATA_KEYS = new Set([
  "appleWebApp",
  "color-scheme",
  "colorScheme",
  "formatDetection",
  "theme-color",
  "themeColor",
  "viewport",
]);
const INDIRECT_MODULE_ACCESS_PATTERN =
  /(?:\bimport\s*(?:\(|\*)|\brequire\s*\(|\bexports\b)/u;

function isFrontendUiPath(filePath) {
  if (
    filePath.startsWith("apps/web/app/design/") ||
    filePath.startsWith("apps/web/app/screenshots/") ||
    filePath.startsWith("apps/web/app/api/")
  ) {
    return false;
  }
  if (filePath === "apps/web/app/globals.css") {
    return true;
  }
  if (
    filePath.startsWith("apps/web/public/") &&
    FRONTEND_ASSET_PATTERN.test(filePath)
  ) {
    return true;
  }
  if (
    filePath.startsWith("apps/web/app/") &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".css"))
  ) {
    return true;
  }
  return (
    filePath.startsWith("apps/web/src/components/") &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".css"))
  );
}

// This check runs before dependency installation, so ambiguous TSX stays proof-required.
// Accept only a literal metadata subset and compare all remaining runtime source.
function skipTrivia(source, cursor) {
  let index = cursor;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        return -1;
      }
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readQuotedToken(source, cursor) {
  const quote = source[cursor];
  let escaped = false;
  let index = cursor + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      escaped = true;
      index += 2;
      continue;
    }
    if (character === quote) {
      return {
        end: index + 1,
        escaped,
        value: source.slice(cursor + 1, index),
      };
    }
    if (quote !== "`" && (character === "\n" || character === "\r")) {
      return null;
    }
    if (quote === "`" && source.startsWith("${", index)) {
      return null;
    }
    index += 1;
  }
  return null;
}

function readIdentifierToken(source, cursor) {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(source.slice(cursor));
  if (!match) {
    return null;
  }
  return { end: cursor + match[0].length, value: match[0] };
}

function readNumberToken(source, cursor) {
  const match = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
    source.slice(cursor),
  );
  if (!match) {
    return null;
  }
  return { end: cursor + match[0].length, value: match[0] };
}

function parseStaticMetadataValue(source, cursor, keys, depth = 0) {
  if (depth > 64) {
    return null;
  }
  let index = skipTrivia(source, cursor);
  if (index < 0 || index >= source.length) {
    return null;
  }

  const character = source[index];
  if (character === '"' || character === "'" || character === "`") {
    return readQuotedToken(source, index)?.end ?? null;
  }
  if (character === "+" || character === "-") {
    const numberStart = skipTrivia(source, index + 1);
    if (numberStart < 0) {
      return null;
    }
    const number = readNumberToken(source, numberStart);
    return number?.end ?? null;
  }
  if (character === "(") {
    const valueEnd = parseStaticMetadataValue(source, index + 1, keys, depth + 1);
    if (valueEnd === null) {
      return null;
    }
    index = skipTrivia(source, valueEnd);
    return source[index] === ")" ? index + 1 : null;
  }
  if (character === "[") {
    index = skipTrivia(source, index + 1);
    if (source[index] === "]") {
      return index + 1;
    }
    while (index >= 0 && index < source.length) {
      const valueEnd = parseStaticMetadataValue(source, index, keys, depth + 1);
      if (valueEnd === null) {
        return null;
      }
      index = skipTrivia(source, valueEnd);
      if (source[index] === "]") {
        return index + 1;
      }
      if (source[index] !== ",") {
        return null;
      }
      index = skipTrivia(source, index + 1);
      if (source[index] === "]") {
        return index + 1;
      }
    }
    return null;
  }
  if (character === "{") {
    index = skipTrivia(source, index + 1);
    if (source[index] === "}") {
      return index + 1;
    }
    while (index >= 0 && index < source.length) {
      let key;
      if (
        source[index] === '"' ||
        source[index] === "'" ||
        source[index] === "`"
      ) {
        const quoted = readQuotedToken(source, index);
        if (!quoted || quoted.escaped) {
          return null;
        }
        key = quoted.value;
        index = quoted.end;
      } else {
        const identifier = readIdentifierToken(source, index);
        const number = identifier ? null : readNumberToken(source, index);
        const token = identifier ?? number;
        if (!token) {
          return null;
        }
        key = token.value;
        index = token.end;
      }
      keys.add(key);
      index = skipTrivia(source, index);
      if (source[index] !== ":") {
        return null;
      }
      const valueEnd = parseStaticMetadataValue(source, index + 1, keys, depth + 1);
      if (valueEnd === null) {
        return null;
      }
      index = skipTrivia(source, valueEnd);
      if (source[index] === "}") {
        return index + 1;
      }
      if (source[index] !== ",") {
        return null;
      }
      index = skipTrivia(source, index + 1);
      if (source[index] === "}") {
        return index + 1;
      }
    }
    return null;
  }

  const identifier = readIdentifierToken(source, index);
  if (
    identifier &&
    (identifier.value === "false" ||
      identifier.value === "null" ||
      identifier.value === "true")
  ) {
    return identifier.end;
  }
  const number = readNumberToken(source, index);
  return number?.end ?? null;
}

function prefixIsPlainTopLevelModuleSource(source, end) {
  let state = "code";
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote") {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"')
      ) {
        state = "code";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      state = "double-quote";
      continue;
    }
    if (character === "`") {
      return false;
    }
    if (character === "/") {
      return false;
    }
    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}") {
      braceDepth -= 1;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth -= 1;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")") {
      parenthesisDepth -= 1;
    }
    if (braceDepth < 0 || bracketDepth < 0 || parenthesisDepth < 0) {
      return false;
    }
  }

  return (
    state === "code" &&
    braceDepth === 0 &&
    bracketDepth === 0 &&
    parenthesisDepth === 0
  );
}

function topLevelTypeImportRanges(source) {
  TYPE_ONLY_IMPORT_PATTERN.lastIndex = 0;
  return [...source.matchAll(TYPE_ONLY_IMPORT_PATTERN)]
    .filter((match) => prefixIsPlainTopLevelModuleSource(source, match.index))
    .map((match) => ({
      end: match.index + match[0].length,
      start: match.index,
    }));
}

function expandDeclarationRemoval(source, start, end) {
  let removeEnd = end;
  if (source[removeEnd] === "\r" && source[removeEnd + 1] === "\n") {
    removeEnd += 2;
  } else if (source[removeEnd] === "\n") {
    removeEnd += 1;
  }
  while (removeEnd < source.length) {
    const blankLine = /^[ \t]*(?:\r?\n|$)/u.exec(source.slice(removeEnd));
    if (!blankLine || blankLine[0].length === 0) {
      break;
    }
    removeEnd += blankLine[0].length;
  }
  return { end: removeEnd, start };
}

function findStaticMetadataDeclaration(source) {
  STATIC_METADATA_START_PATTERN.lastIndex = 0;
  const matches = [...source.matchAll(STATIC_METADATA_START_PATTERN)];
  if (matches.length !== 1) {
    return null;
  }
  const match = matches[0];
  if (!prefixIsPlainTopLevelModuleSource(source, match.index)) {
    return null;
  }
  const expressionStart = match.index + match[0].length;
  const keys = new Set();
  const expressionEnd = parseStaticMetadataValue(
    source,
    expressionStart,
    keys,
  );
  if (expressionEnd === null) {
    return null;
  }
  const semicolon = skipTrivia(source, expressionEnd);
  if (semicolon < 0 || source[semicolon] !== ";") {
    return null;
  }
  if (
    [...keys].some((key) =>
      DISALLOWED_PRESENTATION_METADATA_KEYS.has(key),
    )
  ) {
    return null;
  }
  return expandDeclarationRemoval(source, match.index, semicolon + 1);
}

function removeRanges(source, ranges) {
  let result = "";
  let cursor = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    result += source.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + source.slice(cursor);
}

function routeSourceWithoutStaticMetadata(source) {
  const normalized = source.replace(/\r\n?/gu, "\n");
  const metadataMentions = normalized.match(/\bexport\s+const\s+metadata\b/gu);
  const declaration = findStaticMetadataDeclaration(normalized);
  if ((metadataMentions?.length ?? 0) !== (declaration ? 1 : 0)) {
    return null;
  }

  const typeImportRanges = topLevelTypeImportRanges(normalized);
  const ranges = declaration
    ? [...typeImportRanges, declaration]
    : typeImportRanges;
  const signature = removeRanges(normalized, ranges)
    .replace(/^(?:[ \t]*\n)+/u, "")
    .replace(/(?:\n[ \t]*)+$/u, "");
  if (
    declaration &&
    (/\b(?:eval|metadata)\b/u.test(signature) ||
      /\\u(?:\{|[0-9A-Fa-f])/u.test(signature) ||
      INDIRECT_MODULE_ACCESS_PATTERN.test(signature))
  ) {
    return null;
  }
  return { hasStaticMetadata: declaration !== null, signature };
}

function isStaticMetadataOnlyRouteChange({ baseSource, headSource, path }) {
  if (
    !NEXT_ROUTE_MODULE_PATTERN.test(path) ||
    typeof baseSource !== "string" ||
    typeof headSource !== "string" ||
    baseSource === headSource
  ) {
    return false;
  }
  const base = routeSourceWithoutStaticMetadata(baseSource);
  const head = routeSourceWithoutStaticMetadata(headSource);
  return Boolean(
    base &&
      head &&
      (base.hasStaticMetadata || head.hasStaticMetadata) &&
      base.signature === head.signature,
  );
}

function isFrontendUiChange(change) {
  return (
    isFrontendUiPath(change.path) &&
    !isStaticMetadataOnlyRouteChange(change)
  );
}

function isExplicitProofAbsence(value) {
  return /(?:^(?:n\/?a|none|not applicable|pending|tbd|todo)\b|^(?:no|without)\s+(?:direct\s+)?(?:evidence|proof)\b|\b(?:evidence|proof)\s+(?:is\s+|was\s+|remains\s+)?(?:missing|pending|unavailable|uncaptured|not\s+(?:captured|collected|provided))\b|\b(?:not|never)\s+(?:checked|tested|inspected|verified)\b|\b(?:will be|to be)\s+(?:added|captured|collected|provided)\b)/iu.test(
    value,
  );
}

function hasMeaningfulListItem(section, label) {
  const item = findRenderedListItem(section, label);
  if (!item) {
    return false;
  }
  const value = renderedText(item).slice(`${label}:`.length).trim();
  return value.length >= 8 && !isExplicitProofAbsence(value);
}

function normalizeChangedFiles({ changedFiles, changedPaths }) {
  if (changedFiles) {
    return changedFiles;
  }
  return (changedPaths ?? []).map((path) => ({ path }));
}

function validateFrontendEvidence({
  changedFiles,
  changedPaths,
  prBodyHtml,
}) {
  const uiPaths = normalizeChangedFiles({ changedFiles, changedPaths })
    .filter(isFrontendUiChange)
    .map((change) => change.path);
  if (uiPaths.length === 0) {
    return { required: false };
  }

  const errors = [];
  const evidence = readRenderedSection(prBodyHtml, "Evidence");
  if (!evidence) {
    errors.push("Add an `## Evidence` section to the pull request body.");
  } else {
    if (!hasMeaningfulListItem(evidence, "Direct")) {
      errors.push(
        "Add a `Direct:` list item under `## Evidence` naming proof matched to the changed frontend claim.",
      );
    }
    if (!hasMeaningfulListItem(evidence, "Coverage")) {
      errors.push(
        "Add a `Coverage:` list item under `## Evidence` explaining which states and viewports were checked and why that proof is sufficient.",
      );
    }
  }

  return { errors, required: true, uiPaths };
}

function readChangedFiles(baseSha, headSha) {
  const paths = readChangedPaths(baseSha, headSha);
  const comparisonBase = paths.some((path) =>
    NEXT_ROUTE_MODULE_PATTERN.test(path),
  )
    ? readMergeBase(baseSha, headSha)
    : null;
  return paths.map((path) => {
    if (!NEXT_ROUTE_MODULE_PATTERN.test(path)) {
      return { path };
    }
    return {
      baseSource: readTextFileAtRevision(comparisonBase, path),
      headSource: readTextFileAtRevision(headSha, path),
      path,
    };
  });
}

async function main() {
  const baseSha = process.env.MURPH_PR_BASE_SHA?.trim();
  const headSha = process.env.MURPH_PR_HEAD_SHA?.trim();
  const prBody = process.env.MURPH_PR_BODY ?? "";
  if (!baseSha || !headSha) {
    throw new Error(
      "MURPH_PR_BASE_SHA and MURPH_PR_HEAD_SHA are required for frontend evidence validation.",
    );
  }

  const changedFiles = readChangedFiles(baseSha, headSha);
  if (!changedFiles.some(isFrontendUiChange)) {
    console.log("No user-facing hosted Web UI changes detected.");
    return;
  }
  const result = validateFrontendEvidence({
    changedFiles,
    prBodyHtml: await renderPrBody(prBody),
  });
  if (result.errors.length > 0) {
    console.error("Frontend evidence is incomplete:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Frontend evidence passed for ${result.uiPaths.length} user-facing UI path(s).`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Frontend evidence failed.",
    );
    process.exitCode = 1;
  }
}

export {
  isFrontendUiChange,
  isFrontendUiPath,
  isStaticMetadataOnlyRouteChange,
  validateFrontendEvidence,
};
