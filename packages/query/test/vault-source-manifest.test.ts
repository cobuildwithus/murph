import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";

import { brotliCompressSync } from "node:zlib";

import { afterEach, expect, test, vi } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "@murphai/contracts";

import {
  hashCanonicalQuerySources,
  isCanonicalQuerySourcePath,
  listCanonicalSourceManifest,
  readVaultSourceStrict,
} from "../src/vault-source.ts";

import {
  readBrowserVaultReplicaExperiments,
  readBrowserVaultReplicaSource,
  readBrowserVaultReplicaVault,
  type BrowserVaultReplicaSourceStep,
} from "../src/browser-replica-server.ts";

const tempRoots: string[] = [];

async function createTempVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content = "test\n",
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { recursive: true, force: true })),
  );
});

test("listCanonicalSourceManifest uses shared vault family inclusion rules", async () => {
  const vaultRoot = await createTempVaultRoot();

  await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, `{"formatVersion":${CURRENT_VAULT_FORMAT_VERSION}}\n`);
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core\n");
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "test-experiment.md"),
    "---\nexperimentId: exp_test\nslug: test-experiment\n---\n# Experiment\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "legacy", "nested.md"),
    "---\nexperimentId: exp_nested\nslug: nested\n---\n# Nested legacy experiment\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentOutcomesDirectory, "test-experiment.json"),
    "{}\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-08.md"),
    "---\ndayKey: 2026-04-08\n---\n# Journal\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.goalsDirectory, "test-goal.md"),
    "---\ngoalId: goal_test\ntitle: Test goal\nstatus: active\nhorizon: ongoing\n---\n# Goal\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"id":"evt_1"}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "2026-04.jsonl"),
    '{"id":"aud_1"}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"id":"xfm_1"}\n',
  );

  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily-check-in.md"),
    "---\ntitle: Automation\n---\nPrompt\n",
  );
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.memoryDocument, "---\ntitle: Memory\n---\n# Memory\n");
  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.preferencesDocument,
    '{"schemaVersion":1,"updatedAt":"2026-04-08T00:00:00.000Z","workoutUnitPreferences":{"weight":"kg"}}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026", "2026-04.jsonl"),
    '{"captureId":"capture_1"}\n',
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.rawInboxDirectory, "email", "capture", "envelope.json"),
    '{"schema":"murph.inbox-envelope.v1"}\n',
  );

  const manifest = await listCanonicalSourceManifest(vaultRoot);
  const relativePaths = manifest.map((entry) => entry.relativePath);

  assert.deepEqual(relativePaths, [
    VAULT_LAYOUT.coreDocument,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "test-experiment.md"),
    path.posix.join(VAULT_LAYOUT.goalsDirectory, "test-goal.md"),
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-08.md"),
    path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-04.jsonl"),
    VAULT_LAYOUT.metadata,
  ]);
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily-check-in.md")),
    false,
  );
  assert.equal(relativePaths.includes(VAULT_LAYOUT.memoryDocument), false);
  assert.equal(relativePaths.includes(VAULT_LAYOUT.preferencesDocument), false);
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.inboxCaptureLedgerDirectory, "2026", "2026-04.jsonl")),
    false,
  );
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.rawInboxDirectory, "email", "capture", "envelope.json")),
    false,
  );
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "2026-04.jsonl")),
    false,
  );
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.experimentsDirectory, "legacy", "nested.md")),
    false,
  );
  assert.equal(
    relativePaths.includes(path.posix.join(VAULT_LAYOUT.experimentOutcomesDirectory, "test-experiment.json")),
    false,
  );
});

test("readVaultSourceStrict ignores nested legacy experiment Markdown", async () => {
  const vaultRoot = await createTempVaultRoot();
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "direct.md"),
    "---\nexperimentId: exp_direct\nslug: direct\ntitle: Direct\n---\n# Direct\n",
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "legacy", "nested.md"),
    "---\nexperimentId: exp_nested\nslug: nested\ntitle: Nested\n---\n# Nested\n",
  );

  const snapshot = await readVaultSourceStrict(vaultRoot);
  assert.deepEqual(
    snapshot.entities
      .filter((entity) => entity.family === "experiment")
      .map((entity) => entity.entityId),
    ["exp_direct"],
  );
});

