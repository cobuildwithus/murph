import { homedir, userInfo } from "node:os";

export const FROG_AUTOFIX_REPOSITORY = "cobuildwithus/murph";
export const FROG_AUTOFIX_BOT = "app/murph-frog-reconciliation";
export const FROG_AUTOFIX_LABEL = "enhancement";
export const FROG_AUTOFIX_BRANCH_PREFIX = "agent/frog-autofix-";
export const FROG_AUTOFIX_LAUNCH_LABEL = "ai.withmurph.frog-autofix";
export const FROG_AUTOFIX_INTERVAL_SECONDS = 7_200;
export const FROG_AUTOFIX_WORKER_TIMEOUT_MS = 4 * 60 * 60 * 1_000;

export interface FrogIssue {
  author: { login: string } | null;
  labels: Array<{ name: string }>;
  number: number;
  state: string;
}

export type EventName =
  | "blocked"
  | "installed"
  | "no_eligible_issue"
  | "uninstalled"
  | "worker_closed_issue"
  | "worker_failed"
  | "worker_incomplete"
  | "worker_started"
  | "worker_timed_out";

export interface EventRecord {
  at: string;
  event: EventName;
  issue?: number;
  status?: number;
}

const eventNames = new Set<EventName>([
  "blocked",
  "installed",
  "no_eligible_issue",
  "uninstalled",
  "worker_closed_issue",
  "worker_failed",
  "worker_incomplete",
  "worker_started",
  "worker_timed_out",
]);

export function normalizeGitHubRepository(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/u, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/u.exec(
    trimmed,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

export function isTrustedFrogIssue(issue: FrogIssue): boolean {
  return issue.state === "OPEN"
    && issue.author?.login === FROG_AUTOFIX_BOT
    && issue.labels.some((label) => label.name === FROG_AUTOFIX_LABEL)
    && Number.isSafeInteger(issue.number)
    && issue.number > 0;
}

export function selectEligibleFrogIssue(
  issues: FrogIssue[],
  bindingCounts: ReadonlyMap<number, number>,
): FrogIssue | null {
  return issues
    .filter(
      (issue) => isTrustedFrogIssue(issue) && bindingCounts.get(issue.number) === 1,
    )
    .sort((left, right) => left.number - right.number)[0] ?? null;
}

export function renderLaunchAgentPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${FROG_AUTOFIX_LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec "$HOME/Library/Application Support/Murph/FrogAutofix/launch"</string>
  </array>
  <key>ProcessType</key>
  <string>Background</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${FROG_AUTOFIX_INTERVAL_SECONDS}</integer>
</dict>
</plist>
`;
}

export function renderInstalledLauncher(): string {
  return `#!/bin/zsh
set -eu

support_root="$HOME/Library/Application Support/Murph/FrogAutofix"
repo_relative="$(<"$support_root/repo-relative")"

case "$repo_relative" in
  ""|/*|../*|*/../*|*/..)
    exit 2
    ;;
esac

exec "$HOME/$repo_relative/scripts/frog-autofix" run
`;
}

export function renderWorkerPrompt(template: string, issueNumber: number): string {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("invalid issue number");
  }
  if (!template.includes("{{ISSUE_NUMBER}}")) {
    throw new Error("worker template is missing its issue placeholder");
  }
  return template.replaceAll("{{ISSUE_NUMBER}}", String(issueNumber));
}

export function safeFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unexpected local failure";
  const message = error.message.trim();
  const localUsername = userInfo().username;
  if (
    !message
    || message.length > 200
    || /[\r\n]/u.test(message)
    || message.includes(homedir())
    || (localUsername && message.includes(localUsername))
    || /\/Users\/[A-Za-z0-9._-]+/u.test(message)
  ) {
    return "unexpected local failure";
  }
  return message;
}

export function buildCodexWorkerArguments(options: {
  browserProfileRoot: string;
  codexHome: string;
  gitCommonDirectory: string;
  helper: string;
  outputDirectory: string;
  promptFile: string;
  worktree: string;
}): string[] {
  return [
    options.helper,
    "--jobs",
    "1",
    "--cd",
    options.worktree,
    "--out-dir",
    options.outputDirectory,
    "--sandbox",
    "workspace-write",
    "--full-auto",
    "--raw-prompts",
    "--codex-home",
    options.codexHome,
    "--codex-arg",
    "-c",
    "--codex-arg",
    "sandbox_workspace_write.network_access=true",
    "--codex-arg",
    "--add-dir",
    "--codex-arg",
    options.browserProfileRoot,
    "--codex-arg",
    "--add-dir",
    "--codex-arg",
    options.outputDirectory,
    "--codex-arg",
    "--add-dir",
    "--codex-arg",
    options.gitCommonDirectory,
    options.promptFile,
  ];
}

export function parseEventLog(raw: string): EventRecord[] | null {
  const records: EventRecord[] = [];
  for (const line of raw.trimEnd().split("\n").filter(Boolean)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Partial<EventRecord> & Record<string, unknown>;
    if (
      Object.keys(candidate).some(
        (key) => !["at", "event", "issue", "status"].includes(key),
      )
      || typeof candidate.at !== "string"
      || Number.isNaN(Date.parse(candidate.at))
      || typeof candidate.event !== "string"
      || !eventNames.has(candidate.event as EventName)
      || (candidate.issue !== undefined
        && (!Number.isSafeInteger(candidate.issue) || Number(candidate.issue) <= 0))
      || (candidate.status !== undefined && !Number.isSafeInteger(candidate.status))
    ) {
      return null;
    }
    records.push(candidate as EventRecord);
  }
  return records;
}
