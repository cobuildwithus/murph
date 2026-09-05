# Missing knowledge page recovery and bounded diagnostics

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Stop repeated missing-page lookup attempts with explicit terminal recovery guidance; distinguish knowledge operation/failure classes using private-free numeric diagnostics.

## Success criteria

- Preserve missing-page failure semantics and require existing write authority before creating a page.
- Prove one missing-slug lookup, no writes, and a truthful reply in a focused real assistant journey.
- Reconcile optional counters with existing totals, accept legacy profiles, and exclude private strings.
- Obtain parent candidate review, applicable ReviewGPT and required CI for the exact PR head.

## Scope

- In scope: knowledge service errors, existing Codex tool profile aggregation, hosted usage codec, focused tests and release note.
- Out of scope: broad retry policy, prompt/skill restructuring, billing, new stores, deployment, and claims about all historical failures.

## Constraints

- Technical constraints: reuse existing family classification and v2 metadata; bound JSON inspection and persist only finite numeric counters.
- Product/process constraints: synthetic fixtures only, no member transcripts, no autonomous replacement writes, isolated worktree, no merge or deploy.

## Risks and mitigations

1. Optional diagnostic fields cross mixed runtime/control versions.
   Mitigation: old readers discard optional metadata; new readers accept legacy profiles; verify producer/codec round-trips.
2. A missing read can occur during an already-authorized write.
   Mitigation: hint distinguishes discovery, authorized creation, and proceeding without a page; preserve every error and retry protection.

## Tasks

1. Completed: trace service, CLI projection, command attribution and codec owners.
2. Completed: implement narrow recovery and numeric counters; deterministic tests and real journey pass.
3. Completed: release-note archive proof, Web typecheck and parent candidate review of PR #2849.
4. Completed: Ready admission and valid final ReviewGPT round 1 with no findings; close the implementation plan. Required CI remains a separate final-head completion gate; no merge or deployment is authorized.

## Decisions

- The existing missing-page error was already non-retryable; the change adds actionable recovery, not a retryability fix.
- Retain existing finite family classification. Compound commands and knowledge batch children remain outside direct knowledge counters.
- The live journey also exposed unrelated index-discovery attempts. They are outside this patch; the requested missing slug was read once and never recreated.
- Record this durable plan during candidate completion; earlier investigation and implementation were coordinated through the parent task.

## Verification

- Passed: assistant knowledge-service tests, all 85 runtime-helper tests, all 26 hosted usage tests, focused production CLI error-bridge test, assistant/hosted-execution/CLI typechecks, complexity guard and diff privacy check.
- Passed: `pnpm test:assistant:live -- --test 'finishes a stale wiki lookup without retrying'` with GPT-5.6 Terra and local subscription; one requested missing-page read, zero knowledge writes, no invented page contents, truthful concise reply.
- Passed: 9 changelog archive tests, Web typecheck and parent candidate review at `082c465ebbd4a6362eb2da7ac81164f5c4027fa8`.
- Passed: focused mixed direct/batch attribution regressions in both orders (2 tests), including hosted normalization. Batch knowledge children remain in the existing `other` family and cannot produce a partially counted knowledge aggregate.
- Passed: final ReviewGPT round 1 on that same head, GPT-6 Pro, with exact-turn/model/hash evidence and 562-second elapsed review; zero findings. A too-fast diagnostic capture and one pre-send staging failure did not count as substantive rounds.
- Passed: clean current-base merge-tree proof before plan closure.
- Pending at plan closure: required CI on the final plan-closing head. This documentation-only closure preserves the reviewed production tree and does not require another substantive review. The completion owner retains responsibility for final checks and PR evidence.
- Verification recovery: an optional test invocation forwarded an extra argument separator and ran unrelated tests; only its proven task-owned worker/coordinator were stopped. The corrected focused command above passed; no product failure was inferred.
Completed: 2026-09-04