test("readVaultSourceStrict rejects a direct experiment filename that disagrees with its slug", async () => {
  const vaultRoot = await createTempVaultRoot();
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "file-slug.md"),
    "---\nexperimentId: exp_mismatch\nslug: frontmatter-slug\ntitle: Mismatch\n---\n# Mismatch\n",
  );

  await assert.rejects(
    readVaultSourceStrict(vaultRoot),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "QUERY_SOURCE_INVALID"
      && "details" in error
      && typeof error.details === "object"
      && error.details !== null
      && "issue" in error.details
      && error.details.issue === "document_path_mismatch",
  );
});

test("Browser Vault experiment reads preserve default order without parsing unrelated history", async () => {
  const vaultRoot = await createTempVaultRoot();
  for (const [slug, id, date] of [
    ["a-late", "exp_b", "2026-05-02"],
    ["z-early", "exp_z", "2026-05-01"],
    ["b-tie", "exp_a", "2026-05-02"],
  ]) {
    await writeVaultFile(
      vaultRoot,
      `bank/experiments/${slug}.md`,
      `---\nexperimentId: ${id}\nslug: ${slug}\nstartedOn: ${date}\nqueryVisibility: hidden\n---\n# Trial\n`,
    );
  }
  // Neither nested legacy documents nor outcome files are experiment sources.
  await writeVaultFile(vaultRoot, "bank/experiments/legacy/broken.md", "---\nbroken\n");
  await writeVaultFile(vaultRoot, "bank/experiments/outcomes/unreferenced.json", "{\n");
  const expected = (await readBrowserVaultReplicaVault(vaultRoot)).entities
    .filter((entity) => entity.family === "experiment");
  assert.deepEqual(expected.map((entity) => entity.entityId), ["exp_z", "exp_a", "exp_b"]);
  assert.deepEqual(await readBrowserVaultReplicaExperiments(vaultRoot), expected);

  await writeVaultFile(vaultRoot, "ledger/events/2026/2026-05.jsonl", "{\n");
  assert.deepEqual(await readBrowserVaultReplicaExperiments(vaultRoot), expected);
  // The build still rejects malformed canonical history that freshness only hashes.
  await assert.rejects(readBrowserVaultReplicaSource(vaultRoot), {
    code: "VAULT_INVALID_JSONL",
  });
});

test.each([
  ["frontmatter_invalid", "---\nexperimentId: exp_trial\nslug: trial\nbroken line\n---\n"],
  ["missing_field", "---\nslug: trial\n---\n"],
  ["document_path_mismatch", "---\nexperimentId: exp_trial\nslug: other\n---\n"],
])("Browser Vault experiment reads retain strict %s errors", async (issue, contents) => {
  const vaultRoot = await createTempVaultRoot();
  await writeVaultFile(vaultRoot, "bank/experiments/trial.md", contents);
  await expect(readBrowserVaultReplicaExperiments(vaultRoot)).rejects.toMatchObject({
    code: "QUERY_SOURCE_INVALID",
    details: { issue, relativePath: "bank/experiments/trial.md" },
  });
});

