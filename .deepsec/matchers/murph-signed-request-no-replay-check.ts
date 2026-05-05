import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

const TEST_FILE_RE = /(?:^|\/)(?:__tests__\/|.*\.(?:test|spec)\.[cm]?[tj]sx?$)/;
const HAS_SIGNATURE_VERIFY = /\bcrypto\.subtle\.verify\s*\(|\bverify[A-Za-z0-9_]*Signature[A-Za-z0-9_]*\s*\(/;
const HAS_SIGNED_REQUEST_NONCE = /\breadHostedExecutionSignatureHeaders\s*\(|\bHOSTED_EXECUTION_NONCE_HEADER\b|\bnonce\b/;
const HAS_REPLAY_CHECK =
  /\bconsume[A-Za-z0-9_]*Nonce\s*\(|\bnonceStore\b|\breplay(?:ed|Store|Protection)?\b|\bnonce(?:Hash)?\b.*\b(delete|insert|create|set|put|exec)\b/iu;
const HAS_NONCE_MIN_LENGTH = /\b\w*NONCE_MIN_LENGTH\b|\b\w*nonce\w*\.length\s*<\s*[A-Z0-9_]+/i;

function lineSnippet(lines: string[], index: number): string {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 6);
  return lines.slice(start, end).join("\n");
}

function findBlockEnd(lines: string[], startIndex: number): number {
  let braceDepth = 0;
  let sawOpeningBrace = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const char of line) {
      if (char === "{") {
        braceDepth++;
        sawOpeningBrace = true;
      } else if (char === "}") {
        braceDepth--;
      }
    }

    if (sawOpeningBrace && braceDepth <= 0) {
      return i + 1;
    }
  }

  return Math.min(lines.length, startIndex + 80);
}

/**
 * Revalidated findings landed on a signed hosted callback verifier that checks
 * ECDSA signatures and timestamps but does not consume request nonces. This
 * matcher catches sibling signed-request verifiers with nonce-bearing payloads
 * and no apparent replay/nonce-strength check in the same file.
 */
export const murphSignedRequestNoReplayCheck: MatcherPlugin = {
  slug: "murph-signed-request-no-replay-check",
  description: "Signed request verifier with nonce-bearing payload but no replay/nonce-strength check",
  noiseTier: "precise",
  filePatterns: [
    "apps/cloudflare/src/*auth*.ts",
    "apps/web/src/lib/device-sync/auth.ts",
    "apps/web/src/lib/hosted-execution/*auth*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (TEST_FILE_RE.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const exportedVerifierRe = /\bexport\s+async\s+function\s+\w*(?:verify|require)\w*/i;

    for (let i = 0; i < lines.length; i++) {
      if (!exportedVerifierRe.test(lines[i])) continue;

      const block = lines.slice(i, findBlockEnd(lines, i)).join("\n");
      if (!HAS_SIGNATURE_VERIFY.test(block)) continue;
      if (!HAS_SIGNED_REQUEST_NONCE.test(block)) continue;
      if (HAS_REPLAY_CHECK.test(block) && HAS_NONCE_MIN_LENGTH.test(block)) continue;

      matches.push({
        vulnSlug: "murph-signed-request-no-replay-check",
        lineNumbers: [i + 1],
        snippet: lineSnippet(lines, i),
        matchedPattern: "exported signature verifier uses nonce-bearing payload without replay and nonce-strength checks",
      });
    }

    return matches;
  },
};
