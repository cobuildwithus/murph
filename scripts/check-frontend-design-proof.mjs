import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DESIGN_CATALOG_PATHS = new Set([
  "apps/web/app/design/components-content.tsx",
  "apps/web/app/design/sections-content.tsx",
]);
const FRONTEND_ASSET_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu;
const RAW_HTML_BLOCK_START = /^[ ]{0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/iu;
const RAW_HTML_LITERAL_START = /^[ ]{0,3}<(pre|script|style|textarea)(?:[ \t]|>|$)/iu;
const RAW_HTML_LITERAL_END = /<\/(?:pre|script|style|textarea)[ \t]*>/iu;
const RAW_HTML_DELIMITED_BLOCKS = [
  { end: /\?>/u, start: /^[ ]{0,3}<\?/u },
  { end: />/u, start: /^[ ]{0,3}<![A-Za-z]/u },
  { end: /\]\]>/u, start: /^[ ]{0,3}<!\[CDATA\[/u },
];
const HTML_TAG_NAME = String.raw`[A-Za-z][A-Za-z0-9-]*`;
const HTML_ATTRIBUTE_NAME = String.raw`[A-Za-z_:][A-Za-z0-9_.:-]*`;
const HTML_ATTRIBUTE_VALUE = String.raw`(?:[^\x00-\x20"'=<>\x60]+|'[^']*'|"[^"]*")`;
const HTML_ATTRIBUTE = String.raw`[ \t]+${HTML_ATTRIBUTE_NAME}(?:[ \t]*=[ \t]*${HTML_ATTRIBUTE_VALUE})?`;
const RAW_HTML_COMPLETE_TAG_START = new RegExp(
  `^[ ]{0,3}(?:<${HTML_TAG_NAME}(?:${HTML_ATTRIBUTE})*[ \\t]*/?>|</${HTML_TAG_NAME}[ \\t]*>)[ \\t]*$`,
  "u",
);

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

  const visiblePrBody = maskNonRenderedMarkdown(prBody);
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

function maskNonRenderedMarkdown(markdown) {
  const withoutComments = maskMatches(
    markdown,
    /<!--[\s\S]*?(?:-->|$)/gu,
  );
  const withoutHtmlContainers = maskRawHtmlBlocks(withoutComments);
  return maskIndentedCodeBlocks(maskFencedCodeBlocks(withoutHtmlContainers));
}

function maskMatches(value, pattern) {
  return value.replace(pattern, maskCharacters);
}

function maskCharacters(value) {
  return value.replace(/[^\r\n]/gu, " ");
}

function markdownLines(markdown) {
  return markdown.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu) ?? [];
}

function maskRawHtmlBlocks(markdown) {
  let blockUntilBlankLine = false;
  let delimitedBlockEnd = null;
  return markdownLines(markdown)
    .map((line) => {
      const content = line.replace(/[\r\n]+$/u, "");
      if (delimitedBlockEnd) {
        const maskedLine = maskCharacters(line);
        if (delimitedBlockEnd.test(content)) {
          delimitedBlockEnd = null;
        }
        return maskedLine;
      }
      if (blockUntilBlankLine) {
        if (/^[ \t]*$/u.test(content)) {
          blockUntilBlankLine = false;
          return line;
        }
        return maskCharacters(line);
      }

      const literalStart = RAW_HTML_LITERAL_START.exec(content);
      if (literalStart?.[1]) {
        if (!RAW_HTML_LITERAL_END.test(content)) {
          delimitedBlockEnd = RAW_HTML_LITERAL_END;
        }
        return maskCharacters(line);
      }
      const delimitedBlock = RAW_HTML_DELIMITED_BLOCKS.find(({ start }) =>
        start.test(content)
      );
      if (delimitedBlock) {
        if (!delimitedBlock.end.test(content)) {
          delimitedBlockEnd = delimitedBlock.end;
        }
        return maskCharacters(line);
      }
      if (RAW_HTML_BLOCK_START.test(content)) {
        blockUntilBlankLine = true;
        return maskCharacters(line);
      }
      if (RAW_HTML_COMPLETE_TAG_START.test(content)) {
        blockUntilBlankLine = true;
        return maskCharacters(line);
      }
      return line;
    })
    .join("");
}

function maskFencedCodeBlocks(markdown) {
  let fence = null;
  return markdownLines(markdown)
    .map((line) => {
      const content = line.replace(/[\r\n]+$/u, "");
      if (fence) {
        const closingFence = new RegExp(
          `^[ \\t]{0,3}${fence.marker}{${fence.length},}[ \\t]*$`,
          "u",
        );
        const maskedLine = maskCharacters(line);
        if (closingFence.test(content)) {
          fence = null;
        }
        return maskedLine;
      }

      const openingFence = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(content);
      if (!openingFence) {
        return line;
      }
      const marker = openingFence[1]?.[0];
      if (marker !== "`" && marker !== "~") {
        return line;
      }
      fence = { length: openingFence[1].length, marker };
      return maskCharacters(line);
    })
    .join("");
}

function maskIndentedCodeBlocks(markdown) {
  return markdownLines(markdown)
    .map((line) => (
      /^(?: {4}| {0,3}\t)/u.test(line) ? maskCharacters(line) : line
    ))
    .join("");
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
