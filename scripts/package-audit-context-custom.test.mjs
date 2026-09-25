import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

for (const status of [0, 17]) {
  test(`custom audit packaging bounds warnings and preserves exit ${status}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "murph-custom-audit-proof-"));
    try {
      mkdirSync(path.join(root, "scripts"));
      mkdirSync(path.join(root, "bin"));
      writeFileSync(path.join(root, "scripts/package-audit-context-full.sh"),
        readFileSync(path.join(scriptRoot, "package-audit-context-full.sh")));
      writeFileSync(path.join(root, "scripts/review-gpt-context-policy.sh"), "");
      writeFileSync(path.join(root, "scripts/repo-tools.config.sh"), `
repo_tools_join_lines() { :; }
cobuild_repo_tool_bin() { printf '%s\\n' "$PWD/bin/packager"; }
`);
      writeFileSync(path.join(root, "bin/pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      writeFileSync(path.join(root, "bin/packager"), `#!/bin/sh
awk 'BEGIN { for (i=0; i<20000; i++) print "Warning: excluding path from audit package: synthetic/excluded/path/record.txt" }' >&2
printf 'meaningful diagnostic\\n' >&2
printf 'ZIP: synthetic.zip (42 files)\\n'
exit ${status}
`, { mode: 0o755 });
      const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}` };
      for (const key of Object.keys(env)) {
        if (key.startsWith("REVIEW_GPT_") || key.startsWith("COBUILD_AUDIT_")) delete env[key];
      }
      const result = spawnSync("bash", ["scripts/package-audit-context-full.sh", "--zip"], {
        cwd: root, env, encoding: "utf8", timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, status);
      assert.equal(result.stdout, "ZIP: synthetic.zip (42 files)\n");
      assert.match(result.stderr, /meaningful diagnostic/);
      assert.match(result.stderr, /excluded 20000 paths/);
      assert.ok(result.stderr.length < 200);
      const [run] = readdirSync(path.join(root, "audit-packages"));
      const diagnostics = readFileSync(path.join(root, "audit-packages", run, "package-errors.txt"), "utf8");
      assert.ok(diagnostics.length > 1024 * 1024);
      assert.match(diagnostics, /meaningful diagnostic/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
