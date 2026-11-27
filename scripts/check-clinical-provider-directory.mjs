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
  DIRECTORY_CONNECTION_FIELDS,
  holdDirectoryChangesForReview,
  parseProviderDirectoryArtifact,
} from "../apps/web/src/lib/clinical-records/provider-directory-artifact.ts";

export const DIRECTORY = "apps/web/src/lib/clinical-records/provider-directory.v2.json";
// GitHub rejects issue bodies over 65,536 characters.
const REPORT_LIMIT = 60_000;
const PRODUCTION_CLIENT_KEY = "EPIC_SMART_CLIENT_ID";
const CLIENT_KEYS = new Set([PRODUCTION_CLIENT_KEY, "EPIC_SMART_NON_PRODUCTION_CLIENT_ID"]);

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
    connection: ({ field, current, candidate }) => `${field} ${current} -> ${candidate}`,
    removal: ({ current }) => `removed (${current})`,
    addition: ({ candidate, clientIdEnvironmentKey }) => `new entry (${candidate}, ${clientIdEnvironmentKey})`,
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
  if (!held.length) return "Every existing entry keeps its connection and new entries use a known production host and client.";
  if (authorType === "Bot") {
    throw new Error(`An automated pull request cannot make these directory changes:\n${describeChanges(held)}`);
  }
  return `A person authored these directory changes:\n${describeChanges(held)}`;
}

// Each held change must describe what the candidate kept: an existing entry
// with its published connection, or a new entry left out for a reason the
// rule names. Upstream values themselves cannot be verified here.
function parseHeldReport(value, current, candidate) {
  if (!Array.isArray(value)) throw new TypeError("Held directory report must be an array.");
  const directories = {
    candidateById: new Map(candidate.entries.map(entry => [entry.id, entry])),
    currentById: new Map(current.entries.map(entry => [entry.id, entry])),
    productionHosts: new Set(current.entries.filter(entry => entry.clientIdEnvironmentKey === PRODUCTION_CLIENT_KEY)
      .map(entry => new URL(entry.fhirBaseUrl).origin)),
  };
  const seen = new Set();
  return value.map(change => {
    const parse = HELD_CHANGE_PARSERS.get(change?.kind);
    const held = parse ? parse(change, directories) : null;
    const key = `${held?.id} ${held?.field}`;
    if (!held || seen.has(key)) throw new TypeError("Held directory report does not match the candidate directory.");
    seen.add(key);
    return held;
  });
}

// The published value, which the candidate must still carry.
function keptValue({ id, field }, { candidateById, currentById }) {
  const prior = currentById.get(id);
  const kept = prior?.[field] ?? null;
  return prior && (candidateById.get(id)?.[field] ?? null) === kept ? { kept, prior } : null;
}

const UPSTREAM_VALUE = {
  clientIdEnvironmentKey: value => (value === null || CLIENT_KEYS.has(value) ? value : undefined),
  fhirBaseUrl: value => plainHttpsUrl(value)?.href,
  policyId: value => (isEntryId(value) ? value : undefined),
};

function parseConnectionChange({ candidate: upstream, current, field, id }, directories) {
  if (!DIRECTORY_CONNECTION_FIELDS.includes(field)) return null;
  const published = keptValue({ field, id }, directories);
  const candidate = UPSTREAM_VALUE[field](upstream);
  return published && published.kept === current && candidate !== undefined && upstream !== current
    ? { brand: published.prior.brandName, candidate, current, field, id, kind: "connection" }
    : null;
}

function parseRemoval({ candidate, current, id }, directories) {
  const published = keptValue({ field: "fhirBaseUrl", id }, directories);
  return published && published.kept === current && candidate === undefined
    ? { brand: published.prior.brandName, current, field: "removal", id, kind: "removal" }
    : null;
}

function parseAddition({ brandName, candidate: upstream, clientIdEnvironmentKey: key, id }, directories) {
  const url = plainHttpsUrl(upstream);
  const leftOut = isEntryId(id) && !directories.currentById.has(id) && !directories.candidateById.has(id);
  const reasons = [
    ...(url && !directories.productionHosts.has(url.origin) ? ["on a new host"] : []),
    ...(key !== PRODUCTION_CLIENT_KEY ? [`using ${key ?? "no Epic client"}`] : []),
  ];
  const described = typeof brandName === "string" && brandName.length <= 160 && (key === null || CLIENT_KEYS.has(key));
  return leftOut && url && described && reasons.length
    ? { brand: brandName, candidate: url.href, field: "addition", id, kind: "addition", label: `New entry ${reasons.join(" and ")}` }
    : null;
}

function isEntryId(value) {
  return typeof value === "string" && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function plainHttpsUrl(value) {
  const url = typeof value === "string" && URL.canParse(value) ? new URL(value) : null;
  return url?.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url : null;
}

const HELD_CHANGE_PARSERS = new Map([
  ["addition", parseAddition], ["connection", parseConnectionChange], ["removal", parseRemoval],
]);

function renderHeldReport(held) {
  if (!held.length) return "";
  // Drops cell breakers, line/paragraph separators and every format character (zero-width, bidi, tags) that could disguise a value.
  const code = text => (text ? `\`${String(text).replace(/[`|\r\n\u2028\u2029\p{Cf}]/gu, "")}\`` : "");
  const labels = {
    clientIdEnvironmentKey: "Client key change", fhirBaseUrl: "Endpoint change", policyId: "Policy change", removal: "Removed upstream",
  };
  const header = [
    "The weekly refresh held these directory changes. A member's connection is bound to its entry's endpoint, client key and policy, so only a person may change those on an existing entry, remove an entry, or add an entry outside a known production host and client.",
    "Upstream values and new entries come from the refresh job and are unverified: re-check each one against open.epic.com before applying it.",
    "Confirm each change with the health system, then make it in a reviewed pull request. Until then the directory keeps the published entry and leaves held new entries out.",
    "",
    "| Entry | Brand | Held change | Published | Upstream |",
    "| --- | --- | --- | --- | --- |",
  ].join("\n");
  const rows = [];
  let length = header.length;
  for (const { brand, candidate, current, field, id, label } of held) {
    const row = `| ${code(id)} | ${code(brand)} | ${label ?? labels[field]} | ${code(current)} | ${code(candidate)} |`;
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
