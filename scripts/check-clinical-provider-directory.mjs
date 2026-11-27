// Re-checks the clinical provider directory with Node alone, so neither check
// installs dependencies or reads the raw Epic bundle. Both apply the same
// refresh hold rule as the importer (holdDirectoryChangesForReview).
//   publish <candidate.json> <held.json> <report.md>: the refresh's publish job.
//   pull-request: a required check; a bot-authored pull request may not make a
//   change the rule holds for a person.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertDirectoryRefreshCounts,
  holdDirectoryChangesForReview,
  parseProviderDirectoryArtifact,
} from "../apps/web/src/lib/clinical-records/provider-directory-artifact.ts";

export const DIRECTORY = "apps/web/src/lib/clinical-records/provider-directory.v2.json";
// GitHub rejects issue bodies over 65,536 characters.
const REPORT_LIMIT = 60_000;

// Required CI runs the production parser on every committed directory, so a
// committed directory's embedded policies are the policies its code owns. An
// Oracle entry must repeat the integration a committed entry already names.
function parseDirectory(value, policySource = value) {
  const owned = (policySource?.policies ?? []).map(policy => ({
    integration: policySource.entries?.find(entry => entry?.policyId === policy?.id)?.integration,
    policy, requestedBaseScopes: policy?.requestedBaseScopes ?? [], resourceTypes: [],
  }));
  return parseProviderDirectoryArtifact(value, owned);
}

function describeChanges(changes) {
  const describe = {
    endpoint: ({ current, candidate }) => `endpoint ${current} -> ${candidate}`,
    removal: ({ current }) => `removed (${current})`,
    "new-host": ({ candidate }) => `new entry on a new host (${candidate})`,
  };
  return changes.map(change => `- ${change.id}: ${describe[change.kind](change)}`).join("\n");
}

export function checkPublication({ currentText, candidateText, heldText, allowCountDrop = false }) {
  const currentValue = JSON.parse(currentText);
  const current = parseDirectory(currentValue);
  // Built from the same commit, so the candidate must repeat the current policy.
  const candidate = parseDirectory(JSON.parse(candidateText), currentValue);
  if (!allowCountDrop) assertDirectoryRefreshCounts(current, candidate);
  const { held } = holdDirectoryChangesForReview(current, candidate);
  if (held.length) throw new Error(`The candidate makes changes only a person may publish:\n${describeChanges(held)}`);
  return renderHeldReport(parseHeldReport(JSON.parse(heldText), current, candidate));
}

export function checkPullRequest({ authorType, baseText, headText }) {
  const { held } = holdDirectoryChangesForReview(parseDirectory(JSON.parse(baseText)), parseDirectory(JSON.parse(headText)));
  if (!held.length) return "Every existing entry keeps its endpoint and new entries use known hosts.";
  if (authorType === "Bot") {
    throw new Error(`An automated pull request cannot make these directory changes:\n${describeChanges(held)}`);
  }
  return `A person authored these directory changes:\n${describeChanges(held)}`;
}

// Each held change must describe what the candidate kept: an existing entry on
// its current endpoint, or a new entry on an unknown host left out.
function parseHeldReport(value, current, candidate) {
  if (!Array.isArray(value)) throw new TypeError("Held directory report must be an array.");
  const directories = {
    candidateById: new Map(candidate.entries.map(entry => [entry.id, entry])),
    currentById: new Map(current.entries.map(entry => [entry.id, entry])),
    currentHosts: new Set(current.entries.map(entry => new URL(entry.fhirBaseUrl).origin)),
  };
  const seen = new Set();
  return value.map(change => {
    const held = change && typeof change === "object" ? parseHeldChange(change, directories) : null;
    if (!held || seen.has(held.id)) throw new TypeError("Held directory report does not match the candidate directory.");
    seen.add(held.id);
    return held;
  });
}

function parseHeldChange({ brandName, candidate: upstream, current: kept, id, kind }, directories) {
  const url = plainHttpsUrl(upstream);
  if (kind === "endpoint" || kind === "removal") {
    const prior = directories.currentById.get(id);
    const keptUnchanged = prior !== undefined && prior.fhirBaseUrl === kept
      && directories.candidateById.get(id)?.fhirBaseUrl === kept;
    const upstreamMatches = kind === "endpoint" ? url !== null && upstream !== kept : upstream === undefined;
    return keptUnchanged && upstreamMatches ? { brand: prior.brandName, candidate: url?.href, current: kept, id, kind } : null;
  }
  const leftOut = kind === "new-host" && isEntryId(id) && !directories.currentById.has(id) && !directories.candidateById.has(id);
  const newHost = url !== null && !directories.currentHosts.has(url.origin);
  return leftOut && newHost && typeof brandName === "string" && brandName.length <= 160
    ? { brand: brandName, candidate: url.href, id, kind }
    : null;
}

function isEntryId(value) {
  return typeof value === "string" && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function plainHttpsUrl(value) {
  const url = typeof value === "string" && URL.canParse(value) ? new URL(value) : null;
  return url?.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url : null;
}

function renderHeldReport(held) {
  if (!held.length) return "";
  const code = text => (text ? `\`${String(text).replace(/[`|\r\n]/gu, "")}\`` : "");
  const labels = { endpoint: "Endpoint change", removal: "Removed upstream", "new-host": "New entry on a new host" };
  const header = [
    "The weekly refresh held these directory changes. A connection is bound to its entry's exact endpoint, so only a person may change an existing entry's endpoint, remove an entry, or add an entry on a host the directory does not use yet.",
    "Confirm each change with the health system, then make it in a reviewed pull request. Until then the directory keeps the published entry and leaves new-host entries out.",
    "",
    "| Entry | Brand | Held change | Published endpoint | Upstream endpoint |",
    "| --- | --- | --- | --- | --- |",
  ].join("\n");
  const rows = [];
  let length = header.length;
  for (const { brand, candidate, current: kept, id, kind } of held) {
    const row = `| ${code(id)} | ${code(brand)} | ${labels[kind]} | ${code(kept)} | ${code(candidate)} |`;
    if (length + row.length + 200 > REPORT_LIMIT) break;
    rows.push(row);
    length += row.length + 1;
  }
  const omitted = held.length - rows.length;
  return [header, ...rows, "", ...(omitted ? [`${omitted} more held changes are not listed.`, ""] : [])].join("\n");
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
    return report ? "Validated the candidate; held directory changes need review." : "Validated the candidate.";
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
