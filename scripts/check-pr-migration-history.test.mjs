import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findChangedBaseMigrations } from "./check-pr-migration-history.mjs";

const script = fileURLToPath(new URL("./check-pr-migration-history.mjs", import.meta.url));
const migration = "apps/web/prisma/migrations/20300101000000_initial/migration.sql";
const addition = "apps/web/prisma/migrations/20300102000000_forward/migration.sql";

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "migration-history-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  const write = (file, content = "-- synthetic migration\n") => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@users.noreply.github.com",
      "-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  write(migration);
  const baseSha = commit();
  return { cwd, git, write, commit, baseSha };
}

for (const action of ["modify", "delete", "rename"]) {
  test(`rejects a PR that attempts to ${action} merged migration SQL`, (t) => {
    const f = fixture(t);
    if (action === "modify") f.write(migration, "-- changed SQL\n");
    if (action === "delete") f.git("rm", migration);
    if (action === "rename") {
      f.write(addition);
      f.git("rm", migration);
    }
    const headSha = f.commit();
    assert.deepEqual(findChangedBaseMigrations({ ...f, headSha }), [migration]);
    const result = spawnSync(process.execPath, [script], {
      cwd: f.cwd, encoding: "utf8",
      env: { ...process.env, MURPH_PR_BASE_SHA: f.baseSha, MURPH_PR_HEAD_SHA: headSha },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Add a forward migration/u);
    assert.ok(result.stderr.includes(migration));
  });
}

test("allows additions and subsequent edits to a PR's own new migration", (t) => {
  const f = fixture(t);
  f.write(addition);
  f.commit();
  f.write(addition, "-- revised new migration\n");
  f.write("apps/web/prisma/schema.prisma", "// unrelated edit\n");
  const headSha = f.commit();
  assert.deepEqual(findChangedBaseMigrations({ ...f, headSha }), []);
  const result = spawnSync(process.execPath, [script], {
    cwd: f.cwd, encoding: "utf8",
    env: { ...process.env, MURPH_PR_BASE_SHA: f.baseSha, MURPH_PR_HEAD_SHA: headSha },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("ignores unrelated base advances but rejects a new migration path already merged on base", (t) => {
  const f = fixture(t);
  f.write("note.txt", "PR change\n");
  const headSha = f.commit();
  f.git("checkout", "--detach", f.baseSha);
  f.write(addition);
  const baseSha = f.commit();
  assert.deepEqual(findChangedBaseMigrations({ ...f, baseSha, headSha }), []);
  f.git("checkout", "--detach", headSha);
  f.write(addition, "-- conflicting new migration\n");
  assert.deepEqual(findChangedBaseMigrations({ ...f, baseSha, headSha: f.commit() }), [addition]);
});

test("ignores a migration inherited unchanged from a squash-merged parent branch", (t) => {
  const f = fixture(t);
  f.write(addition);
  f.commit();
  f.write("note.txt", "Stacked branch change\n");
  const headSha = f.commit();
  f.git("checkout", "--detach", f.baseSha);
  f.write(addition);
  const baseSha = f.commit();
  assert.deepEqual(findChangedBaseMigrations({ ...f, baseSha, headSha }), []);
});

test("fails closed for missing or unavailable commit SHAs", (t) => {
  const f = fixture(t);
  assert.throws(() => findChangedBaseMigrations({ ...f }), /requires full/u);
  assert.throws(() => findChangedBaseMigrations({ ...f, headSha: "f".repeat(40) }));
});

test("the existing PR evidence workflow runs the guard with exact base and head SHAs", () => {
  const workflow = readFileSync(new URL("../.github/workflows/pr-evidence.yml", import.meta.url), "utf8");
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /scripts\/check-pr-migration-history\.test\.mjs/u);
  assert.match(workflow, /run: node scripts\/check-pr-migration-history\.mjs\n\s+env:\n\s+MURPH_PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n\s+MURPH_PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
});
