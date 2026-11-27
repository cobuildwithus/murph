// Re-checks the clinical provider directory with Node alone, so neither check
// installs dependencies or reads the raw Epic bundle.
//   publish <candidate.json> <held.json> <report.md>: the refresh's publish job.
//   pull-request: a required check; bot-authored pull requests may not move an
//   existing entry's FHIR endpoint to another host.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertDirectoryRefreshCounts,
  endpointOriginChanges,
  parseProviderDirectoryArtifact,
} from "../apps/web/src/lib/clinical-records/provider-directory-artifact.ts";

export const DIRECTORY = "apps/web/src/lib/clinical-records/provider-directory.v2.json";

// Required CI runs the production parser on every committed directory, so a
// committed directory's one embedded policy is the policy its code owns.
function parseDirectory(value, policySource = value) {
  const policy = policySource?.policies?.[0];
  return parseProviderDirectoryArtifact(value, {
    policy, requestedBaseScopes: policy?.requestedBaseScopes ?? [], resourceTypes: [],
  });
}

function describeMoves(moves) {
  return moves.map(({ id, current, candidate }) => `- ${id}: ${current} -> ${candidate}`).join("\n");
}

export function checkPublication({ currentText, candidateText, heldText, allowCountDrop = false }) {
  const currentValue = JSON.parse(currentText);
  const current = parseDirectory(currentValue);
  // Built from the same commit, so the candidate must repeat the current policy.
  const candidate = parseDirectory(JSON.parse(candidateText), currentValue);
  if (!allowCountDrop) assertDirectoryRefreshCounts(current, candidate);
  const moves = endpointOriginChanges(current, candidate);
  if (moves.length) throw new Error(`The candidate moves existing FHIR endpoints to another host:\n${describeMoves(moves)}`);
  return renderHeldReport(parseHeldReport(JSON.parse(heldText), current, candidate), current);
}

export function checkPullRequest({ authorType, baseText, headText }) {
  const base = parseDirectory(JSON.parse(baseText));
  const head = parseDirectory(JSON.parse(headText));
  const moves = endpointOriginChanges(base, head);
  if (!moves.length) return "No existing FHIR endpoint changes host.";
  if (authorType === "Bot") {
    throw new Error(`An automated pull request cannot move existing FHIR endpoints to another host:\n${describeMoves(moves)}`);
  }
  return `A person authored these FHIR endpoint host changes:\n${describeMoves(moves)}`;
}

// Each held change names a current entry that kept its endpoint, and the
// different host upstream asked for.
function parseHeldReport(value, current, candidate) {
  if (!Array.isArray(value)) throw new TypeError("Held endpoint report must be an array.");
  const currentUrls = new Map(current.entries.map(entry => [entry.id, entry.fhirBaseUrl]));
  const candidateUrls = new Map(candidate.entries.map(entry => [entry.id, entry.fhirBaseUrl]));
  const seen = new Set();
  return value.map(change => {
    const { candidate: upstream, current: kept, id } = change ?? {};
    const url = typeof upstream === "string" ? new URL(upstream) : null;
    if (seen.has(id) || !currentUrls.has(id) || currentUrls.get(id) !== kept || candidateUrls.get(id) !== kept
      || url?.protocol !== "https:" || url.origin === new URL(kept).origin) {
      throw new TypeError("Held endpoint report does not match the candidate directory.");
    }
    seen.add(id);
    return { id, current: kept, candidate: url.href };
  });
}

function renderHeldReport(held, current) {
  if (!held.length) return "";
  const brands = new Map(current.entries.map(entry => [entry.id, entry.brandName]));
  const code = text => `\`${String(text).replace(/[`|\r\n]/gu, "")}\``;
  return [
    "The weekly refresh kept the current FHIR endpoint for these directory entries because the Epic directory moved them to another host.",
    "Confirm each move with the health system, then change the committed directory in a reviewed pull request.",
    "",
    "| Entry | Brand | Kept endpoint | Upstream endpoint |",
    "| --- | --- | --- | --- |",
    ...held.map(({ id, current: kept, candidate }) =>
      `| ${code(id)} | ${code(brands.get(id))} | ${code(kept)} | ${code(candidate)} |`),
    "",
  ].join("\n");
}

function main([mode, ...args]) {
  if (mode === "publish") {
    const [candidatePath, heldPath, reportPath] = args;
    if (!candidatePath || !heldPath || !reportPath) throw new TypeError("Usage: publish <candidate> <held report> <markdown output>");
    const report = checkPublication({
      allowCountDrop: process.env.MURPH_DIRECTORY_ALLOW_COUNT_DROP === "true",
      candidateText: readFileSync(candidatePath, "utf8"),
      currentText: readFileSync(DIRECTORY, "utf8"),
      heldText: readFileSync(heldPath, "utf8"),
    });
    writeFileSync(reportPath, report);
    return report ? "Validated the candidate; held endpoint changes need review." : "Validated the candidate.";
  }
  if (mode === "pull-request") {
    const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (!git(["diff", "--name-only", "HEAD^1", "HEAD", "--", DIRECTORY]).trim()) return "The directory is unchanged.";
    return checkPullRequest({
      authorType: process.env.MURPH_PR_AUTHOR_TYPE,
      baseText: git(["show", `HEAD^1:${DIRECTORY}`]),
      headText: readFileSync(DIRECTORY, "utf8"),
    });
  }
  throw new TypeError("Usage: check-clinical-provider-directory.mjs publish|pull-request");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Clinical provider directory check failed.");
    process.exitCode = 1;
  }
}
