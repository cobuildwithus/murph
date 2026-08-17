import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DESIGN_CATALOG_PATHS = new Set([
  "apps/web/app/design/components-content.tsx",
  "apps/web/app/design/consent-content.tsx",
  "apps/web/app/design/sections-content.tsx",
]);
const FRONTEND_ASSET_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu;
const GITHUB_MARKDOWN_URL = "https://api.github.com/markdown";
const IMPORT_PATTERN = /^[\t ]*import\b/gmu;
const METADATA_EXPORT_PATTERN = /^[\t ]*export[\t ]+(?:async[\t ]+)?(?:function|const|let|var)[\t ]+(generateMetadata|metadata)\b/gmu;
const ROUTE_HELPER_PATTERN = /^[\t ]*(?:(?:const|let|var)[\t ]+([A-Za-z_$][\w$]*)|(?:async[\t ]+)?function[\t ]+([A-Za-z_$][\w$]*))\b/gmu;

function isFrontendUiPath(filePath) {
  if (filePath.startsWith("apps/web/app/design/")) {
    return false;
  }
  if (filePath.startsWith("apps/web/app/api/")) {
    return false;
  }
  if (filePath === "apps/web/app/globals.css") {
    return true;
  }
  if (
    filePath.startsWith("apps/web/public/")
    && FRONTEND_ASSET_PATTERN.test(filePath)
  ) {
    return true;
  }
  if (
    filePath.startsWith("apps/web/app/")
    && (filePath.endsWith(".tsx") || filePath.endsWith(".css"))
  ) {
    return true;
  }
  return (
    filePath.startsWith("apps/web/src/components/")
    && (filePath.endsWith(".tsx") || filePath.endsWith(".css"))
  );
}

function renderedRouteSignature(source) {
  const importSpans = findDeclarationSpans(source, IMPORT_PATTERN);
  const withoutImports = stripSpans(source, importSpans);
  const removableMetadataSpans = findDeclarationSpans(
    withoutImports,
    METADATA_EXPORT_PATTERN,
  ).filter(({ end, isFunction, name, start }) =>
    name
      && (isFunction || !hasTopLevelComma(withoutImports, start, end))
      && !usesIdentifier(
        withoutImports.slice(0, start) + withoutImports.slice(end),
        name,
      )
  );
  const renderedBody = stripUnusedMetadataHelpers(
    stripSpans(withoutImports, removableMetadataSpans),
  );
  const imports = importSpans
    .map(({ end, start }) => source.slice(start, end))
    .filter((statement) => importAffectsRenderedBody(statement, renderedBody))
    .map((statement) => statement.replace(/\s+/gu, " ").trim());
  const body = renderedBody
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
  return JSON.stringify({ body, imports });
}

function stripUnusedMetadataHelpers(source) {
  let output = source;
  while (true) {
    const unusedSpans = findDeclarationSpans(output, ROUTE_HELPER_PATTERN)
      .filter(({ end, name, start }) =>
        name?.toLowerCase().includes("metadata")
          && !usesIdentifier(output.slice(0, start) + output.slice(end), name)
      );
    if (unusedSpans.length === 0) {
      return output;
    }
    output = stripSpans(output, unusedSpans);
  }
}

function importAffectsRenderedBody(statement, body) {
  if (/^[\t ]*import[\t ]*["']/u.test(statement)) {
    return true;
  }
  const clause = /^[\t ]*import[\t ]+(?:type[\t ]+)?([\s\S]*?)[\t ]+from[\t ]+["']/u
    .exec(statement)?.[1];
  if (!clause) {
    return true;
  }
  const names = clause.match(/[A-Za-z_$][\w$]*/gu) ?? [];
  return names.some((name) => !["as", "type"].includes(name) && usesIdentifier(body, name));
}

function usesIdentifier(source, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "u").test(source);
}

function findDeclarationSpans(source, pattern) {
  const spans = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const isFunction = /\bfunction\b/u.test(match[0]);
    const end = isFunction
      ? findFunctionEnd(source, pattern.lastIndex)
      : findStatementEnd(source, pattern.lastIndex);
    if (end === null) {
      continue;
    }
    spans.push({
      end,
      isFunction,
      name: match[1] ?? match[2] ?? null,
      start: match.index,
    });
    pattern.lastIndex = end;
  }
  return spans;
}

