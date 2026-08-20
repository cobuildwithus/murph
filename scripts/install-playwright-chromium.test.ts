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
  "hosted-stripe-billing.yml",
  "pr-1498-design-proof-capture.yml",
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
function runWrapper(input: { aptConfig?: string; pnpmExit?: number } = {}) {
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
      'if [[ "$1" != "tee" ]]; then exit 2; fi',
      'cat > "$MURPH_TEST_STATE_DIR/apt-policy"',
    ].join("\n"),
  );
  writeExecutable(
    path.join(binDirectory, "apt-config"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "$*" >> "$MURPH_TEST_STATE_DIR/apt-config-calls"',
      'if [[ -n "${MURPH_TEST_APT_CONFIG:-}" ]]; then',
      '  printf \'%s\\n\' "$MURPH_TEST_APT_CONFIG"',
      "else",
      '  cat "$MURPH_TEST_STATE_DIR/apt-policy"',
      "fi",
    ].join("\n"),
  );
  writeExecutable(
    path.join(binDirectory, "pnpm"),
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "$*" >> "$MURPH_TEST_STATE_DIR/pnpm-calls"',
      'exit "${MURPH_TEST_PNPM_EXIT:-0}"',
    ].join("\n"),
  );

  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_TEST_APT_CONFIG: input.aptConfig ?? "",
      MURPH_TEST_PNPM_EXIT: String(input.pnpmExit ?? 0),
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

  it("loads the bounded apt policy before invoking Playwright once", () => {
    const { result, root } = runWrapper();

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, "apt-policy"), "utf8")).toBe(
      [
        'Acquire::Retries "1";',
        'Acquire::http::Timeout "180";',
        'Acquire::https::Timeout "180";',
        "",
      ].join("\n"),
    );
    expect(readFileSync(path.join(root, "sudo-calls"), "utf8").trim()).toBe(
      "tee /etc/apt/apt.conf.d/99murph-playwright",
    );
    expect(readFileSync(path.join(root, "apt-config-calls"), "utf8").trim()).toBe(
      "dump",
    );
    expect(readFileSync(path.join(root, "pnpm-calls"), "utf8").trim()).toBe(
      "--dir apps/web exec playwright install --with-deps chromium",
    );
  });

  it("fails before Playwright when apt did not load the checked policy", () => {
    const { result, root } = runWrapper({
      aptConfig: [
        'Acquire::Retries "1";',
        'Acquire::http::Timeout "180";',
      ].join("\n"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Playwright apt policy was not loaded: Acquire::https::Timeout "180";',
    );
    expect(existsSync(path.join(root, "pnpm-calls"))).toBe(false);
  });

  it("propagates the one Playwright invocation's final status", () => {
    const { result, root } = runWrapper({ pnpmExit: 7 });

    expect(result.status).toBe(7);
    expect(readFileSync(path.join(root, "pnpm-calls"), "utf8").trim().split("\n"))
      .toHaveLength(1);
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
