import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const installScriptPath = path.join(repoRoot, "apps/web/public/install.sh");

function writeExecutable(filePath: string, contents: string) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

describe("public install script", () => {
  it("prefers the active npm prefix murph binary over a stale PATH binary", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "murph-install-script-"));

    try {
      const homeDir = path.join(tempRoot, "home");
      const prefixDir = path.join(tempRoot, "prefix");
      const fakeBinDir = path.join(tempRoot, "fake-bin");
      const staleBinDir = path.join(tempRoot, "stale-bin");
      const freshInvocationLog = path.join(tempRoot, "fresh-murph.log");
      const staleInvocationLog = path.join(tempRoot, "stale-murph.log");

      mkdirSync(homeDir, { recursive: true });
      mkdirSync(path.join(prefixDir, "bin"), { recursive: true });
      mkdirSync(fakeBinDir, { recursive: true });
      mkdirSync(staleBinDir, { recursive: true });

      writeExecutable(
        path.join(fakeBinDir, "node"),
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-p" && "\${2:-}" == "process.versions.node" ]]; then
  printf '24.14.1\\n'
  exit 0
fi
printf 'unexpected node args: %s\\n' "$*" >&2
exit 1
`,
      );

      writeExecutable(
        path.join(fakeBinDir, "npm"),
        `#!/usr/bin/env bash
set -euo pipefail
prefix=${JSON.stringify(prefixDir)}
fresh_log=${JSON.stringify(freshInvocationLog)}
if [[ "\${1:-}" == "-v" ]]; then
  printf '11.11.0\\n'
  exit 0
fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "get" && "\${3:-}" == "prefix" ]]; then
  printf '%s\\n' "$prefix"
  exit 0
fi
if [[ "\${1:-}" == "view" ]]; then
  printf '0.0.0-test\\n'
  exit 0
fi
if printf '%s\\n' "$*" | grep -q -- 'install -g'; then
  mkdir -p "$prefix/bin"
  cat > "$prefix/bin/murph" <<'EOF_MURPH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(freshInvocationLog)}
printf 'fresh murph ran\\n'
EOF_MURPH
  chmod 755 "$prefix/bin/murph"
  exit 0
fi
printf 'unexpected npm args: %s\\n' "$*" >&2
exit 1
`,
      );

      writeExecutable(
        path.join(staleBinDir, "murph"),
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(staleInvocationLog)}
printf 'stale murph should not run\\n' >&2
exit 17
`,
      );

      const output = execFileSync(
        "/bin/bash",
        [
          installScriptPath,
          "--install-method",
          "npm",
          "--no-onboard",
          "--no-prompt",
        ],
        {
          cwd: tempRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}:${staleBinDir}:/usr/bin:/bin`,
          },
          encoding: "utf8",
        },
      );

      expect(output).toContain(`Resolved murph executable at ${path.join(prefixDir, "bin/murph")}`);
      expect(output).toContain("Murph install complete");
      expect(readFileSync(freshInvocationLog, "utf8")).toContain("onboard --format md");
      expect(existsSync(staleInvocationLog)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
