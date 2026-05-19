# Hosted Artifact Snapshot Diagnostics

## Goal

Expose enough safe diagnostics to explain hosted full-checkpoint bundle archive
validation failures, then prove and fix the artifact duplication/carry-forward
bug causing large preserved artifact sets and failed snapshots.

## Scope

- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- Focused runtime-state bundle/snapshot tests if the bug lands there
- Runtime inspection notes for Cloudflare container/log access

## Constraints

- Metadata-only diagnostics. Do not log raw file contents, local paths,
  artifact hashes, user/member ids, prompts, mailbox payloads, stdout/stderr
  text, secrets, provider payloads, or authorization values.
- Use fixed-vocabulary or already-sanitized safe error fields where possible.
- Preserve unrelated dirty worktree edits and coordinate with active hosted
  runner diagnostics work.
- Prefer a focused integration/e2e-style regression that proves the duplicate
  artifact path or invalid preserved reference behavior.

## Current Evidence

- Hosted checkpoint failure rows show `bundle_archive_validation_error` during
  full compaction before bundle or external artifact writes start.
- The failing full snapshot had thousands of external workspace artifacts and a
  much larger preserved artifact count.
- Current logs retain only presence booleans for the detailed validation clause,
  so production cannot distinguish invalid artifact metadata, duplicate file
  entries, kind mismatch, or artifact integrity failures.
- Snapshot counts suggest at least one external artifact is carried forward from
  the base manifest rather than put by the current attempt.

## Plan

1. Add safe checkpoint failure diagnostics that persist the specific bundle
   validation detail and code detail without raw cause text.
2. Add focused tests proving `snapshot_failed` logs include the useful safe
   validation clause and still omit sensitive/free-form payloads.
3. Use parallel investigation findings to isolate the artifact duplication or
   stale preserved-reference path.
4. Add the smallest proving integration/e2e-style regression for the identified
   bug.
5. Run focused verification, typecheck, required audits, and a scoped commit.

## Verification

- Pending.

## State

- Investigation started with five read-only agents covering diagnostics,
  preserved artifact references, artifact explosion, e2e harness selection, and
  Cloudflare container access.
