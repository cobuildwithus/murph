# Repair live assistant fixtures

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Repair only false-negative fixtures, mocks, harness setup, and stale assertions
  exposed by the complete real-Codex assistant scenario run. Preserve genuine
  product failures as failing evidence instead of changing production behavior.

## Success criteria

- Each accepted change is test-only or test-harness-only and has a proven
  fixture/assertion root cause.
- Deterministic tests cover every fixture or harness correction.
- Focused paid live reruns pass for repaired journeys; the complete paid suite
  is not rerun.
- Genuine product failures remain out of scope and are reported separately.

## Scope

- In scope: `assistant-codex-real-e2e.test.ts`, its focused runner, synthetic
  CLI/provider fixtures, mock command semantics, and outcome-oriented assertions.
- Out of scope: production prompts, assistant behavior, privacy policy, dynamic
  tool-result handling, Codex protocol accounting, and any other product fix.

## Constraints

- Technical constraints: prefer fixture fidelity and deterministic boundary
  coverage; do not weaken assertions that protect a real invariant.
- Product/process constraints: six independent ReviewGPT investigations return
  reviewable patches; no reviewer may run the paid live suite.

## Risks and mitigations

1. Risk: A stale-looking expectation is exposing a real behavior regression.
   Mitigation: require code-path or deterministic fixture proof before accepting
   a patch; otherwise leave the live failure intact.
2. Risk: Parallel patches overlap in the monolithic live-test file.
   Mitigation: assign disjoint line/test domains and apply each patch manually.

## Tasks

1. Partition known false negatives into six non-overlapping fixture domains.
2. Run six ReviewGPT investigations concurrently and collect their diffs.
3. Inspect, reconcile, and apply only fixture-rooted corrections.
4. Run deterministic tests for all touched harnesses.
5. Run only the affected focused real-Codex journeys and review their replies.
6. Commit, open a draft PR, and complete exact-head review/CI gates.

## Decisions

- Limit the implementation to fixture and assertion repairs per the user's
  clarified scope; preserve actual product bugs for separate work.
- Treat live assertions as outcome checks, moving implementation-detail checks
  to deterministic tests where necessary.
- Accept three exact reviewer patches, reconstruct the health/experiment
  fixture changes from a fourth validated reviewer response, and make no change
  from two reviewer lanes that did not return a usable result.
- Keep the focused live failures that still show missing writes, duplicate
  actions, incomplete replies, or incorrect authority decisions as product-bug
  evidence rather than weakening their assertions.

## Verification

- `@murphai/assistant-engine` typecheck passed.
- Full deterministic assistant-engine suite passed: 262 files passed, 3
  skipped; 4,146 tests passed, 119 skipped.
- Focused fixture contracts passed: 18 passed, 91 skipped. Product-feedback
  tests passed 14/14, automation-fixture tests passed 3/3, and runner tests
  passed 9/9.
- Focused paid journeys passed for Health Commons lookup and managed group voice
  memo behavior. Other focused journeys reached their intended fixture boundary
  and exposed product behavior failures, which remain unchanged and out of
  scope.
Completed: 2026-08-27
