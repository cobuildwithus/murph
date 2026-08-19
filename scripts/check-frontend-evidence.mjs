import { pathToFileURL } from "node:url";

import {
  findRenderedListItem,
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const FRONTEND_ASSET_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu;

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

function hasRenderedScreenshot(section) {
  return /<img\b[^>]*\bsrc\s*=/iu.test(section);
}

function validateFrontendEvidence({ changedPaths, prBodyHtml }) {
  const uiPaths = changedPaths.filter(isFrontendUiPath);
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
        "The Evidence section must name direct proof matched to the changed frontend claim.",
      );
    }
    if (!hasMeaningfulListItem(evidence, "Coverage")) {
      errors.push(
        "The Evidence section must explain which states and viewports were checked and why that proof is sufficient.",
      );
    }
    if (!hasRenderedScreenshot(evidence)) {
      errors.push(
        "Embed at least one screenshot in the Evidence section for every user-facing UI change.",
      );
    }
  }

  return { errors, required: true, uiPaths };
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

  const changedPaths = readChangedPaths(baseSha, headSha);
  if (!changedPaths.some(isFrontendUiPath)) {
    console.log("No user-facing hosted Web UI changes detected.");
    return;
  }
  const result = validateFrontendEvidence({
    changedPaths,
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
    `Frontend screenshot evidence passed for ${result.uiPaths.length} user-facing UI path(s).`,
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

export { isFrontendUiPath, validateFrontendEvidence };
