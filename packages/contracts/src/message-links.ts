export const RICH_LINK_URL_MAX_LENGTH = 2_048;

export type TrailingHttpsLinkSplit = {
  linkUrl: string | null;
  message: string;
};

const TRAILING_TOKEN_PATTERN = /\S+$/u;
const TRAILING_SENTENCE_PUNCTUATION_PATTERN = /[.,;!]+$/u;
const TRAILING_LINK_WRAPPERS = [
  ["<", ">"],
  ["(", ")"],
  ["[", "]"],
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
] as const;

export function splitTrailingHttpsLink(message: string): TrailingHttpsLinkSplit {
  const messageWithoutTrailingWhitespace = message.trimEnd();
  const tokenMatch = TRAILING_TOKEN_PATTERN.exec(messageWithoutTrailingWhitespace);
  if (!tokenMatch) {
    return { linkUrl: null, message };
  }

  const linkUrl = normalizeTrailingHttpsLinkToken(tokenMatch[0]);
  if (!linkUrl) {
    return { linkUrl: null, message };
  }

  return {
    linkUrl,
    message: message.slice(0, tokenMatch.index).trimEnd(),
  };
}

function normalizeTrailingHttpsLinkToken(token: string): string | null {
  let candidate = token;
  let previousCandidate: string;

  do {
    previousCandidate = candidate;
    candidate = candidate.replace(TRAILING_SENTENCE_PUNCTUATION_PATTERN, "");

    const wrapper = TRAILING_LINK_WRAPPERS.find(([opening, closing]) =>
      candidate.startsWith(opening)
      && candidate.endsWith(closing)
      && candidate.length > opening.length + closing.length
    );
    if (wrapper) {
      const [opening, closing] = wrapper;
      candidate = candidate.slice(opening.length, candidate.length - closing.length);
    }
  } while (candidate !== previousCandidate);

  if (!candidate || candidate.length > RICH_LINK_URL_MAX_LENGTH) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (
    !candidate.startsWith("https://")
    || parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    return null;
  }

  return candidate;
}
