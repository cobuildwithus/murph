import { pathToFileURL } from "node:url";

import {
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./check-frontend-design-proof.mjs";

const CHANGELOG_PATH = "apps/web/src/lib/changelog.ts";
const SECTION_HEADING = "Changelog";
const VALID_DISPOSITIONS = new Set(["not applicable", "updated"]);
const ITEM_REFERENCE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}\b[\s·,:/+]+[a-z0-9]+(?:-[a-z0-9]+)+/u;
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

function validatePrChangelog({ changedPaths, prBodyHtml }) {
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

  const changelogChanged = changedPaths.includes(CHANGELOG_PATH);
  if (disposition === "updated") {
    if (!changelogChanged) {
      errors.push(
        `A \`Changelog: updated\` declaration must change \`${CHANGELOG_PATH}\`.`,
      );
    }
    const itemEntries = findRenderedListItems(section, "Items");
    if (itemEntries.length !== 1) {
      errors.push(
        "Add exactly one `Items:` bullet naming the edition date and stable changelog item ID.",
      );
    } else {
      const itemValue = readItemValue(itemEntries[0], "Items");
      if (!ITEM_REFERENCE_PATTERN.test(itemValue)) {
        errors.push(
          "Complete `Items:` with an edition date and stable item ID, for example `2026-08-09 · stable-item-id`.",
        );
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
      `A PR that changes \`${CHANGELOG_PATH}\` cannot declare \`Changelog: not applicable\`.`,
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

export { validatePrChangelog };
