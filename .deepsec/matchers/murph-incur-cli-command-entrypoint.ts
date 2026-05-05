import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

const TEST_FILE_RE = /(?:^|\/)(?:__tests__\/|.*\.(?:test|spec)\.[cm]?[tj]sx?$)/;

function lineSnippet(lines: string[], index: number): string {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 5);
  return lines.slice(start, end).join("\n");
}

/**
 * Murph's CLI is an Incur command graph. The default matcher set catches some
 * generic CWE shapes in command files, but it does not intentionally enqueue
 * command modules as untrusted operator-input entry points.
 */
export const murphIncurCliCommandEntrypoint: MatcherPlugin = {
  slug: "murph-incur-cli-command-entrypoint",
  description: "Incur CLI command modules that accept operator-provided arguments and options",
  noiseTier: "noisy",
  filePatterns: [
    "packages/assistant-cli/src/commands/*.ts",
    "packages/cli/src/commands/*.ts",
    "packages/setup-cli/src/*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (TEST_FILE_RE.test(filePath)) return [];

    const lines = content.split("\n");
    const commandRe = /\b[a-zA-Z_$][\w$]*\.command\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!commandRe.test(lines[i])) continue;
      return [
        {
          vulnSlug: "murph-incur-cli-command-entrypoint",
          lineNumbers: [i + 1],
          snippet: lineSnippet(lines, i),
          matchedPattern: "Incur command registration in CLI module",
        },
      ];
    }

    return [];
  },
};
