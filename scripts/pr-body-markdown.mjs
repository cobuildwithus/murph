import { execFileSync } from "node:child_process";

const GITHUB_MARKDOWN_URL = "https://api.github.com/markdown";

function readRenderedSection(html, heading) {
  const headingPattern = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/giu;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    if (renderedText(headingMatch[1]) !== heading) {
      continue;
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const trailingHtml = html.slice(sectionStart);
    const nextHeadingIndex = trailingHtml.search(/<h[12]\b/iu);
    const section =
      nextHeadingIndex >= 0
        ? trailingHtml.slice(0, nextHeadingIndex)
        : trailingHtml;
    return section.trim() || null;
  }
  return null;
}

function renderedText(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/gu, ""))
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:0*39|x0*27);/giu, "'");
}

function findRenderedListItem(section, label) {
  const listItemPattern = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu;
  let listItemMatch;
  while ((listItemMatch = listItemPattern.exec(section)) !== null) {
    if (renderedText(listItemMatch[1]).startsWith(`${label}:`)) {
      return listItemMatch[1];
    }
  }
  return null;
}

async function renderPrBody(markdown) {
  const endpoint =
    process.env.MURPH_GITHUB_MARKDOWN_URL?.trim() || GITHUB_MARKDOWN_URL;
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "murph-pr-body-guard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.MURPH_GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const payload = { mode: "gfm", text: markdown };
  const context = process.env.GITHUB_REPOSITORY?.trim();
  if (context) {
    payload.context = context;
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`GitHub Markdown rendering failed (${response.status}).`);
  }
  return response.text();
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

export {
  findRenderedListItem,
  readChangedPaths,
  readRenderedSection,
  renderPrBody,
  renderedText,
};
