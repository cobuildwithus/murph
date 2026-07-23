# Crabbox Secret Boundary Review Remediation

## Goal

Resolve the final ReviewGPT findings for PR 865 without adding a new state
owner: remove unprovable warm-lease reuse, make the sync guard inspect the
same Git state Crabbox will upload, and collapse the trusted Testbox boundary
to the root-owned shell wrapper.

## Findings

1. The documented warmup command did not pin organization, ref, workflow, and
   hydration job before the trusted entrypoint was installed.
2. Git safety checks inherited `GIT_*` variables that the Crabbox child did not,
   allowing the guard and upload path to observe different indexes.
3. The root shell wrapper can validate the bounded command and directly `exec`
   the candidate verifier after `env -i`; the intermediate trusted JavaScript
   supervisor duplicates parsing, environment, and lifecycle ownership.

## Plan

1. Remove warmup and arbitrary lease reuse because provider metadata cannot
   establish the Blacksmith organization; create only fresh fully pinned runs.
2. Build the scrubbed child environment before sync validation and use it for
   every Git subprocess in that guard.
3. Move bounded-command and regular-file validation into the root-owned shell,
   directly `exec` the candidate verifier, and delete the redundant trusted
   JavaScript module and declaration.
4. Add production-faithful regression proof for alternate-index mismatch,
   unauthorized worktree state, wrapper environment scrubbing, command
   rejection, and signal/exit propagation.
5. Run focused verification, update the PR intent/evidence, close this plan,
   push, and run final ReviewGPT correction round 2 concurrently with CI.

## Verification

- Focused Crabbox security suite passed: 3 files, 26 tests. It includes a real
  Git repository with a parent-selected alternate index, default-index sensitive
  and unauthorized state, real shell environment capture, command rejection
  before candidate Node, and SIGINT status propagation.
- `pnpm exec tsc --noEmit -p tsconfig.tools.json` passed.
- ReviewGPT packaging-owner suite passed: 40 tests, 1 skipped.
- Shell syntax, workflow YAML parsing, and `git diff --check` passed.
- Canonical local `pnpm test:diff ...` waited ten minutes without acquiring the
  shared slot and was stopped without signaling its unrelated owner. Remote
  proof remains post-landing because `main` does not yet contain this corrected
  root-owned entrypoint.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
