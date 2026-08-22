import { pathToFileURL } from "node:url";

import {
  findRenderedListItem,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const SECTION_HEADING = "Architecture and reuse";
const REQUIRED_ITEMS = [
  "Existing systems reused",
  "New logic",
  "New abstractions",
  "Complexity intentionally avoided",
];
const EMPTY_VALUES = new Set([
  "",
  "na",
  "none",
  "notapplicable",
  "tbd",
  "todo",
]);

function validatePrArchitectureSummary(prBodyHtml) {
  const section = readRenderedSection(prBodyHtml, SECTION_HEADING);
  if (!section) {
    return [
      "Add a `## Architecture and reuse` section to the pull request body.",
    ];
  }

  const errors = [];
  for (const label of REQUIRED_ITEMS) {
    const item = findRenderedListItem(section, label);
    if (!item) {
      errors.push(`Add the \`${label}:\` bullet.`);
      continue;
    }

    const value = renderedText(item).slice(`${label}:`.length).trim();
    const normalizedValue = value
      .toLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, "");
    if (EMPTY_VALUES.has(normalizedValue)) {
      errors.push(
        `Complete the \`${label}:\` bullet with a concrete sentence; when the answer is none, explain why.`,
      );
    }
  }
  return errors;
}

async function main() {
  const prBody = process.env.MURPH_PR_BODY ?? "";
  const errors = validatePrArchitectureSummary(await renderPrBody(prBody));
  if (errors.length > 0) {
    console.error("Pull request architecture summary is incomplete:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Pull request architecture summary passed.");
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
        : "Pull request architecture summary validation failed.",
    );
    process.exitCode = 1;
  }
}

export { validatePrArchitectureSummary };
