import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contextStart = "<!-- murph:frog-pr-context:start -->";
const contextEnd = "<!-- murph:frog-pr-context:end -->";

type ExpectedPullRequest = {
  appBotLogin: string;
  baseBranch: string;
  branch: string;
  repository: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedString(value: unknown, ...keys: string[]): string | undefined {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

function selectFrogPullRequest(
  value: unknown,
  expected: ExpectedPullRequest,
): number | undefined {
  if (!Array.isArray(value)) {
    throw new Error("The Frog pull-request query did not return an array.");
  }

  const repositoryMatches = value.filter(
    (candidate) =>
      nestedString(candidate, "base", "ref") === expected.baseBranch
      && nestedString(candidate, "head", "ref") === expected.branch
      && nestedString(candidate, "head", "repo", "full_name")
        === expected.repository,
  );
  if (repositoryMatches.length === 0) return undefined;
  if (repositoryMatches.length !== 1) {
    throw new Error(
      "Expected exactly one repository-owned Frog reconciliation pull request.",
    );
  }

  const [candidate] = repositoryMatches;
  if (nestedString(candidate, "user", "login") !== expected.appBotLogin) {
    throw new Error(
      "The repository-owned Frog pull request was not created by the configured App bot.",
    );
  }
  if (!isRecord(candidate) || !Number.isInteger(candidate.number)) {
    throw new Error("The Frog pull request does not have a valid number.");
  }
  return candidate.number as number;
}

function markerIndexes(body: string, marker: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset < body.length) {
    const index = body.indexOf(marker, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + marker.length;
  }
  return indexes;
}

function normalizeFrogPullRequestBody(body: string, footer: string): string {
  const normalizedFooter = footer.trim();
  if (normalizedFooter.length === 0) {
    throw new Error("The Frog pull-request footer cannot be empty.");
  }
  if (
    normalizedFooter.includes(contextStart)
    || normalizedFooter.includes(contextEnd)
  ) {
    throw new Error("The Frog pull-request footer cannot contain ownership markers.");
  }

  const starts = markerIndexes(body, contextStart);
  const ends = markerIndexes(body, contextEnd);
  const ownedBlock = `${contextStart}\n${normalizedFooter}\n${contextEnd}`;
  if (starts.length === 0 && ends.length === 0) {
    const generatedBody = body.trimEnd();
    return generatedBody.length > 0
      ? `${generatedBody}\n\n${ownedBlock}\n`
      : `${ownedBlock}\n`;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! < starts[0]!) {
    throw new Error("The Frog pull-request body has ambiguous ownership markers.");
  }

  const before = body.slice(0, starts[0]).trimEnd();
  const after = body.slice(ends[0]! + contextEnd.length).trimStart();
  return [before, ownedBlock, after]
    .filter((section) => section.length > 0)
    .join("\n\n")
    .concat("\n");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function run(): void {
  const command = process.argv[2];
  const input = readFileSync(0, "utf8");
  if (command === "select") {
    const number = selectFrogPullRequest(JSON.parse(input), {
      appBotLogin: requiredEnvironment("FROG_APP_BOT_LOGIN"),
      baseBranch: requiredEnvironment("FROG_BASE_BRANCH"),
      branch: requiredEnvironment("FROG_PR_BRANCH"),
      repository: requiredEnvironment("GITHUB_REPOSITORY"),
    });
    if (number !== undefined) process.stdout.write(`${number}\n`);
    return;
  }
  if (command === "normalize") {
    process.stdout.write(
      normalizeFrogPullRequestBody(
        input,
        requiredEnvironment("FROG_PR_BODY_FOOTER"),
      ),
    );
    return;
  }
  throw new Error("Usage: frog-pr-context.ts {select|normalize}");
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    run();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Frog pull-request context normalization failed.",
    );
    process.exitCode = 1;
  }
}

export { normalizeFrogPullRequestBody, selectFrogPullRequest };
export type { ExpectedPullRequest };
