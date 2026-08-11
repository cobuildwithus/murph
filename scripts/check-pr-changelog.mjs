import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./check-frontend-design-proof.mjs";

const CHANGELOG_ENTRY_PREFIX = "apps/web/changelog/entries/";
const CHANGELOG_EDITION_PREFIX = "apps/web/changelog/editions/";
const LEGACY_CHANGELOG_PATH = "apps/web/src/lib/changelog.ts";
const CHANGELOG_CONTENT_DESCRIPTION =
  "changelog entries, edition metadata, or the legacy registry";
const SECTION_HEADING = "Changelog";
const VALID_DISPOSITIONS = new Set(["not applicable", "updated"]);
const ITEM_REFERENCE_PATTERN =
  /^(\d{4}-\d{2}-\d{2})\s*[·,:/+]\s*([a-z0-9]+(?:-[a-z0-9]+)+)$/u;
const PLACEHOLDER_VALUES = new Set([
  "",
  "internal",
  "na",
  "none",
  "notapplicable",
  "notneeded",
  "tbd",
  "todo",
]);

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

function findClosingDelimiter(source, openIndex) {
  const open = source[openIndex];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) {
    throw new Error("The changelog registry parser received an invalid delimiter.");
  }

  let depth = 0;
  let escaped = false;
  let quote = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("The changelog registry contains an unclosed entry.");
}

function readTopLevelObjects(arraySource) {
  const objects = [];
  let index = 1;
  while (index < arraySource.length - 1) {
    const character = arraySource[index];
    if (/[,\s]/u.test(character)) {
      index += 1;
      continue;
    }
    if (character !== "{") {
      throw new Error("The changelog registry contains an unsupported entry.");
    }
    const closeIndex = findClosingDelimiter(arraySource, index);
    objects.push(arraySource.slice(index, closeIndex + 1));
    index = closeIndex + 1;
  }
  return objects;
}

function readStringProperty(objectSource, propertyName) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${propertyName}:\\s*"([^"]+)"`,
    "u",
  );
  return pattern.exec(objectSource)?.[1] ?? null;
}

function readArrayProperty(objectSource, propertyName) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${propertyName}:\\s*\\[`, "u");
  const match = pattern.exec(objectSource);
  if (!match) {
    return null;
  }
  const openIndex = match.index + match[0].lastIndexOf("[");
  const closeIndex = findClosingDelimiter(objectSource, openIndex);
  return objectSource.slice(openIndex, closeIndex + 1);
}

function readChangelogItemsById(
  sourceText = readFileSync(
    new URL("../apps/web/src/lib/changelog.ts", import.meta.url),
    "utf8",
  ),
  fragmentsRoot = new URL("../apps/web/changelog/entries/", import.meta.url),
) {
  const registryMatch = /const LEGACY_CHANGELOG_EDITIONS\s*=\s*\[/u.exec(sourceText);
  if (!registryMatch) {
    throw new Error("Could not read the legacy changelog registry.");
  }
  const openIndex = registryMatch.index + registryMatch[0].lastIndexOf("[");
  const closeIndex = findClosingDelimiter(sourceText, openIndex);
  const editions = readTopLevelObjects(sourceText.slice(openIndex, closeIndex + 1));

  const itemsById = new Map();
  for (const editionSource of editions) {
    const editionId = readStringProperty(editionSource, "id");
    const itemsSource = readArrayProperty(editionSource, "items");
    const items = itemsSource ? readTopLevelObjects(itemsSource) : null;
    if (!editionId || !items) {
      throw new Error("The changelog registry contains an incomplete edition entry.");
    }
    for (const itemSource of items) {
      const itemId = readStringProperty(itemSource, "id");
      if (!itemId) {
        throw new Error("The changelog registry contains an item without a stable ID.");
      }
      if (itemsById.has(itemId)) {
        throw new Error(`The changelog registry repeats the item ID \`${itemId}\`.`);
      }
      itemsById.set(itemId, editionId);
    }
  }

  for (const dateEntry of readdirSync(fragmentsRoot, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) {
      throw new Error("The changelog fragment root contains an unsupported entry.");
    }
    const dateRoot = new URL(`${dateEntry.name}/`, fragmentsRoot);
    for (const fileEntry of readdirSync(dateRoot, { withFileTypes: true })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) {
        throw new Error("A changelog fragment directory contains an unsupported entry.");
      }
      const fragment = JSON.parse(
        readFileSync(new URL(fileEntry.name, dateRoot), "utf8"),
      );
      const itemId = fragment?.item?.id;
      const publishedOn = fragment?.publishedOn;
      if (typeof itemId !== "string" || typeof publishedOn !== "string") {
        throw new Error("A changelog fragment is missing its stable ID or date.");
      }
      if (publishedOn !== dateEntry.name || `${itemId}.json` !== fileEntry.name) {
        throw new Error("A changelog fragment path does not match its stable ID and date.");
      }
      if (itemsById.has(itemId)) {
        throw new Error(`The changelog registry repeats the item ID \`${itemId}\`.`);
      }
      itemsById.set(itemId, publishedOn);
    }
  }
  return itemsById;
}

function isChangelogContentPath(changedPath) {
  const normalized = changedPath.split(path.sep).join("/");
  return normalized === LEGACY_CHANGELOG_PATH
    || normalized.startsWith(CHANGELOG_ENTRY_PREFIX)
    || normalized.startsWith(CHANGELOG_EDITION_PREFIX);
}

