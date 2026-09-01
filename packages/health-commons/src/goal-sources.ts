export interface HealthCommonsGoalSource {
  label: string;
  url: string;
}

const VISIBLE_MARKDOWN_LINK_OPEN_PATTERN = /(?<!!)\[([^\]\r\n]+)\]\(/giu;
const SENSITIVE_SOURCE_URL_SEARCH_PARAMS = new Set([
  "access_token",
  "access-key",
  "access_key",
  "api-key",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client-secret",
  "client_secret",
  "code",
  "credential",
  "credentials",
  "id_token",
  "key",
  "password",
  "secret",
  "sig",
  "signature",
  "token",
]);

/**
 * Extract the visible Markdown links from a goal guide's Sources section.
 * These links are the guide's direct public citations; source-artifact edges
 * remain separate catalog metadata and are not substituted here.
 */
export function extractHealthCommonsGoalSources(
  body: string,
): HealthCommonsGoalSource[] {
  const lines = body.split(/\r?\n/u);
  const sourcesHeadingIndex = lines.findIndex((line) => line.trim() === "## Sources");
  if (sourcesHeadingIndex < 0) {
    return [];
  }

  const nextHeadingOffset = lines
    .slice(sourcesHeadingIndex + 1)
    .findIndex((line) => /^##\s+/u.test(line.trim()));
  const sourcesEndIndex = nextHeadingOffset < 0
    ? lines.length
    : sourcesHeadingIndex + 1 + nextHeadingOffset;
  const sourceLines = visibleMarkdownSourceListItems(
    lines.slice(sourcesHeadingIndex + 1, sourcesEndIndex),
  );
  const seenUrls = new Set<string>();
  const sources: HealthCommonsGoalSource[] = [];

  for (const sourceLine of sourceLines) {
    for (const match of sourceLine.matchAll(VISIBLE_MARKDOWN_LINK_OPEN_PATTERN)) {
      const label = match[1]?.trim().replace(/\s+/gu, " ");
      const destinationStart = (match.index ?? 0) + match[0].length;
      const url = readMarkdownLinkDestination(sourceLine, destinationStart);
      if (!label || !url) {
        continue;
      }
      if (!isPublicHealthCommonsGoalSourceUrl(url)) {
        throw new Error(
          "Goal source URL must be a valid public HTTPS URL without credentials or sensitive query parameters.",
        );
      }
      if (seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      sources.push({ label, url });
    }
  }

  return sources;
}

export function isPublicHealthCommonsGoalSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || !isPublicSourceHostname(url.hostname)
    ) {
      return false;
    }

    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.toLowerCase();
      if (
        SENSITIVE_SOURCE_URL_SEARCH_PARAMS.has(normalizedKey)
        || normalizedKey.endsWith("_token")
        || normalizedKey.endsWith("_secret")
        || normalizedKey.endsWith("_key")
        || normalizedKey.startsWith("x-amz-")
        || normalizedKey.startsWith("x-goog-")
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function visibleMarkdownSourceListItems(lines: readonly string[]): string[] {
  let fence: { character: "\u0060" | "~"; length: number } | null = null;
  let insideHtmlComment = false;
  const sourceItems: string[] = [];

  for (const rawLine of lines) {
    if (fence) {
      const closingFenceMarker = rawLine.match(/^\s*((?:\x60){3,}|~{3,})/u)?.[1];
      if (
        closingFenceMarker?.[0] === fence.character
        && closingFenceMarker.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    let line = "";
    let cursor = 0;
    while (cursor < rawLine.length) {
      if (insideHtmlComment) {
        const commentEnd = rawLine.indexOf("-->", cursor);
        if (commentEnd < 0) {
          cursor = rawLine.length;
          continue;
        }
        insideHtmlComment = false;
        cursor = commentEnd + 3;
        continue;
      }

      const commentStart = rawLine.indexOf("<!--", cursor);
      if (commentStart < 0) {
        line += rawLine.slice(cursor);
        break;
      }
      line += rawLine.slice(cursor, commentStart);
      insideHtmlComment = true;
      cursor = commentStart + 4;
    }

    const fenceMarker = line.match(/^\s*((?:\x60){3,}|~{3,})/u)?.[1];
    if (fenceMarker) {
      fence = {
        character: fenceMarker[0] as "\u0060" | "~",
        length: fenceMarker.length,
      };
      continue;
    }

    const listItem = line.match(/^\s*[-+*]\s+(.+)$/u)?.[1];
    if (listItem) {
      sourceItems.push(listItem);
    }
  }

  return sourceItems;
}

function readMarkdownLinkDestination(
  markdown: string,
  destinationStart: number,
): string | null {
  let nestedParentheses = 0;
  let rawDestination = "";

  for (let index = destinationStart; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\n" || character === "\r") {
      return null;
    }
    if (character === "\\" && index + 1 < markdown.length) {
      rawDestination += markdown[index + 1];
      index += 1;
      continue;
    }
    if (character === "(") {
      nestedParentheses += 1;
      rawDestination += character;
      continue;
    }
    if (character === ")") {
      if (nestedParentheses === 0) {
        return parseMarkdownDestinationAndTitle(rawDestination);
      }
      nestedParentheses -= 1;
      rawDestination += character;
      continue;
    }
    rawDestination += character;
  }

  return null;
}

function parseMarkdownDestinationAndTitle(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim() || null;
  }

  const match = trimmed.match(/^(\S+?)(?:\s+(?:"[^"]*"|'[^']*'))?$/u);
  return match?.[1]?.trim() || null;
}

function isPublicSourceHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (
    hostname.length === 0
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa")
  ) {
    return false;
  }

  if (hostname.includes(":")) {
    return !isNonPublicIpv6Address(hostname);
  }

  const ipv4Octets = parseIpv4Octets(hostname);
  if (ipv4Octets) {
    return !isNonPublicIpv4Address(ipv4Octets);
  }

  return hostname.includes(".");
}

function parseIpv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isNonPublicIpv4Address([
  first,
  second,
  third,
]: [number, number, number, number]): boolean {
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isNonPublicIpv6Address(hostname: string): boolean {
  const firstSegment = hostname.split(":", 1)[0] ?? "";
  const firstValue = Number.parseInt(firstSegment || "0", 16);
  return hostname.startsWith("::")
    || (firstSegment === "2001" && hostname.startsWith("2001:db8:"))
    || (firstValue >= 0xfc00 && firstValue <= 0xfdff)
    || (firstValue >= 0xfe80 && firstValue <= 0xfebf)
    || (firstValue >= 0xff00 && firstValue <= 0xffff);
}
