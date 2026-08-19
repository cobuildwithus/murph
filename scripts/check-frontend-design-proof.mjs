import { pathToFileURL } from "node:url";

import {
  findRenderedListItem,
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
} from "./pr-body-markdown.mjs";

const DESIGN_CATALOG_PATHS = new Set([
  "apps/web/app/design/components-content.tsx",
  "apps/web/app/design/consent-content.tsx",
  "apps/web/app/design/sections-content.tsx",
]);
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

function validateFrontendDesignProof({ changedPaths, prBodyHtml }) {
  const uiPaths = changedPaths.filter(isFrontendUiPath);
  if (uiPaths.length === 0) {
    return { required: false };
  }

  const errors = [];
  if (!changedPaths.some((filePath) => DESIGN_CATALOG_PATHS.has(filePath))) {
    errors.push(
      "Update the design page component, consent, or sections catalog for this frontend UI change.",
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
    if (!hasMeaningfulListItem(designProof, "Evidence")) {
      errors.push(
        "The Design proof section must include evidence matched to the changed visual, state, interaction, or responsive risk.",
      );
    }
    if (!hasMeaningfulListItem(designProof, "Coverage")) {
      errors.push(
        "The Design proof section must explain which states and viewports were checked and why that evidence is sufficient.",
      );
    }
  }

  return { errors, required: true, uiPaths };
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

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:0*39|x0*27);/giu, "'");
}

function hasMeaningfulListItem(section, label) {
  const item = findRenderedListItem(section, label);
  if (!item) {
    return false;
  }
  const value = renderedText(item).slice(`${label}:`.length).trim();
  return value.length >= 8 && !isExplicitProofAbsence(value);
}

function isExplicitProofAbsence(value) {
  return /(?:^(?:n\/?a|none|not applicable|pending|tbd|todo)\b|^(?:no|without)\s+(?:direct\s+)?(?:evidence|proof)\b|\b(?:evidence|proof)\s+(?:is\s+|was\s+|remains\s+)?(?:missing|pending|unavailable|uncaptured|not\s+(?:captured|collected|provided))\b|\b(?:not|never)\s+(?:checked|tested|inspected|verified)\b|\b(?:will be|to be)\s+(?:added|captured|collected|provided)\b)/iu.test(
    value,
  );
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
  if (!changedPaths.some(isFrontendUiPath)) {
    console.log("No user-facing hosted Web UI changes detected.");
    return;
  }
  const result = validateFrontendDesignProof({
    changedPaths,
    prBodyHtml: await renderPrBody(prBody),
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
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Frontend design proof failed.",
    );
    process.exitCode = 1;
  }
}

export { isFrontendUiPath, validateFrontendDesignProof };
