import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "install-playwright-chromium.sh");
const workflowDirectory = path.join(repoRoot, ".github", "workflows");
const WORKFLOWS_CALLING_SCRIPT = [
  "host-support.yml",
  "hosted-stripe-billing.yml",
  "web-viewport-overflow.yml",
] as const;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { force: true, recursive: true });
  }
});

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

/** Executes the shipped wrapper while replacing only its external commands. */
function runWrapper(input: { dependencyExit?: number; downloadExit?: number; initialBrowserExit?: number; finalBrowserExit?: number } = {}) {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, "playwright-install-"));
  tempRoots.push(root);
  const binDirectory = path.join(root, "bin");
  mkdirSync(binDirectory, { recursive: true });

  writeExecutable(
    path.join(binDirectory, "sudo"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "$*" >> "$MURPH_TEST_STATE_DIR/sudo-calls"',
      'if [[ "$*" == "rm -f /etc/apt/sources.list.d/google-chrome.sources" ]]; then',
      '  exit 0',
      'fi',
      'if [[ "$1" != "tee" ]]; then exit 2; fi',
      'cat > "$MURPH_TEST_STATE_DIR/apt-policy"',
    ].join("\n"),
  );
  writeExecutable(
    path.join(binDirectory, "pnpm"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "$*" >> "$MURPH_TEST_STATE_DIR/pnpm-calls"',
      'if [[ "$*" == *"install-deps"* ]]; then exit "$MURPH_TEST_DEPENDENCY_EXIT"; fi',
      'if [[ "$*" == *"exec node"* ]]; then',
      '  if [[ -f "$MURPH_TEST_STATE_DIR/probed" ]]; then exit "$MURPH_TEST_FINAL_BROWSER_EXIT"; fi',
      '  touch "$MURPH_TEST_STATE_DIR/probed"',
      '  exit "$MURPH_TEST_INITIAL_BROWSER_EXIT"',
      'fi',
      'exit "$MURPH_TEST_DOWNLOAD_EXIT"',
    ].join("\n"),
  );
  writeExecutable(path.join(binDirectory, "xvfb-run"), [
    "#!/usr/bin/env bash",
    '[[ "$1" == "--auto-servernum" ]] || exit 2',
    'shift',
    'exec "$@"',
  ].join("\n"));

  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_TEST_DEPENDENCY_EXIT: String(input.dependencyExit ?? 0),
      MURPH_TEST_DOWNLOAD_EXIT: String(input.downloadExit ?? 0),
      MURPH_TEST_INITIAL_BROWSER_EXIT: String(input.initialBrowserExit ?? 0),
      MURPH_TEST_FINAL_BROWSER_EXIT: String(input.finalBrowserExit ?? 0),
      MURPH_TEST_STATE_DIR: root,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    },
  });

  return { result, root };
}

describe("install-playwright-chromium.sh", () => {
  it("is executable and syntactically valid", () => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", scriptPath]).status).toBe(0);
  });

  it("repairs missing libraries with the bounded apt policy and verifies the repaired browser", () => {
    const { result, root } = runWrapper({ initialBrowserExit: 9 });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, "apt-policy"), "utf8")).toBe(
      [
        'Acquire::Retries "1";',
        'Acquire::http::Timeout "180";',
        'Acquire::https::Timeout "180";',
        "",
      ].join("\n"),
    );
    expect(readFileSync(path.join(root, "sudo-calls"), "utf8").trim().split("\n"))
      .toEqual([
        "rm -f /etc/apt/sources.list.d/google-chrome.sources",
        "tee /etc/apt/apt.conf.d/zzzz-murph-playwright",
      ]);
    const calls = readFileSync(path.join(root, "pnpm-calls"), "utf8");
    expect(calls).toContain("--dir apps/web exec playwright install-deps chromium");
    expect(calls.match(/--dir apps\/web exec node/gu)).toHaveLength(2);
  });

  it("uses a working browser runtime without depending on the package mirror", () => {
    const { result, root } = runWrapper({ dependencyExit: 100 });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(root, "sudo-calls"))).toBe(false);
    const calls = readFileSync(path.join(root, "pnpm-calls"), "utf8");
    expect(calls).toMatch(/^--dir apps\/web exec playwright install chromium\n/u);
    expect(calls).toContain("--dir apps/web exec node --input-type=module -e");
    expect(calls).not.toContain("install-deps");
  });

  it("retains a failed browser download without launching a probe", () => {
    const { result, root } = runWrapper({ dependencyExit: 100, downloadExit: 7 });

    expect(result.status).toBe(7);
    expect(readFileSync(path.join(root, "pnpm-calls"), "utf8").trim().split("\n"))
      .toHaveLength(1);
    expect(existsSync(path.join(root, "sudo-calls"))).toBe(false);
  });

  it("retains dependency failure when the installed browser is unusable", () => {
    const { result, root } = runWrapper({ initialBrowserExit: 9, dependencyExit: 100 });
    expect(result.status).toBe(100);
    expect(readFileSync(path.join(root, "pnpm-calls"), "utf8").match(/--dir apps\/web exec node/gu)).toHaveLength(1);
  });

  it("fails when the installed browser runtime cannot launch", () => {
    const { result } = runWrapper({ initialBrowserExit: 9, finalBrowserExit: 9 });
    expect(result.status).toBe(9);
  });

  it("keeps an overall timeout ceiling on every Ubuntu caller", () => {
    const actualCallers = readdirSync(workflowDirectory)
      .filter((name) => name.endsWith(".yml"))
      .filter((name) =>
        readFileSync(path.join(workflowDirectory, name), "utf8").includes(
          "scripts/install-playwright-chromium.sh",
        ),
      )
      .sort();

    expect(actualCallers).toEqual([...WORKFLOWS_CALLING_SCRIPT]);
    for (const workflow of actualCallers) {
      const contents = readFileSync(path.join(workflowDirectory, workflow), "utf8");
      expect(contents).toContain("runs-on: ubuntu-24.04");
      const step =
        /- name: Install Playwright Chromium\n\s+timeout-minutes: (\d+)\n\s+run: scripts\/install-playwright-chromium\.sh/u.exec(
          contents,
        );
      expect(step?.[1], `${workflow} install step`).toBeDefined();
      expect(step?.[1]).toBe("14");
    }
  });
});