function parseItemReferences(value) {
  const entries = value.split(";").map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    return null;
  }
  const references = [];
  for (const entry of entries) {
    const match = ITEM_REFERENCE_PATTERN.exec(entry);
    if (!match) {
      return null;
    }
    references.push({ editionId: match[1], itemId: match[2] });
  }
  return references;
}

function isConcreteValue(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
  return value.length >= 16 && !PLACEHOLDER_VALUES.has(normalized);
}

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

function validatePrChangelog({
  changedPaths,
  changelogItemsById,
  prBodyHtml,
}) {
  const errors = [];
  const sectionCount = countRenderedSections(prBodyHtml, SECTION_HEADING);
  if (sectionCount === 0) {
    return ["Add a `## Changelog` section to the pull request body."];
  }
  if (sectionCount > 1) {
    errors.push("Keep exactly one `## Changelog` section in the pull request body.");
  }

  const section = readRenderedSection(prBodyHtml, SECTION_HEADING);
  if (!section) {
    errors.push("Complete the `## Changelog` section.");
    return errors;
  }

  const dispositionItems = findRenderedListItems(section, "Changelog");
  if (dispositionItems.length !== 1) {
    errors.push(
      "Add exactly one `Changelog:` bullet with `updated` or `not applicable`.",
    );
    return errors;
  }

  const disposition = readItemValue(dispositionItems[0], "Changelog")
    .toLowerCase();
  if (!VALID_DISPOSITIONS.has(disposition)) {
    errors.push("Set `Changelog:` to exactly `updated` or `not applicable`.");
    return errors;
  }

  const changelogChanged = changedPaths.some(isChangelogContentPath);
  if (disposition === "updated") {
    if (!changelogChanged) {
      errors.push(
        `A \`Changelog: updated\` declaration must change ${CHANGELOG_CONTENT_DESCRIPTION}.`,
      );
    }
    const itemEntries = findRenderedListItems(section, "Items");
    if (itemEntries.length !== 1) {
      errors.push(
        "Add exactly one `Items:` bullet naming the edition date and stable changelog item ID.",
      );
    } else {
      const itemValue = readItemValue(itemEntries[0], "Items");
      const references = parseItemReferences(itemValue);
      if (!references) {
        errors.push(
          "Complete `Items:` with semicolon-separated edition date and stable item ID references, for example `2026-08-09 · stable-item-id`.",
        );
      } else {
        const authoritativeItems = changelogItemsById ?? readChangelogItemsById();
        const declaredReferences = new Set();
        for (const { editionId, itemId } of references) {
          const referenceKey = `${editionId}\0${itemId}`;
          if (declaredReferences.has(referenceKey)) {
            errors.push(
              `Remove the duplicate changelog reference \`${editionId} · ${itemId}\`.`,
            );
            continue;
          }
          declaredReferences.add(referenceKey);
          const actualEditionId = authoritativeItems.get(itemId);
          if (!actualEditionId) {
            errors.push(
              `\`Items:\` references the unknown changelog item \`${editionId} · ${itemId}\`.`,
            );
          } else if (actualEditionId !== editionId) {
            errors.push(
              `Changelog item \`${itemId}\` belongs to edition \`${actualEditionId}\`, not \`${editionId}\`.`,
            );
          }
        }
      }
    }
    if (findRenderedListItems(section, "Reason").length > 0) {
      errors.push(
        "Remove the `Reason:` bullet when `Changelog: updated` is selected.",
      );
    }
    return errors;
  }

  if (changelogChanged) {
    errors.push(
      `A PR that changes ${CHANGELOG_CONTENT_DESCRIPTION} cannot declare \`Changelog: not applicable\`.`,
    );
  }
  if (findRenderedListItems(section, "Items").length > 0) {
    errors.push(
      "Remove the `Items:` bullet when `Changelog: not applicable` is selected.",
    );
  }
  const reasonEntries = findRenderedListItems(section, "Reason");
  if (reasonEntries.length !== 1) {
    errors.push(
      "Add exactly one `Reason:` bullet explaining why no member-visible behavior changed.",
    );
  } else if (!isConcreteValue(readItemValue(reasonEntries[0], "Reason"))) {
    errors.push(
      "Complete `Reason:` with a concrete explanation of why the changelog is not applicable.",
    );
  }
  return errors;
}

async function main() {
  const baseSha = process.env.MURPH_PR_BASE_SHA?.trim();
  const headSha = process.env.MURPH_PR_HEAD_SHA?.trim();
  const prBody = process.env.MURPH_PR_BODY ?? "";
  if (!baseSha || !headSha) {
    throw new Error(
      "MURPH_PR_BASE_SHA and MURPH_PR_HEAD_SHA are required for changelog validation.",
    );
  }

  const errors = validatePrChangelog({
    changedPaths: readChangedPaths(baseSha, headSha),
    prBodyHtml: await renderPrBody(prBody),
  });
  if (errors.length > 0) {
    console.error("Pull request changelog declaration is incomplete:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Pull request changelog declaration passed.");
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Pull request changelog validation failed.",
    );
    process.exitCode = 1;
  }
}

export {
  isChangelogContentPath,
  parseItemReferences,
  readChangelogItemsById,
  validatePrChangelog,
};