test("aborted Browser Vault experiment reads join every started page read", async () => {
  const vaultRoot = await createTempVaultRoot();
  for (const slug of ["first", "second"]) {
    await writeVaultFile(
      vaultRoot,
      `bank/experiments/${slug}.md`,
      `---\nexperimentId: exp_${slug}\nslug: ${slug}\n---\n`,
    );
  }
  const sourcePaths = new Set(["first", "second"].map((slug) =>
    path.join(vaultRoot, `bank/experiments/${slug}.md`)
  ));
  const releases: Array<() => void> = [];
  let started = () => {};
  const readsStarted = new Promise<void>((resolve) => { started = resolve; });
  let readsSettled = 0;
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      async readFile(...args: Parameters<typeof actual.readFile>) {
        const contents = await actual.readFile(...args);
        if (!sourcePaths.has(String(args[0]))) return contents;
        await new Promise<void>((resolve) => {
          releases.push(resolve);
          if (releases.length === 2) started();
        });
        readsSettled += 1;
        return contents;
      },
    };
  });
  try {
    const { readBrowserVaultReplicaExperiments: readExperiments } =
      await import("../src/browser-replica-server.ts");
    const controller = new AbortController();
    const reason = new Error("Synthetic experiment read cancellation");
    controller.abort(reason);
    await expect(readExperiments(vaultRoot, { signal: controller.signal })).rejects.toBe(reason);
    assert.equal(releases.length, 0);

    const active = new AbortController();
    let settled = false;
    const pending = readExperiments(vaultRoot, { signal: active.signal });
    const rejected = expect(pending).rejects.toBe(reason);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await readsStarted;
    active.abort(reason);
    releases[0]!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(readsSettled, 1);
    assert.equal(settled, false);
    releases[1]!();
    await rejected;
    assert.equal(readsSettled, 2);
  } finally {
    releases.forEach((release) => release());
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});

test("hashCanonicalQuerySources is stable across mtimes and ignores non-query files", async () => {
  const vaultRoot = await createTempVaultRoot();
  const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
  const automationPath = path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily.md");
  const auditPath = path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "2026-04.jsonl");
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, `{"formatVersion":${CURRENT_VAULT_FORMAT_VERSION}}\n`);
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial\n---\n# Trial\n");

  const initial = await hashCanonicalQuerySources(vaultRoot);
  await utimes(
    path.join(vaultRoot, experimentPath),
    new Date("2026-05-01T00:00:00.000Z"),
    new Date("2026-05-01T00:00:00.000Z"),
  );
  await writeVaultFile(vaultRoot, automationPath, "---\ntitle: Daily\n---\nPrompt\n");
  await writeVaultFile(vaultRoot, auditPath, '{"id":"aud_1"}\n');
  const touched = await hashCanonicalQuerySources(vaultRoot);

  assert.deepEqual(touched, initial);
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial Changed\n---\n# Trial\n");
  const changed = await hashCanonicalQuerySources(vaultRoot);
  assert.notEqual(changed.hash, initial.hash);
});

test("hashCanonicalQuerySources changes when query-visible files are deleted", async () => {
  const vaultRoot = await createTempVaultRoot();
  const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
  await writeVaultFile(vaultRoot, experimentPath, "---\ntitle: Trial\n---\n# Trial\n");

  const populated = await hashCanonicalQuerySources(vaultRoot);
  await rm(path.join(vaultRoot, experimentPath));
  const empty = await hashCanonicalQuerySources(vaultRoot);

  assert.equal(populated.fileCount, 1);
  assert.equal(empty.fileCount, 0);
  assert.notEqual(empty.hash, populated.hash);
});

test("hashCanonicalQuerySources rejects an already-aborted source read", async () => {
  const vaultRoot = await createTempVaultRoot();
  await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "# Core\n");
  const controller = new AbortController();
  const reason = new DOMException("Source hash was cancelled.", "AbortError");
  controller.abort(reason);

  await assert.rejects(
    hashCanonicalQuerySources(vaultRoot, { signal: controller.signal }),
    (error: unknown) => error === reason,
  );
});

