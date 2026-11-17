import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { currentReach, diffReach, reachOutputs, readWorkspace } from "./ci-diff-reach.mjs";

/** @param {string} root @param {Record<string, string>} files */
async function writeTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

const manifest = (/** @type {string} */ name, /** @type {string[]} */ deps = []) =>
  JSON.stringify({ name, dependencies: Object.fromEntries(deps.map((dep) => [dep, "workspace:*"])) });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-diff-reach-"));
  await writeTree(root, {
    "apps/web/package.json": manifest("web", ["core", "leaf"]),
    "apps/cloudflare/package.json": manifest("cloudflare", ["core"]),
    "packages/core/package.json": manifest("core"),
    "packages/leaf/package.json": manifest("leaf"),
    "packages/tool/package.json": manifest("tool", ["core"]),
    "packages/tool/test/reads-web.test.ts": "readFileSync('apps/web/public/logo.svg');\n",
    "packages/tool/test/plain.test.ts": "// see apps/web/src for the caller\n",
    "packages/stale/README.md": "no manifest: not a workspace package\n",
  });
  return root;
}

test("a change reaches its dependents, and either app brings both apps and their file readers", async () => {
  const root = await fixture();
  try {
    const workspace = readWorkspace(root);
    assert.deepEqual(Object.fromEntries(workspace.appTests),
      { "packages/tool": ["packages/tool/test/reads-web.test.ts"] });

    const leaf = diffReach(["packages/leaf/src/index.ts"], workspace);
    assert.deepEqual(leaf, {
      full: false,
      changed: ["apps/web", "packages/leaf"],
      apps: true,
      appTests: { "packages/tool": ["packages/tool/test/reads-web.test.ts"] },
    });
    assert.deepEqual(reachOutputs(leaf), {
      full: "false",
      apps: "true",
      runner_bundle: "false",
      cli: "false",
      packages: '["packages/leaf"]',
      app_tests: '{"packages/tool":["packages/tool/test/reads-web.test.ts"]}',
    });

    const core = diffReach(["packages/core/src/a.ts"], workspace);
    assert.deepEqual(core.changed,
      ["apps/cloudflare", "apps/web", "packages/core", "packages/tool"]);
    assert.deepEqual(core.appTests, {}, "a package whose code changed runs its whole suite");
    assert.equal(reachOutputs(core).runner_bundle, "true");

    const tool = diffReach(["packages/tool/test/plain.test.ts"], workspace);
    assert.deepEqual(tool, { full: false, changed: ["packages/tool"], apps: false, appTests: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("anything outside one workspace package, or nothing at all, runs everything", async () => {
  const root = await fixture();
  try {
    const workspace = readWorkspace(root);
    for (const files of [[], ["README.md"], ["packages/leaf/a.ts", ".github/workflows/x.yml"],
      ["packages/stale/README.md"], ["apps/webby/a.ts"], ["packages/core"]]) {
      const reach = diffReach(files, workspace);
      assert.equal(reach.full, true, JSON.stringify(files));
      assert.equal(reach.apps, true);
      assert.deepEqual(reach.changed, workspace.dirs);
      assert.deepEqual(reach.appTests, {});
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only a pull request's exact merge commit narrows the run", async () => {
  const root = await fixture();
  const git = (/** @type {string[]} */ ...args) => execFileSync("git",
    ["-c", "user.name=reach-test", "-c", "user.email=reach-test@users.noreply.github.com", ...args],
    { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "topic");
    await writeTree(root, { "packages/leaf/src/index.ts": "export {};\n" });
    git("add", ".");
    git("commit", "-qm", "topic");
    git("checkout", "-q", "main");
    await writeTree(root, { "packages/core/src/index.ts": "export {};\n" });
    git("add", ".");
    git("commit", "-qm", "main moved");
    git("merge", "-q", "--no-ff", "-m", "merge", "topic");

    const pull = currentReach({ GITHUB_EVENT_NAME: "pull_request" }, root);
    assert.equal(pull.full, false);
    assert.deepEqual(pull.changed, ["apps/web", "packages/leaf"], "the base's own changes are not the PR's");
    assert.equal(currentReach({ GITHUB_EVENT_NAME: "push" }, root).full, true);
    git("reset", "-q", "--hard", "HEAD^1");
    assert.equal(currentReach({ GITHUB_EVENT_NAME: "pull_request" }, root).full, true,
      "a head that is not a merge commit runs everything");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
