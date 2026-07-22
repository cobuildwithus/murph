import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DESIGN_CATALOG_PATHS = new Set([
  "apps/web/app/design/components-content.tsx",
  "apps/web/app/design/sections-content.tsx",
]);
const FRONTEND_ASSET_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu;

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

function validateFrontendDesignProof({ changedPaths, prBody }) {
  const uiPaths = changedPaths.filter(isFrontendUiPath);
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

  const visiblePrBody = prBody.replace(/<!--[\s\S]*?(?:-->|$)/gu, "");
  const designProof = readMarkdownSection(visiblePrBody, "Design proof");
  if (!designProof) {
    errors.push("Add a `## Design proof` section to the pull request body.");
  } else {
    if (!hasDesignPageLine(designProof)) {
      errors.push(
        "The Design proof section must link to `/design?tab=components` or `/design?tab=sections`.",
      );
    }
    if (!hasScreenshotLine(designProof, "Desktop screenshot")) {
      errors.push(
        "The Design proof section must include a hosted desktop screenshot from the design page.",
      );
    }
    if (!hasScreenshotLine(designProof, "Mobile screenshot")) {
      errors.push(
        "The Design proof section must include a hosted mobile screenshot from the design page.",
      );
    }
  }

  return { errors, required: true, uiPaths };
}

function readMarkdownSection(markdown, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const headingMatch = new RegExp(
    `^##[ \\t]+${escapedHeading}[ \\t]*$`,
    "imu",
  ).exec(markdown);
  if (!headingMatch || typeof headingMatch.index !== "number") {
    return null;
  }
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const trailingMarkdown = markdown.slice(sectionStart);
  const nextHeadingIndex = trailingMarkdown.search(/^##[ \\t]+/mu);
  const section = (
    nextHeadingIndex >= 0
      ? trailingMarkdown.slice(0, nextHeadingIndex)
      : trailingMarkdown
  );
  return section.trim() || null;
}

function hasDesignPageLine(section) {
  return /^[ \t]*(?:[-*][ \t]+)?Design page[ \t]*:[ \t]*[^\n]*\/design\?tab=(?:components|sections)(?:[#&\s)`]|$)[^\n]*$/imu.test(
    section,
  );
}

function hasScreenshotLine(section, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const hostedImage = [
    String.raw`!\[[^\]]*\]\(https?:\/\/[^)\s]+\)`,
    String.raw`<img\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>`,
  ].join("|");
  return new RegExp(
    `^[ \\t]*(?:[-*][ \\t]+)?${escapedLabel}[ \\t]*:[ \\t]*(?:${hostedImage})`,
    "imu",
  ).test(section);
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

function main() {
  const baseSha = process.env.MURPH_PR_BASE_SHA?.trim();
  const headSha = process.env.MURPH_PR_HEAD_SHA?.trim();
  const prBody = process.env.MURPH_PR_BODY ?? "";
  if (!baseSha || !headSha) {
    throw new Error(
      "MURPH_PR_BASE_SHA and MURPH_PR_HEAD_SHA are required for frontend design proof validation.",
    );
  }

  const result = validateFrontendDesignProof({
    changedPaths: readChangedPaths(baseSha, headSha),
    prBody,
  });
  if (!result.required) {
    console.log("No user-facing hosted Web UI changes detected.");
    return;
  }
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
  main();
}

export { hasDesignPageLine, isFrontendUiPath, validateFrontendDesignProof };
