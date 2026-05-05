import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

const TEST_FILE_RE = /(?:^|\/)(?:__tests__\/|.*\.(?:test|spec)\.[cm]?[tj]sx?$)/;

function lineSnippet(lines: string[], index: number): string {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 5);
  return lines.slice(start, end).join("\n");
}

/**
 * Cloudflare Worker, email, queue, Durable Object, container HTTP, and
 * container RPC handlers are public/runtime entry points, but the built-in
 * Next.js route coverage does not model these Worker shapes directly.
 */
export const murphCloudflareWorkerEntrypoint: MatcherPlugin = {
  slug: "murph-cloudflare-worker-entrypoint",
  description: "Cloudflare Worker module, queue/email, Durable Object, and container entry points",
  noiseTier: "noisy",
  filePatterns: [
    "apps/cloudflare/src/index.ts",
    "apps/cloudflare/src/runner-container.ts",
    "apps/cloudflare/src/hosted-email/worker-ingress.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (TEST_FILE_RE.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const entrypointRe =
      /\bexport\s+default\s+\{|\basync\s+(?:fetch|email|queue)\s*\(|\boverride\s+async\s+fetch\s*\(|\bextends\s+DurableObject\b|\basync\s+(?:bindUser|deleteHostedUserData|runnerStatus|nudgeHostedRunner|ownsActiveInvocationLease|recordActiveInvocationHeartbeat|recordActiveInvocationWorkspaceCheckpoint|runUntilIdleOrBudget|runUntilIdleForTest|alarm|invoke|destroyInstance|smokeHealth|ownsInternalWorkerProxyToken)\s*\(|\bhandleHostedEmailIngress\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!entrypointRe.test(lines[i])) continue;
      matches.push({
        vulnSlug: "murph-cloudflare-worker-entrypoint",
        lineNumbers: [i + 1],
        snippet: lineSnippet(lines, i),
        matchedPattern: "Cloudflare runtime entry point",
      });
    }

    return matches;
  },
};
