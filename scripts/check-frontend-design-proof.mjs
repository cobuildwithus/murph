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

function validateFrontendDesignProof({ changedPaths, prBodyHtml }) {
  const uiPaths = changedPaths.filter(isFrontendUiPath);
  if (uiPaths.length === 0) {
    return { required: false };
  }

  const errors = [];
  const designProof = readRenderedSection(prBodyHtml, "Design proof");
  if (!designProof) {
    errors.push("Add a `## Design proof` section to the pull request body.");
  } else {
    if (!hasSupportedDesignProofLink(designProof)) {
      errors.push(
        "The Design proof section must include an absolute HTTP(S) link with a fragment to `/design?tab=components`, `/design?tab=consent`, or `/screenshots/<category>`.",
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

function hasSupportedDesignProofLink(section) {
  const item = findRenderedListItem(section, "Design page");
  if (!item) {
    return false;
  }

  const anchorPattern = /<a\b([^>]*)>/giu;
  let anchorMatch;
  while ((anchorMatch = anchorPattern.exec(item)) !== null) {
    const href = readQuotedAttribute(anchorMatch[1], "href");
    if (href && isSupportedDesignProofDestination(decodeHtmlEntities(href))) {
      return true;
    }
  }
  return false;
}

function isSupportedDesignProofDestination(href) {
  let destination;
  try {
    destination = new URL(href);
  } catch {
    return false;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return false;
  }
  if (!destination.hash || destination.hash === "#") {
    return false;
  }
  if (destination.pathname === "/design") {
    const tab = destination.searchParams.get("tab");
    return tab === "components" || tab === "consent";
  }
  return /^\/screenshots\/[a-z0-9-]+$/u.test(destination.pathname);
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
