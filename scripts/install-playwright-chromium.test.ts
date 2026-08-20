import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "install-playwright-chromium.sh");
const WORKFLOWS_CALLING_SCRIPT = [
  "web-viewport-overflow.yml",
  "hosted-stripe-billing.yml",
  "pr-1498-design-proof-capture.yml",
] as const;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

/**
 * Runs the real wrapper with a fake `pnpm` first on PATH, so every assertion is
 * about the shipped script rather than a re-implementation of it.
 */
function runWrapper(input: {
  attempts?: string;
  fakePnpm: string;
  graceSeconds?: string;
  timeoutSeconds?: string;
}) {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, "playwright-install-"));
  tempRoots.push(root);
  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const pnpmPath = path.join(binDir, "pnpm");
  writeFileSync(pnpmPath, input.fakePnpm);
  chmodSync(pnpmPath, 0o755);

  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_PLAYWRIGHT_INSTALL_ATTEMPTS: input.attempts ?? "2",
      MURPH_PLAYWRIGHT_INSTALL_BACKOFF_SECONDS: "0",
      MURPH_PLAYWRIGHT_INSTALL_KILL_GRACE_SECONDS: input.graceSeconds ?? "3",
      MURPH_PLAYWRIGHT_INSTALL_KILL_POLL_SECONDS: "2",
      MURPH_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS: input.timeoutSeconds ?? "2",
      MURPH_TEST_STATE_DIR: root,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
  });

  return { result, root };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("install-playwright-chromium.sh", () => {
  it("is executable and syntactically valid", () => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", scriptPath]).status).toBe(0);
  });

  it("returns success without retrying when the install succeeds", () => {
    const { result, root } = runWrapper({
      fakePnpm: [
        "#!/usr/bin/env bash",
        'echo "$@" >> "$MURPH_TEST_STATE_DIR/attempts"',
        "exit 0",
      ].join("\n"),
    });

    expect(result.status).toBe(0);
    const attempts = readFileSync(path.join(root, "attempts"), "utf8")
      .trim()
      .split("\n");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toBe(
      "--dir apps/web exec playwright install --with-deps chromium",
    );
  });

  it("recovers when only the first attempt stalls", () => {
    const { result, root } = runWrapper({
      fakePnpm: [
        "#!/usr/bin/env bash",
        'echo attempt >> "$MURPH_TEST_STATE_DIR/attempts"',
        'if [[ -f "$MURPH_TEST_STATE_DIR/stalled-once" ]]; then',
        "  exit 0",
        "fi",
        'touch "$MURPH_TEST_STATE_DIR/stalled-once"',
        "sleep 120",
      ].join("\n"),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("stalled for 2s on attempt 1/2; retrying");
    expect(
      readFileSync(path.join(root, "attempts"), "utf8").trim().split("\n"),
    ).toHaveLength(2);
    expect(result.stderr.match(/retrying/gu)).toHaveLength(1);
  });

  it("stops after the configured attempts when every install stalls", () => {
    const { result, root } = runWrapper({
      attempts: "3",
      fakePnpm: [
        "#!/usr/bin/env bash",
        'echo attempt >> "$MURPH_TEST_STATE_DIR/attempts"',
        "sleep 120",
      ].join("\n"),
    });

    // 124 is the coreutils convention for a deadline, kept so a reader of the
    // CI log can tell a stall from a genuine install failure.
    expect(result.status).toBe(124);
    expect(result.stderr).toContain("on attempt 3/3; giving up");
    expect(
      readFileSync(path.join(root, "attempts"), "utf8").trim().split("\n"),
    ).toHaveLength(3);
    expect(result.stderr.match(/retrying/gu)).toHaveLength(2);
  });

  it("leaves no install descendant after a terminal timeout", () => {
    const { result, root } = runWrapper({
      attempts: "1",
      graceSeconds: "2",
      fakePnpm: [
        "#!/usr/bin/env bash",
        "# Keep both the leader and nested installer alive through TERM so the",
        "# wrapper must use its owned process-group KILL escalation.",
        'bash -c \'trap "" TERM; echo $$ > "$MURPH_TEST_STATE_DIR/terminal-descendant.pid"; while true; do sleep 1; done\' &',
        'trap "" TERM',
        "sleep 120",
      ].join("\n"),
    });

    expect(result.status).toBe(124);
    const descendantPid = Number.parseInt(
      readFileSync(path.join(root, "terminal-descendant.pid"), "utf8").trim(),
      10,
    );
    expect(isAlive(descendantPid)).toBe(false);
  });

  it("preserves a real install failure instead of retrying it away forever", () => {
    const { result, root } = runWrapper({
      fakePnpm: [
        "#!/usr/bin/env bash",
        'echo attempt >> "$MURPH_TEST_STATE_DIR/attempts"',
        "exit 7",
      ].join("\n"),
    });

    expect(result.status).toBe(7);
    expect(result.stderr).toContain("failed with exit 7");
    expect(
      readFileSync(path.join(root, "attempts"), "utf8").trim().split("\n"),
    ).toHaveLength(2);
    expect(result.stderr.match(/retrying/gu)).toHaveLength(1);
  });

  it("kills a stalled install's descendants before the next attempt starts", () => {
    // The real attempt is a process tree (pnpm -> Playwright -> apt-get). A
    // descendant that outlives its attempt would still hold the package-manager
    // lock the retry needs, so the wrapper must reap the whole group.
    const { result, root } = runWrapper({
      graceSeconds: "5",
      fakePnpm: [
        "#!/usr/bin/env bash",
        'echo attempt >> "$MURPH_TEST_STATE_DIR/attempts"',
        'if [[ -f "$MURPH_TEST_STATE_DIR/descendant.pid" ]]; then',
        '  descendant_pid="$(cat "$MURPH_TEST_STATE_DIR/descendant.pid")"',
        '  if kill -0 "$descendant_pid" 2>/dev/null; then',
        '    touch "$MURPH_TEST_STATE_DIR/overlap"',
        "    exit 9",
        "  fi",
        "  exit 0",
        "fi",
        "# A nested installer that ignores TERM, like apt mid-transaction.",
        'bash -c \'trap "" TERM; echo $$ > "$MURPH_TEST_STATE_DIR/descendant.pid"; while true; do sleep 1; done\' &',
        'trap "" TERM',
        "sleep 120",
      ].join("\n"),
    });

    expect(result.status).toBe(0);
    expect(existsSync(path.join(root, "overlap"))).toBe(false);
    expect(
      readFileSync(path.join(root, "attempts"), "utf8").trim().split("\n"),
    ).toHaveLength(2);

    const descendantPid = Number.parseInt(
      readFileSync(path.join(root, "descendant.pid"), "utf8").trim(),
      10,
    );
    expect(Number.isInteger(descendantPid)).toBe(true);
    expect(isAlive(descendantPid)).toBe(false);
  });

  it("keeps its worst case below every calling workflow's step ceiling", () => {
    const script = readFileSync(scriptPath, "utf8");
    const readDefault = (name: string): number => {
      const match = new RegExp(`${name}:-(\\d+)`, "u").exec(script);
      expect(match?.[1], `${name} default`).toBeDefined();
      return Number.parseInt(match?.[1] ?? "0", 10);
    };

    const attempts = readDefault("MURPH_PLAYWRIGHT_INSTALL_ATTEMPTS");
    const attemptTimeout = readDefault("MURPH_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS");
    const killGrace = readDefault("MURPH_PLAYWRIGHT_INSTALL_KILL_GRACE_SECONDS");
    const killPoll = readDefault("MURPH_PLAYWRIGHT_INSTALL_KILL_POLL_SECONDS");
    const backoff = readDefault("MURPH_PLAYWRIGHT_INSTALL_BACKOFF_SECONDS");
    const worstCaseSeconds =
      attempts * (attemptTimeout + killGrace + killPoll) +
      (attempts - 1) * backoff;

    for (const workflow of WORKFLOWS_CALLING_SCRIPT) {
      const contents = readFileSync(
        path.join(repoRoot, ".github", "workflows", workflow),
        "utf8",
      );
      const step =
        /- name: Install Playwright Chromium\n\s+timeout-minutes: (\d+)\n\s+run: scripts\/install-playwright-chromium\.sh/u.exec(
          contents,
        );
      expect(step?.[1], `${workflow} install step`).toBeDefined();
      const ceilingSeconds = Number.parseInt(step?.[1] ?? "0", 10) * 60;

      // Headroom, not just inequality: the script must always outlive its own
      // last attempt long enough to report a terminal status.
      expect(ceilingSeconds - worstCaseSeconds).toBeGreaterThanOrEqual(120);
    }
  });
});