test("isCanonicalQuerySourcePath matches the shared source families", () => {
  assert.equal(isCanonicalQuerySourcePath(VAULT_LAYOUT.metadata), true);
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md")),
    true,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.experimentsDirectory, "legacy", "trial.md")),
    false,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.experimentOutcomesDirectory, "trial.json")),
    false,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "events.jsonl")),
    true,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "audit.jsonl")),
    false,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.integrationIngestLedgerDirectory, "2026", "ingests.jsonl")),
    false,
  );
  assert.equal(
    isCanonicalQuerySourcePath(path.posix.join(VAULT_LAYOUT.automationsDirectory, "daily.md")),
    false,
  );
  assert.equal(isCanonicalQuerySourcePath("../vault.json"), false);
  assert.equal(isCanonicalQuerySourcePath("experiments\\trial.md"), false);
});


test("Brotli event archives enter the source manifest and canonical query reads", async () => {
  const vaultRoot = await createTempVaultRoot();
  const relativePath = "ledger/events/2026/2026-04.jsonl.br";
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
  await writeFile(path.join(vaultRoot, relativePath), brotliCompressSync(
    '{"id":"evt_brotli_synthetic","kind":"note","title":"Archive discovery","occurredAt":"2026-04-01T00:00:00.000Z"}\n',
  ));
  assert.equal(isCanonicalQuerySourcePath(relativePath), true);
  assert.deepEqual((await listCanonicalSourceManifest(vaultRoot)).map((entry) => entry.relativePath), [relativePath]);
  const snapshot = await readVaultSourceStrict(vaultRoot);
  assert.ok(snapshot.entities.some((entity) => entity.entityId === "evt_brotli_synthetic"));
});


test.each([false, true])("replica source observation preserves results (populated: %s)", async (populated) => {
  const vaultRoot = await createTempVaultRoot();
  if (populated) {
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.coreDocument, "---\ntitle: Core\n---\n# Core\n");
  }
  const expected = await readBrowserVaultReplicaSource(vaultRoot);
  const steps: (BrowserVaultReplicaSourceStep | null)[] = [];
  const observed = await readBrowserVaultReplicaSource(vaultRoot, {
    onSourceStep: (step) => { steps.push(step); },
    signal: new AbortController().signal,
  });
  assert.deepEqual(steps, [
    "canonical_source_read", null,
    "read_model_construction", null,
    "personal_pattern_vocabulary_read", null,
    "metric_projection", null,
    "default_entity_projection", null,
  ]);
  assert.deepEqual(observed, expected);
  assert.deepEqual(observed.vault, await readBrowserVaultReplicaVault(vaultRoot));
  assert.equal(observed.personalPatternVocabulary, null);
  assert.deepEqual(await readBrowserVaultReplicaSource(vaultRoot, {
    onSourceStep() { throw new Error("Synthetic observer failure."); },
  }), expected);
});

test("replica source observation does not start work after an existing abort", async () => {
  const vaultRoot = await createTempVaultRoot();
  const controller = new AbortController();
  const reason = new DOMException("Synthetic cancellation.", "AbortError");
  controller.abort(reason);
  const steps: (BrowserVaultReplicaSourceStep | null)[] = [];
  await assert.rejects(readBrowserVaultReplicaSource(vaultRoot, {
    onSourceStep: (step) => { steps.push(step); },
    signal: controller.signal,
  }), (error: unknown) => error === reason);
  assert.deepEqual(steps, []);
});

test.each([
  "canonical_source_read",
  "personal_pattern_vocabulary_read",
  "metric_projection",
] as const)("replica source retains cancellation after %s", async (cancelAfter) => {
  const vaultRoot = await createTempVaultRoot();
  const controller = new AbortController();
  const reason = new DOMException("Synthetic cancellation.", "AbortError");
  let activeStep: BrowserVaultReplicaSourceStep | null = null;
  const started: BrowserVaultReplicaSourceStep[] = [];
  await assert.rejects(readBrowserVaultReplicaSource(vaultRoot, {
    onSourceStep(step) {
      if (step === null && activeStep === cancelAfter) {
        controller.abort(reason);
      }
      if (step !== null) {
        started.push(step);
      }
      activeStep = step;
    },
    signal: controller.signal,
  }), (error: unknown) => error === reason);
  assert.equal(started.at(-1), cancelAfter);
});
