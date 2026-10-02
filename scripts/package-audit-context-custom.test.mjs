import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("full audit packaging includes unchanged native patch and skill imports and preserves exclusions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "murph-skill-audit-proof-"));
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}` };
  for (const key of Object.keys(env)) {
    if (key.startsWith("REVIEW_GPT_") || key.startsWith("COBUILD_AUDIT_")) delete env[key];
  }
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  try {
    for (const directory of ["scripts", "bin", "node_modules/.bin", "node_modules/@cobuild"]) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    for (const script of ["package-audit-context-full.sh", "repo-tools.config.sh", "review-gpt-context-policy.sh"]) {
      writeFileSync(path.join(root, "scripts", script), readFileSync(path.join(scriptRoot, script)));
    }
    const repoTools = path.resolve(scriptRoot, "../node_modules/@cobuild/repo-tools");
    symlinkSync(repoTools, path.join(root, "node_modules/@cobuild/repo-tools"));
    symlinkSync(path.join(repoTools, "bin/cobuild-package-audit-context"),
      path.join(root, "node_modules/.bin/cobuild-package-audit-context"));
    // The fixture contains no generated JS; exercise the real archive selection below.
    writeFileSync(path.join(root, "bin/pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(path.join(root, ".gitignore"), "/node_modules/\n/audit-packages/\n");
    const skillRoot = ".agents/skills/example/scripts";
    const changedSource = `${skillRoot}/preview.mjs`;
    const changedTest = "packages/example/test/preview.test.mjs";
    const dependencies = [
      ...["normalize", "fetch-preview", "ocr-preview"].map(name => `${skillRoot}/${name}.mjs`),
      "patches/codex-public-live.patch",
    ];
    const excluded = [
      ".agents/skills/example/.env",
      ".agents/skills/example/cache/residue.mjs",
      ".agents/skills/example/node_modules/residue.mjs",
      ".agents/friction-log/example/friction.md",
    ];
    const files = {
      [changedSource]: "import { normalize } from './normalize.mjs';\nexport const preview = normalize;\n",
      [changedTest]: dependencies.map(file =>
        `import '${path.posix.relative(path.posix.dirname(changedTest), file)}';`).join("\n"),
      ...Object.fromEntries(dependencies.map(file => [file, "export const normalize = value => value;\n"])),
      ...Object.fromEntries(excluded.map(file => [file, "synthetic excluded fixture\n"])),
    };
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    }
    run("git", ["init", "-q"]);
    run("git", ["add", "."]);
    // Full PR packaging adds changed files to ALWAYS_PATHS. Their unchanged
    // owners must come from the full snapshot roots, without caller overrides.
    env.COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS = [changedSource, changedTest].join("\n");
    const output = run("bash", ["scripts/package-audit-context-full.sh", "--zip"]);
    const zip = output.match(/^ZIP: (.+?) \(/m)?.[1];
    assert.ok(zip, output);
    const entries = new Set(run("unzip", ["-Z1", zip]).trim().split("\n"));
    for (const file of [changedSource, changedTest, ...dependencies]) {
      assert.ok(entries.has(file), `archive omitted ${file}`);
    }
    for (const file of excluded) {
      assert.ok(!entries.has(file), `archive included excluded path ${file}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
