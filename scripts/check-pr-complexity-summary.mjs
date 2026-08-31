import { pathToFileURL } from "node:url";

import {
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const SECTION_HEADING = "Complexity impact";
const REQUIRED_ITEMS = ["Guard", "Hotspots", "Agent judgment"];
const PLACEHOLDER_VALUES = new Set([
  "",
  "na",
  "none",
  "notapplicable",
  "tbd",
  "todo",
]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
  ".wrangler",
  "__tests__",
  "coverage",
  "dist",
  "e2e",
  "fixtures",
  "generated",
  "node_modules",
  "test",
  "tests",
]);
const EXCLUDED_FILE_PATTERN = /(?:^|\.)(?:gen|generated|spec|test)\.[cm]?[jt]sx?$/u;

function countRenderedSections(html, heading) {
  const headingPattern = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/giu;
  let count = 0;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    if (renderedText(headingMatch[1]) === heading) {
      count += 1;
    }
  }
  return count;
}

function findRenderedListItems(section, label) {
  const matches = [];
  const listItemPattern = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu;
  let listItemMatch;
  while ((listItemMatch = listItemPattern.exec(section)) !== null) {
    if (renderedText(listItemMatch[1]).startsWith(`${label}:`)) {
      matches.push(listItemMatch[1]);
    }
  }
  return matches;
}

function readItemValue(item, label) {
  return renderedText(item).slice(`${label}:`.length).trim();
}

function isConcreteValue(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
  return value.length >= 16 && !PLACEHOLDER_VALUES.has(normalized);
}

function validatePrComplexitySummary({ changedPaths, prBodyHtml }) {
  const errors = [];
  const sectionCount = countRenderedSections(prBodyHtml, SECTION_HEADING);
  if (sectionCount === 0) {
    return ["Add a `## Complexity impact` section to the pull request body."];
  }
  if (sectionCount > 1) {
    errors.push(
      "Keep exactly one `## Complexity impact` section in the pull request body.",
    );
  }

  const section = readRenderedSection(prBodyHtml, SECTION_HEADING);
  if (!section) {
    errors.push("Complete the `## Complexity impact` section.");
    return errors;
  }

  const values = new Map();
  for (const label of REQUIRED_ITEMS) {
    const items = findRenderedListItems(section, label);
    if (items.length !== 1) {
      errors.push(`Add exactly one \`${label}:\` bullet.`);
      continue;
    }
    const value = readItemValue(items[0], label);
    values.set(label, value);
    if (!isConcreteValue(value)) {
      errors.push(`Complete \`${label}:\` with a concrete sentence.`);
    }
  }

  const guardValue = values.get("Guard") ?? "";
  const hasAuthoredSource = changedPaths.some(isCyclomaticSourcePath);
  if (hasAuthoredSource) {
    if (!/^pass\b/iu.test(guardValue)) {
      errors.push(
        "Set `Guard:` to `pass` for authored JavaScript or TypeScript changes.",
      );
    }
    if (!/\bpnpm\s+complexity:diff\b/iu.test(guardValue)) {
      errors.push(
        "Name `pnpm complexity:diff` in `Guard:` for authored JavaScript or TypeScript changes.",
      );
    }
  } else if (!/^(?:pass|not applicable)\b/iu.test(guardValue)) {
    errors.push(
      "Set `Guard:` to `pass` or `not applicable` with a reason.",
    );
  }

  return errors;
}

function isCyclomaticSourcePath(filePath) {
  const normalizedPath = filePath.replace(/\\/gu, "/");
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? "";
  if (
    segments.some((segment) =>
      EXCLUDED_DIRECTORIES.has(segment) || segment.startsWith(".next")
    )
  ) {
    return false;
  }
  if (/\.d\.[cm]?ts$/u.test(fileName) || EXCLUDED_FILE_PATTERN.test(fileName)) {
    return false;
  }
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : "";
  return SOURCE_EXTENSIONS.has(extension);
}

async function main() {
  const baseSha = process.env.MURPH_PR_BASE_SHA?.trim();
  const headSha = process.env.MURPH_PR_HEAD_SHA?.trim();
  if (!baseSha || !headSha) {
    throw new Error(
      "MURPH_PR_BASE_SHA and MURPH_PR_HEAD_SHA are required for complexity evidence validation.",
    );
  }
  const errors = validatePrComplexitySummary({
    changedPaths: readChangedPaths(baseSha, headSha, { detectRenames: false }),
    prBodyHtml: await renderPrBody(process.env.MURPH_PR_BODY ?? ""),
  });
  if (errors.length > 0) {
    console.error("Pull request complexity impact is incomplete:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Pull request complexity impact passed.");
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Pull request complexity impact validation failed.",
    );
    process.exitCode = 1;
  }
}

export {
  isCyclomaticSourcePath,
  REQUIRED_ITEMS,
  validatePrComplexitySummary,
};