function hasTopLevelComma(source, start, end) {
  const depth = { "(": 0, "[": 0, "{": 0 };
  const closing = { ")": "(", "]": "[", "}": "{" };
  for (let index = start; index < end; index += 1) {
    const skippedTo = skipNonCode(source, index);
    if (skippedTo !== index) {
      index = skippedTo - 1;
      continue;
    }
    const character = source[index];
    if (Object.hasOwn(depth, character)) {
      depth[character] += 1;
    } else if (closing[character]) {
      depth[closing[character]] -= 1;
    } else if (
      character === ","
      && Object.values(depth).every((value) => value === 0)
    ) {
      return true;
    }
  }
  return false;
}

function findFunctionEnd(source, start) {
  let parentheses = 0;
  for (let index = start; index < source.length; index += 1) {
    const skippedTo = skipNonCode(source, index);
    if (skippedTo !== index) {
      index = skippedTo - 1;
      continue;
    }
    if (source[index] === "(") {
      parentheses += 1;
    } else if (source[index] === ")") {
      parentheses -= 1;
    } else if (source[index] === "{" && parentheses === 0) {
      return findClosingBrace(source, index);
    }
  }
  return null;
}

function findClosingBrace(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const skippedTo = skipNonCode(source, index);
    if (skippedTo !== index) {
      index = skippedTo - 1;
      continue;
    }
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return null;
}

function findStatementEnd(source, start) {
  const depth = { "(": 0, "[": 0, "{": 0 };
  const opening = new Set(Object.keys(depth));
  const closing = { ")": "(", "]": "[", "}": "{" };
  for (let index = start; index < source.length; index += 1) {
    const skippedTo = skipNonCode(source, index);
    if (skippedTo !== index) {
      index = skippedTo - 1;
      continue;
    }
    const character = source[index];
    if (opening.has(character)) {
      depth[character] += 1;
    } else if (closing[character]) {
      depth[closing[character]] -= 1;
    } else if (character === ";" && Object.values(depth).every((value) => value === 0)) {
      return index + 1;
    }
  }
  return null;
}

function skipNonCode(source, start) {
  const character = source[start];
  if (character === "/" && source[start + 1] === "/") {
    const end = source.indexOf("\n", start + 2);
    return end === -1 ? source.length : end;
  }
  if (character === "/" && source[start + 1] === "*") {
    const end = source.indexOf("*/", start + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (!["'", '"', "`"].includes(character)) {
    return start;
  }
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === character) {
      return index + 1;
    }
  }
  return source.length;
}

function stripSpans(source, spans) {
  let cursor = 0;
  let output = "";
  for (const { end, start } of spans) {
    output += source.slice(cursor, start);
    cursor = end;
  }
  return output + source.slice(cursor);
}

function validateFrontendDesignProof({
  changedPaths,
  prBodyHtml,
  uiPaths = changedPaths.filter(isFrontendUiPath),
}) {
  if (uiPaths.length === 0) {
    return { required: false };
  }

  const errors = [];
  const catalogUpdated = changedPaths.some((filePath) =>
    DESIGN_CATALOG_PATHS.has(filePath)
  );
  if (!catalogUpdated) {
    errors.push(
      "Update the design page component catalog or sections catalog for this frontend UI change.",
    );
  }

  const designProof = readRenderedSection(prBodyHtml, "Design proof");
  if (!designProof) {
    errors.push("Add a `## Design proof` section to the pull request body.");
  } else {
    if (!hasDesignPageItem(designProof)) {
      errors.push(
        "The Design proof section must link to `/design?tab=components`, `/design?tab=consent`, or `/design?tab=sections`.",
      );
    }
    if (!hasScreenshotItem(designProof, "Desktop screenshot")) {
      errors.push(
        "The Design proof section must include a hosted desktop screenshot from the design page.",
      );
    }
    if (!hasScreenshotItem(designProof, "Mobile screenshot")) {
      errors.push(
        "The Design proof section must include a hosted mobile screenshot from the design page.",
      );
    }
  }

  return { errors, required: true, uiPaths };
}

function readRenderedSection(html, heading) {
  const headingPattern = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/giu;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    if (renderedText(headingMatch[1]) !== heading) {
      continue;
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const trailingHtml = html.slice(sectionStart);
    const nextHeadingIndex = trailingHtml.search(/<h[12]\b/iu);
    const section = nextHeadingIndex >= 0
      ? trailingHtml.slice(0, nextHeadingIndex)
      : trailingHtml;
    return section.trim() || null;
  }
  return null;
}

