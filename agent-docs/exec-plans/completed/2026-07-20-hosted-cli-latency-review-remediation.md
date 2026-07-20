# Hosted CLI Latency Review Remediation

## Goal

Resolve the two accepted PR 802 ReviewGPT round-one findings without adding a
new state owner or weakening canonical query-projection freshness.

## Findings

1. A targeted blood-test list selects the correct panel but generic list
   compaction exposes only `resultsCount`, so the one-read named-biomarker flow
   lacks the matched value and unit.
2. The hosted tar writer can round canonical file mtimes to whole seconds while
   the query projection stores exact `mtimeMs`, causing a fresh carried
   projection to rebuild immediately after restore.

## Work

1. Add a bounded blood-test-specific matched-result summary at the existing
   list presentation boundary and pass the active text filter into it. Preserve
   generic list compaction and unfiltered blood-test list behavior.
2. Preserve subsecond timestamps in new hosted workspace archives while
   retaining restore compatibility with existing archives.
3. Add production-path CLI and real projection archive/restore regressions,
   update the PR intent contract and durable snapshot documentation, then run
   focused owner verification and ReviewGPT correction round two.

## Constraints

- Keep the hosted runner at one vCPU.
- Keep canonical vault files authoritative and strict source-manifest equality.
- Do not expose the full panel through list or include unrelated result rows.
- Do not change the snapshot manifest policy version or old-archive restore.
- Do not add a cache, service, command, queue, or state owner.

## Verification

- Reproduced the missing matched biomarker at the CLI boundary and proved the
  GNU tar whole-second timestamp mismatch against the exact query manifest.
- Focused tests passed: CLI `24/24`, Cloudflare snapshot `18/18`, and
  vault-usecases `204/204`; affected CLI, vault-usecases, and Cloudflare
  typechecks passed.
- Full owner suites passed: CLI `1,075 passed / 1 skipped`; Cloudflare
  `1,844/1,844` plus the Workers test, typecheck, and build.
- Workspace package dependency-cycle verification, `git diff --check`, and the
  privacy scan passed.
- A fresh coverage-write audit found no remaining proof gap and made no edits.
- Remaining: update the PR body, finish and push the scoped remediation commit,
  then run ReviewGPT correction round two concurrently with CI.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
