import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanRoots = [
  "apps/cloudflare/src",
  "apps/web/app",
  "apps/web/src",
  "packages",
] as const;

const skippedDirectoryNames = new Set([
  ".next",
  ".next-dev",
  ".next-smoke",
  ".test-dist",
  "coverage",
  "dist",
  "node_modules",
]);

const textFileExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const cloudflareExecutionOnlyPatterns = [
  {
    label: "legacy Cloudflare runtime scheduler Durable Object method",
    pattern: /\b(?:nudgeHostedRunner|nudgeHostedRunnerForUser|scheduleBrowserVaultRefreshForUser|scheduleDashboardReplicaRefreshForUser|runUntilIdleOrBudget)\b/u,
  },
  {
    label: "legacy Cloudflare semantic scheduler helper",
    pattern: /\b(?:ensureRunnerProgress|scheduleAfterRuntimeWake|scheduleShortProgressRecheck|parkIfRunnerRetryCapReached|clearRetryStateForFreshMailboxDemand)\b/u,
  },
  {
    label: "legacy Cloudflare local ensure loop state",
    pattern: /\b(?:localEnsureInFlight|retiredEnsurePromises|retireCurrentEnsurePromise)\b/u,
  },
] as const;

const webVercelNudgePatterns = [
  {
    label: "legacy hosted Vercel nudge workflow",
    pattern: /\b(?:startHostedWebhookNudgeWorkflow|hostedWebhookNudgeWorkflow|nudgeHostedRunnerBestEffort|nudgeHostedRunnerUserBestEffort|nudgeHostedRunnerUserBestEffortResult)\b/u,
  },
  {
    label: "legacy assistant nudge workflow identifier",
    pattern: /\bassistant-nudge\b/u,
  },
] as const;

const legacyHostedDemandDecisionTokens = [
  "HostedRuntime" + "Demand",
  "readRuntime" + "Demand",
  "readHostedRuntime" + "Demand",
  "selectHostedRuntimeRun" + "Demand",
  "selectHostedRuntimeControlRun" + "Demand",
  "Demand" + "RunSource",
  "HOSTED_RUNTIME_" + "DEMAND_BLOCKED",
  "HOSTED_RUNTIME_" + "DEMAND_KINDS",
  "HOSTED_RUNTIME_" + "DEMAND_RUN_SOURCES",
] as const;

const legacyDirectHostedDemandSignalTokens = [
  "manual_run" + "_requested",
  "browser_vault_refresh" + "_requested",
  "mailbox_lag" + "_observed",
  "device_sync_recovery" + "_requested",
  "manualRun" + "Requested",
  "browserVaultRefresh" + "Requested",
  "browserVaultRefresh" + "RequestedAt",
  "lagRecovery" + "Observed",
  "deviceSyncRecovery" + "Requested",
  "browser_vault_refresh" + "_requested_at",
] as const;

const legacyHostedDemandPatterns = [
  {
    label: "legacy hosted runtime demand decision surface",
    pattern: buildTokenPattern(legacyHostedDemandDecisionTokens),
  },
  {
    label: "legacy direct hosted runtime demand signal",
    pattern: buildTokenPattern(legacyDirectHostedDemandSignalTokens),
  },
] as const;

const temporalWorkflowHistoryPayloadPatterns = [
  {
    label: "business payload in Temporal workflow history surface",
    pattern: /\b(?:payload|rawPayload|headers|transcript|prompt)\b/u,
  },
] as const;

const temporalWorkflowBundlePatterns = [
  {
    label: "Node-only hosted-execution parser import in Temporal workflow bundle",
    pattern: /\bfrom\s+["']@murphai\/hosted-execution\/parsers(?:\/[^"']*)?["']/u,
  },
] as const;

const hostedTemporalPatchRetirementChecks = [
  {
    filePath:
      "packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts",
    label: "retired reconciliation-before-mailbox patch must keep its deprecatePatch marker",
    pattern: /\bdeprecatePatch\s*\(\s*HOSTED_USER_RUNTIME_RECONCILE_BEFORE_MAILBOX_PATCH_ID\s*\)/u,
    token: "deprecatePatch(HOSTED_USER_RUNTIME_RECONCILE_BEFORE_MAILBOX_PATCH_ID)",
  },
  {
    filePath: ".github/workflows/host-support.yml",
    label: "CI package coverage must include hosted Temporal package tests",
    pattern: /\bpackages\/hosted-orchestrator-temporal\b/u,
    token: "packages/hosted-orchestrator-temporal",
  },
] as const;

type GuardPattern = Readonly<{
  label: string;
  pattern: RegExp;
}>;

export interface HostedTemporalGuardFinding {
  filePath: string;
  label: string;
  line: number;
  token: string;
}

export async function collectHostedTemporalGuardFindings(): Promise<HostedTemporalGuardFinding[]> {
  const findings: HostedTemporalGuardFinding[] = [];

  for (const root of scanRoots) {
    await scanDirectory(root, findings);
  }
  findings.push(...await collectHostedTemporalPatchRetirementFindings());

  return findings;
}

