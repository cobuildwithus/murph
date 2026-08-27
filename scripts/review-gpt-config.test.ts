import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoots: string[] = [];

interface ConfigHarness {
  configPath: string;
  fakeBin: string;
  gitCalls: string;
  home: string;
  installedBrowserFallback: string;
  mdfindMarker: string;
  primaryRoot: string;
  taskRoot: string;
  xdgConfigHome: string;
}

function createTempRoot(): string {
  const ownedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!ownedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = realpathSync(
    mkdtempSync(path.join(ownedTempRoot, "review-gpt-config-")),
  );
  tempRoots.push(root);
  return root;
}

function writeExecutable(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createHarness(localConfig = ""): ConfigHarness {
  const root = createTempRoot();
  const taskRoot = path.join(root, "task-worktree");
  const primaryRoot = path.join(root, "primary-checkout");
  const fakeBin = path.join(root, "bin");
  const home = path.join(root, "home");
  const xdgConfigHome = path.join(root, "config");
  const configPath = path.join(taskRoot, "scripts", "review-gpt.config.sh");
  const gitCalls = path.join(root, "git-calls.txt");
  const mdfindMarker = path.join(root, "mdfind-called.txt");
  const installedBrowserFallback = path.join(root, "missing-installed-brave");

  mkdirSync(path.dirname(configPath), { recursive: true });
  mkdirSync(path.join(primaryRoot, ".git"), { recursive: true });
  mkdirSync(path.join(xdgConfigHome, "murph"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    configPath,
    readFileSync(path.join(repoRoot, "scripts", "review-gpt.config.sh"), "utf8"),
  );
  writeFileSync(
    path.join(xdgConfigHome, "murph", "review-gpt.conf"),
    localConfig,
  );

  writeExecutable(
    path.join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nexit 1\n",
  );
  writeExecutable(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${MURPH_TEST_GIT_CALLS:?}"
if [[ "$#" -eq 5 \
  && "$1" == "-C" \
  && "$2" == "\${MURPH_TEST_TASK_ROOT:?}" \
  && "$3" == "rev-parse" \
  && "$4" == "--path-format=absolute" \
  && "$5" == "--git-common-dir" ]]; then
  printf '%s\\n' "\${MURPH_TEST_PRIMARY_ROOT:?}/.git"
  exit 0
fi
printf 'unexpected git invocation: %s\\n' "$*" >&2
exit 64
`,
  );
  writeExecutable(
    path.join(fakeBin, "mdfind"),
    `#!/usr/bin/env bash
set -euo pipefail
: > "\${MURPH_TEST_MDFIND_MARKER:?}"
printf '%s\\n' "\${MURPH_TEST_PRIMARY_APP:-}"
`,
  );

  return {
    configPath,
    fakeBin,
    gitCalls,
    home,
    installedBrowserFallback,
    mdfindMarker,
    primaryRoot,
    taskRoot,
    xdgConfigHome,
  };
}

function runConfig(
  harness: ConfigHarness,
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
review_gpt_register_dir_preset() { :; }
review_gpt_register_preset_group() { :; }
review_gpt_installed_browser_binary="\${MURPH_TEST_INSTALLED_BROWSER_FALLBACK:?}"
source "\${MURPH_TEST_CONFIG_PATH:?}"
printf 'count=%s\\n' "$review_gpt_browser_lane_count"
if declare -p review_gpt_browser_lanes >/dev/null 2>&1; then
  printf 'pool=%s\\n' "\${review_gpt_browser_lanes[*]}"
else
  printf 'pool=\\n'
fi
printf 'selected=%s\\n' "$review_gpt_selected_browser_lane"
printf 'binary=%s\\n' "$browser_binary_path"
`,
    ],
    {
      encoding: "utf8",
      env: {
        HOME: harness.home,
        LANG: "C",
        LC_ALL: "C",
        MURPH_TEST_CONFIG_PATH: harness.configPath,
        MURPH_TEST_GIT_CALLS: harness.gitCalls,
        MURPH_TEST_INSTALLED_BROWSER_FALLBACK:
          harness.installedBrowserFallback,
        MURPH_TEST_MDFIND_MARKER: harness.mdfindMarker,
        MURPH_TEST_PRIMARY_ROOT: harness.primaryRoot,
        MURPH_TEST_TASK_ROOT: harness.taskRoot,
        PATH: `${harness.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: harness.xdgConfigHome,
        ...environment,
      },
    },
  );
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { force: true, recursive: true });
  }
});

describe("ReviewGPT repository config", () => {
  it("includes every managed lane in the default automatic pool", () => {
    const harness = createHarness();
    const result = runConfig(harness, {
      REVIEW_GPT_BROWSER_LANE: "auto",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("count=6\n");
    expect(result.stdout).toContain(
      "pool=eragon phlebas hercules mountain vonneumann apollo\n",
    );
    expect(existsSync(harness.mdfindMarker)).toBe(false);
  });

  it("keeps an explicit per-run lane count above local preferences", () => {
    const harness = createHarness(
      "REVIEW_GPT_BROWSER_LANE_COUNT=6\nMURPH_REVIEW_GPT_BROWSER_LANE_COUNT=5\n",
    );
    const result = runConfig(harness, {
      REVIEW_GPT_BROWSER_LANE: "auto",
      REVIEW_GPT_BROWSER_LANE_COUNT: "2",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("count=2\n");
    expect(result.stdout).toContain("pool=eragon phlebas\n");
    expect(existsSync(harness.mdfindMarker)).toBe(false);
  });

  it("keeps the direct compatibility count above a local standard preference", () => {
    const harness = createHarness("REVIEW_GPT_BROWSER_LANE_COUNT=6\n");
    const result = runConfig(harness, {
      MURPH_REVIEW_GPT_BROWSER_LANE_COUNT: "3",
      REVIEW_GPT_BROWSER_LANE: "auto",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("count=3\n");
    expect(result.stdout).toContain("pool=eragon phlebas hercules\n");
    expect(existsSync(harness.mdfindMarker)).toBe(false);
  });

  it("uses the local count only when the invocation supplies no count", () => {
    const harness = createHarness("REVIEW_GPT_BROWSER_LANE_COUNT=6\n");
    const result = runConfig(harness, {
      REVIEW_GPT_BROWSER_LANE: "auto",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("count=6\n");
    expect(result.stdout).toContain(
      "pool=eragon phlebas hercules mountain vonneumann apollo\n",
    );
    expect(existsSync(harness.mdfindMarker)).toBe(false);
  });

  it("resolves a named lane from the exact primary checkout without Spotlight", () => {
    const harness = createHarness();
    const primaryApp = path.join(
      harness.primaryRoot,
      "output-packages",
      "review-gpt-profiles",
      "apollo",
      "Apollo.app",
    );
    const primaryBinary = path.join(
      primaryApp,
      "Contents",
      "MacOS",
      "Brave Browser",
    );
    writeExecutable(primaryBinary, "#!/usr/bin/env bash\nexit 0\n");

    const result = runConfig(harness, {
      MURPH_TEST_PRIMARY_APP: primaryApp,
      REVIEW_GPT_BROWSER_LANE: "apollo",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("selected=apollo\n");
    expect(result.stdout).toContain(`binary=${primaryBinary}\n`);
    expect(readFileSync(harness.gitCalls, "utf8")).toBe(
      `-C ${harness.taskRoot} rev-parse --path-format=absolute --git-common-dir\n`,
    );
    expect(existsSync(harness.mdfindMarker)).toBe(false);
  });
});
