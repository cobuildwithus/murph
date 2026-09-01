# Carry hosted snapshot refs into v2 materialization

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Remove the redundant hosted workspace read performed only to rediscover the current snapshot reference during v2 snapshot construction.

## Success criteria

- Snapshot preparation uses the current ref already owned by the invocation/checkpoint session and performs no workspace read.
- Only an accepted checkpoint advances that carried ref; failed or rejected checkpoints retain the prior ref.
- Legacy base, delta, hot, skipped-inline, and null-ref materialization behavior remains unchanged.
- Workspace compare-and-swap authority and Cloudflare's orphan-cleanup pre-read remain unchanged.
- Focused regression tests prove the carry-forward, advancement, null, and cleanup-order behavior.

## Scope

- In scope: the assistant-runtime checkpoint metadata/session, v2 snapshot bridge, legacy materialization input, and focused assistant-runtime/Cloudflare tests.
- Out of scope: workspace checkpoint protocol, R2 object ownership, Web compare-and-swap policy, or snapshot format.

## Root-cause evidence

- Invocation start already owns the canonical workspace state, and successful checkpoints already update the existing metadata session.
- Legacy v2 preparation independently rereads the workspace only for `snapshotRef`, duplicating a network request without adding authority.

## Plan

1. Seed the existing checkpoint metadata session from the invocation's active workspace ref.
2. Carry that ref explicitly into v2 legacy materialization and advance it only on accepted checkpoints.
3. Remove the redundant legacy-preparation workspace read helper.
4. Add focused assistant-runtime and Cloudflare ordering regressions.
5. Run focused proof, complexity and diff review, exact-head CI, final ReviewGPT, and merge.

## Deployment concerns

- The change is internal to the Cloudflare runner bundle and does not change the Web checkpoint schema.
- Mixed Web/runner versions remain compatible because the existing checkpoint and snapshot refs are unchanged.
- Rollback restores the extra read without data or protocol migration.

## Verification

- Passed: three focused assistant-runtime suites (86 tests) covering snapshot carry-forward, legacy materialization, and restored invocation seeding.
- Passed: focused Cloudflare runner cleanup suite (19 tests), including the required pre-delete workspace read ordering.
- Passed: assistant-runtime package typecheck.
- Passed: cyclomatic-complexity diff after moving conditional resolution outside the existing runtime hotspots; no changed-file debt or maximum increased.
- Passed: `git diff --check` and parent inspection of the source, test, and plan diff.
- Passed: PR evidence validation on the candidate head.
- Passed: final ReviewGPT full-patch audit on the candidate head with no qualifying findings.
- Required GitHub Actions remain the merge gate on the final documentation-only completion head.
Completed: 2026-09-01