export async function main(): Promise<void> {
  const findings = await collectHostedTemporalGuardFindings();

  if (findings.length === 0) {
    console.log("No hosted Temporal orchestration architecture guard violations were found.");
    return;
  }

  const lines = [
    "Hosted Temporal orchestration architecture guard failed. Keep web as ingress/status/reconciliation-facts owner, Temporal as signal/sleep/retry orchestration, Cloudflare as execution adapter/write fence, and business payloads out of workflow history.",
  ];

  for (const finding of findings) {
    lines.push(
      `- ${finding.filePath}:${finding.line}: ${finding.label} (${finding.token})`,
    );
  }

  throw new Error(lines.join("\n"));
}

async function scanDirectory(
  relativeDirPath: string,
  findings: HostedTemporalGuardFinding[],
): Promise<void> {
  const absoluteDirPath = path.join(repoRoot, relativeDirPath);
  let entries;
  try {
    entries = await readdir(absoluteDirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryRelativePath = path.posix.join(relativeDirPath, entry.name);

    if (entry.isDirectory()) {
      if (!skippedDirectoryNames.has(entry.name)) {
        await scanDirectory(entryRelativePath, findings);
      }
      continue;
    }

    if (!entry.isFile() || !shouldScanTextFile(entryRelativePath)) {
      continue;
    }

    const contents = await readFile(path.join(repoRoot, entryRelativePath), "utf8");
    findings.push(...findHostedTemporalGuardFindings(entryRelativePath, contents));
  }
}

export function findHostedTemporalGuardFindings(
  relativePath: string,
  contents: string,
): HostedTemporalGuardFinding[] {
  const normalizedPath = normalizeRepoPath(relativePath);
  const findings: HostedTemporalGuardFinding[] = [];

  for (const guardPattern of selectGuardPatterns(normalizedPath)) {
    const match = findFirstPatternMatch(contents, guardPattern.pattern);
    if (match === null) {
      continue;
    }

    findings.push({
      filePath: normalizedPath,
      label: guardPattern.label,
      line: match.line,
      token: match.token,
    });
  }

  return findings;
}

function selectGuardPatterns(relativePath: string): readonly GuardPattern[] {
  const patterns: GuardPattern[] = [];

  if (relativePath.startsWith("apps/cloudflare/src/")) {
    patterns.push(...cloudflareExecutionOnlyPatterns);
  }

  if (isTemporalWorkflowHistorySurface(relativePath)) {
    patterns.push(...temporalWorkflowHistoryPayloadPatterns);
  }

  if (isTemporalWorkflowSourcePath(relativePath)) {
    patterns.push(...temporalWorkflowBundlePatterns);
  }

  if (
    relativePath.startsWith("apps/web/app/")
    || relativePath.startsWith("apps/web/src/")
    || isPackageSourcePath(relativePath)
  ) {
    patterns.push(...webVercelNudgePatterns);
  }

  if (
    relativePath.startsWith("apps/web/app/")
    || relativePath.startsWith("apps/web/src/")
    || relativePath.startsWith("apps/cloudflare/src/")
    || isPackageSourcePath(relativePath)
  ) {
    patterns.push(...legacyHostedDemandPatterns);
  }

  return patterns;
}

async function collectHostedTemporalPatchRetirementFindings():
  Promise<HostedTemporalGuardFinding[]> {
  const findings: HostedTemporalGuardFinding[] = [];

  for (const check of hostedTemporalPatchRetirementChecks) {
    const contents = await readOptionalRepoTextFile(check.filePath);
    if (contents === null) {
      findings.push({
        filePath: check.filePath,
        label: `${check.label}: required file is missing`,
        line: 1,
        token: "missing",
      });
      continue;
    }

    const match = findFirstPatternMatch(contents, check.pattern);
    if (match === null) {
      findings.push({
        filePath: check.filePath,
        label: check.label,
        line: 1,
        token: check.token,
      });
    }
  }

  return findings;
}

async function readOptionalRepoTextFile(
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

function shouldScanTextFile(relativePath: string): boolean {
  const normalizedPath = normalizeRepoPath(relativePath);
  const extension = path.posix.extname(normalizedPath);
  return textFileExtensions.has(extension) && !isTestLikePath(normalizedPath);
}

function isPackageSourcePath(relativePath: string): boolean {
  return relativePath.startsWith("packages/") && relativePath.includes("/src/");
}

function isTemporalWorkflowHistorySurface(relativePath: string): boolean {
  return isTemporalWorkflowSourcePath(relativePath)
    || relativePath === "packages/hosted-orchestrator-temporal/src/workflow-types.ts"
    || relativePath === "packages/hosted-execution/src/orchestration-control.ts";
}

function isTemporalWorkflowSourcePath(relativePath: string): boolean {
  return relativePath.startsWith("packages/hosted-orchestrator-temporal/src/workflows/");
}

function findFirstPatternMatch(
  contents: string,
  pattern: RegExp,
): { line: number; token: string } | null {
  const lines = contents.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (match?.[0]) {
      return {
        line: index + 1,
        token: match[0],
      };
    }
  }

  return null;
}

function buildTokenPattern(tokens: readonly string[]): RegExp {
  return new RegExp(
    `\\b(?:${tokens.map(escapeRegExp).join("|")})\\b`,
    "u",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isTestLikePath(relativePath: string): boolean {
  const baseName = path.posix.basename(relativePath);
  const segments = relativePath.split("/");

  if (baseName.includes(".test.") || baseName.includes(".spec.")) {
    return true;
  }

  return segments.some((segment) =>
    segment === "__fixtures__"
    || segment === "__tests__"
    || segment === "fixtures"
    || segment === "test"
    || segment === "tests"
  );
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
