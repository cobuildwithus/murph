import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

const TEST_FILE_RE = /(?:^|\/)(?:__tests__\/|.*\.(?:test|spec)\.[cm]?[tj]sx?$)/;

function lineSnippet(lines: string[], index: number): string {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 5);
  return lines.slice(start, end).join("\n");
}

/**
 * Local and container HTTP handlers dispatch by hand rather than through
 * Next.js routes. Review route clauses as entry points because these handlers
 * receive untrusted local/loopback/container HTTP input.
 */
export const murphNodeHttpEntrypoint: MatcherPlugin = {
  slug: "murph-node-http-entrypoint",
  description: "Node HTTP server route dispatch entry points outside Next.js",
  noiseTier: "noisy",
  filePatterns: [
    "apps/cloudflare/src/container-entrypoint.ts",
    "packages/assistant-runtime/src/hosted-runtime/cli-runtime-bridge.ts",
    "packages/assistantd/src/http.ts",
    "packages/device-syncd/src/http.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (TEST_FILE_RE.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const routeRe =
      /\bcreateServer\s*\(|\bif\s*\(\s*method\s*===|url\.pathname\s*(?:===|\.startsWith|\.endsWith)|\bpathname\s*(?:===|\.startsWith|\.endsWith)|\bcreate(?:Static|Parameterized)Route\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!routeRe.test(lines[i])) continue;
      matches.push({
        vulnSlug: "murph-node-http-entrypoint",
        lineNumbers: [i + 1],
        snippet: lineSnippet(lines, i),
        matchedPattern: "Node HTTP server or route dispatch clause",
      });
    }

    return matches;
  },
};