function renderedText(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/gu, ""))
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:0*39|x0*27);/giu, "'");
}

function findRenderedListItem(section, label) {
  const listItemPattern = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu;
  let listItemMatch;
  while ((listItemMatch = listItemPattern.exec(section)) !== null) {
    if (renderedText(listItemMatch[1]).startsWith(`${label}:`)) {
      return listItemMatch[1];
    }
  }
  return null;
}

function hasDesignPageItem(section) {
  const item = findRenderedListItem(section, "Design page");
  if (!item) {
    return false;
  }
  const designRoute = /\/design\?tab=(?:components|consent|sections)(?:[#&\s"'<]|$)/iu;
  if (designRoute.test(renderedText(item))) {
    return true;
  }

  const anchorPattern = /<a\b([^>]*)>/giu;
  let anchorMatch;
  while ((anchorMatch = anchorPattern.exec(item)) !== null) {
    const href = readQuotedAttribute(anchorMatch[1], "href");
    if (href && designRoute.test(decodeHtmlEntities(href))) {
      return true;
    }
  }
  return false;
}

function readQuotedAttribute(attributes, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`,
    "iu",
  ).exec(attributes);
  return match?.[2] ?? null;
}

function hasScreenshotItem(section, label) {
  const item = findRenderedListItem(section, label);
  if (!item) {
    return false;
  }
  return /<img\b[^>]*\b(?:src|data-canonical-src)\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/iu.test(
    item,
  );
}

async function renderPrBody(markdown) {
  const endpoint = process.env.MURPH_GITHUB_MARKDOWN_URL?.trim()
    || GITHUB_MARKDOWN_URL;
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "murph-frontend-design-proof",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.MURPH_GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const payload = { mode: "gfm", text: markdown };
  const context = process.env.GITHUB_REPOSITORY?.trim();
  if (context) {
    payload.context = context;
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`GitHub Markdown rendering failed (${response.status}).`);
  }
  return response.text();
}

function readChangedPaths(baseSha, headSha) {
  return execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRT", `${baseSha}...${headSha}`],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readFrontendUiPaths(baseSha, headSha, changedPaths) {
  return changedPaths.filter((filePath) => {
    if (!isFrontendUiPath(filePath)) {
      return false;
    }
    if (!filePath.startsWith("apps/web/app/") || !filePath.endsWith(".tsx")) {
      return true;
    }
    const baseSource = readRevisionFile(baseSha, filePath);
    const headSource = readRevisionFile(headSha, filePath);
    if (baseSource === null || headSource === null) {
      return true;
    }
    return renderedRouteSignature(baseSource) !== renderedRouteSignature(headSource);
  });
}

function readRevisionFile(revision, filePath) {
  try {
    return execFileSync("git", ["show", `${revision}:${filePath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

async function main() {
  const baseSha = process.env.MURPH_PR_BASE_SHA?.trim();
  const headSha = process.env.MURPH_PR_HEAD_SHA?.trim();
  const prBody = process.env.MURPH_PR_BODY ?? "";
  if (!baseSha || !headSha) {
    throw new Error(
      "MURPH_PR_BASE_SHA and MURPH_PR_HEAD_SHA are required for frontend design proof validation.",
    );
  }

  const changedPaths = readChangedPaths(baseSha, headSha);
  const uiPaths = readFrontendUiPaths(baseSha, headSha, changedPaths);
  if (uiPaths.length === 0) {
    console.log("No user-facing hosted Web UI changes detected.");
    return;
  }
  const result = validateFrontendDesignProof({
    changedPaths,
    prBodyHtml: await renderPrBody(prBody),
    uiPaths,
  });
  if (result.errors.length > 0) {
    console.error("Frontend design proof is incomplete:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Frontend design proof passed for ${result.uiPaths.length} user-facing UI path(s).`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Frontend design proof failed.");
    process.exitCode = 1;
  }
}

export {
  findRenderedListItem,
  isFrontendUiPath,
  readChangedPaths,
  readFrontendUiPaths,
  readRenderedSection,
  renderPrBody,
  renderedRouteSignature,
  renderedText,
  validateFrontendDesignProof,
};
