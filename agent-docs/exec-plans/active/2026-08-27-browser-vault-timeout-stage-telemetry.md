# Identify Browser Vault refresh timeout stage

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make the existing hosted Browser Vault refresh timeout log identify the exact
  bounded refresh stage that exhausted its 20-second budget, without exposing
  vault paths, content, identifiers, or health values and without changing
  refresh behavior.

## Success criteria

- A `deferred_timeout` result carries one closed, low-cardinality stage value
  covering the existing source-hash, replica-build, serialization, write, and
  publication boundaries.
- The existing hosted structured log emits that stage and preserves any source
  count/byte summary already known before the timeout.
- Focused tests prove stage attribution at local-build and injected-port
  boundaries while preserving cancellation, no-publication, terminalization,
  and foreground-preemption behavior.
- The durable hosted-runtime contract records the field, privacy boundary, and
  exact bounded later-production query.
- ReviewGPT authors the production patch and performs the required final review;
  focused local verification and required PR checks pass on the pushed head.

## Scope

- In scope: Browser Vault refresh result metadata, existing structured log
  details, focused tests, and the owning hosted-runtime contract.
- Out of scope: retries, timeout changes, scheduling/wake behavior, replica
  format or content, database/schema changes, device sync, new observability
  infrastructure, synthetic production traffic, merge, or deployment.

## Constraints

- Technical constraints: reuse the existing hosted runtime log pipeline; add
  only typed, closed-vocabulary metadata; keep runtime overhead effectively
  constant and do not add I/O or persistence.
- Product/process constraints: internal telemetry only, so Product UX impact is
  none; ReviewGPT exclusively authors production code; apply an accepted patch
  exactly and leave the resulting PR ready for human merge.

## Risks and mitigations

1. Risk: stage tracking accidentally changes cancellation or retry behavior.
   Mitigation: observe the existing sequence only and assert the current
   no-publication/no-wake terminal behavior in focused tests.
2. Risk: log metadata leaks private vault structure or creates cardinality/cost.
   Mitigation: expose only one closed stage enum plus existing numeric
   count/byte summaries; never log paths, source hashes, content, or IDs.
3. Risk: concurrent hosted-runtime work owns the same fix.
   Mitigation: deduplicate against active plans, PRs, issues, recent merges, and
   overlapping files before implementation; keep the patch boundary distinct.

## Tasks

1. Reconfirm current ownership, code path, production symptom, and telemetry
   question on current `origin/main`.
2. Send ReviewGPT a privacy-safe implementation packet with exact hypotheses,
   field constraints, tests, deployment contract, and later query.
3. Inspect the returned patch for behavior, privacy, scope, cost, conflicts, and
   device-sync overlap; apply it unchanged only if accepted.
4. Run focused tests, typechecks, privacy/log guards, and direct diff proof.
5. Commit, push, open the PR, run preliminary/final ReviewGPT concurrently with
   CI, disposition findings, and leave the PR ready for human merge.

## Decisions

- The concrete unanswered question is: which existing refresh stage is active
  when a `deferred_timeout` result is produced?
- Competing hypotheses are initial source hashing, replica construction,
  serialization/measurement, second source hashing, encrypted replica write,
  or ref publication.
- The existing `deferred_timeout` result is already terminal for the current
  mailbox item. This task does not reinterpret it as retryable.
- PR #2461 instruments foreground-input admission and PR #2448 changes generic
  Environment scheduling; neither owns Browser Vault timeout-stage telemetry.
- ReviewGPT implementation v1 was rejected before application because an
  unused import and an already-started promise left typecheck and exact-stage
  attribution gaps. V2 corrected both, but its attachment failed the guarded
  checksum. The same accepted turn regenerated hash-matching v3; exact local
  typecheck then exposed lost workspace narrowing in the new write thunk.
  ReviewGPT's complete v4 replacement captures the already-proven ref and
  publish method before the thunks, removes the assertion, and is the only
  accepted production implementation.

## Verification

- Commands to run: focused Browser Vault replica and workspace-entrypoint
  Vitest cases, `@murphai/assistant-runtime` typecheck, repository log/privacy
  guard, `git diff --check`, exact-head CI, preliminary coverage review, and
  final ReviewGPT.
- Expected outcomes: each forced timeout reports the correct closed stage,
  logs contain no private data, existing cancellation and terminal behavior are
  unchanged, and the exact later query can aggregate timeout counts by stage.

## Candidate evidence

- Accepted ReviewGPT artifact:
  `browser-vault-timeout-stage-telemetry-v4.patch`, exact SHA-256
  `692972685f2fe00e2b9ad5bb3d86a0aaf18d02cc15a18602b3bd98fbec4e7ff0`.
- Passed: 76 focused Vitest cases across the Browser Vault replica owner and
  assembled workspace scheduling/preemption paths.
- Passed: `@murphai/assistant-runtime` TypeScript typecheck.
- Passed: repository raw-log privacy guard and `git diff --check`.
- Product UX result: not applicable; this patch changes only failure metadata
  and leaves timing, control flow, replies, recovery, and user-visible state
  unchanged.
