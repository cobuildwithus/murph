import { pathToFileURL } from "node:url";

import {
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const SECTION_HEADING = "Deployment concerns";
const VALID_DISPOSITIONS = new Set(["applicable", "not applicable"]);
const APPLICABLE_FIELDS = [
  "Supported skew",
  "Safe order",
  "Rollback floor",
  "Expected exposure",
  "Reversibility",
  "Convergence proof",
  "Post-deploy checks",
];
const PLACEHOLDER_VALUES = new Set([
  "",
  "na",
  "none",
  "notapplicable",
  "tbd",
  "todo",
]);

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

function validatePrDeploymentConcerns({ prBodyHtml }) {
  const errors = [];
  const sectionCount = countRenderedSections(prBodyHtml, SECTION_HEADING);
  if (sectionCount === 0) {
    return [
      "Add a `## Deployment concerns` section to the pull request body.",
    ];
  }
  if (sectionCount > 1) {
    errors.push(
      "Keep exactly one `## Deployment concerns` section in the pull request body.",
    );
  }

  const section = readRenderedSection(prBodyHtml, SECTION_HEADING);
  if (!section) {
    errors.push("Complete the `## Deployment concerns` section.");
    return errors;
  }

  const dispositionItems = findRenderedListItems(section, "Deployment");
  if (dispositionItems.length !== 1) {
    errors.push(
      "Add exactly one `Deployment:` bullet with `applicable` or `not applicable`.",
    );
    return errors;
  }

  const disposition = readItemValue(dispositionItems[0], "Deployment")
    .toLowerCase();
  if (!VALID_DISPOSITIONS.has(disposition)) {
    errors.push(
      "Set `Deployment:` to exactly `applicable` or `not applicable`.",
    );
    return errors;
  }

  if (disposition === "applicable") {
    for (const field of APPLICABLE_FIELDS) {
      const entries = findRenderedListItems(section, field);
      if (entries.length !== 1) {
        errors.push(`Add exactly one \`${field}:\` bullet.`);
      } else if (!isConcreteValue(readItemValue(entries[0], field))) {
        errors.push(`Complete \`${field}:\` with concrete deployment details.`);
      }
    }
    if (findRenderedListItems(section, "Reason").length > 0) {
      errors.push(
        "Remove the `Reason:` bullet when `Deployment: applicable` is selected.",
      );
    }
    return errors;
  }

  for (const field of APPLICABLE_FIELDS) {
    if (findRenderedListItems(section, field).length > 0) {
      errors.push(
        `Remove the \`${field}:\` bullet when \`Deployment: not applicable\` is selected.`,
      );
    }
  }
  const reasonEntries = findRenderedListItems(section, "Reason");
  if (reasonEntries.length !== 1) {
    errors.push(
      "Add exactly one `Reason:` bullet explaining why deployment concerns do not apply.",
    );
  } else if (!isConcreteValue(readItemValue(reasonEntries[0], "Reason"))) {
    errors.push(
      "Complete `Reason:` with a concrete explanation of why deployment concerns do not apply.",
    );
  }
  return errors;
}

async function main() {
  const prBody = process.env.MURPH_PR_BODY ?? "";
  const errors = validatePrDeploymentConcerns({
    prBodyHtml: await renderPrBody(prBody),
  });
  if (errors.length > 0) {
    console.error("Pull request deployment concerns are incomplete:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Pull request deployment concerns passed.");
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
        : "Pull request deployment concerns validation failed.",
    );
    process.exitCode = 1;
  }
}

export { APPLICABLE_FIELDS, validatePrDeploymentConcerns };
