# Classify hosted startup confirmation failures

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Add the smallest behavior-preserving, privacy-safe typed telemetry needed to classify hosted startup-confirmation failures that currently collapse to a generic runtime error and recover only after a later orchestration attempt.

## Success criteria

- The existing startup-confirmation failure owner emits a bounded failure-stage enum and numeric elapsed timing sufficient to distinguish container/RPC, lifecycle/state, health/readiness, and deadline hypotheses.
- No member, workspace, message, command, provider, path, prompt, transcript, health, credential, raw error, or unbounded value is recorded.
- Telemetry adds no awaited I/O, state, retry, control-flow, provider, or user-visible behavior change.
- Focused tests and Cloudflare typecheck pass; the exact pushed PR head passes required CI and final ReviewGPT review.
- The later production query is documented and groups only the new bounded fields against the existing retry outcome.

## Scope

- In scope: the `RunnerContainer.ensureReadyForProcessing` / UserRunner startup-confirmation failure boundary, its existing structured log pipeline, focused tests, and durable observability/deployment documentation.
- Out of scope: fixing an unproven startup cause, changing retries/timeouts/readiness behavior, adding storage or a telemetry backend, device-sync work, R2 snapshot behavior, and unrelated runtime optimization.

## Constraints

- Technical constraints: typed low-cardinality fields only; bounded volume; no additional network/database/provider work; no new persisted state; old Worker/container skew remains safe.
- Product/process constraints: ReviewGPT exclusively authors the repository patch; the local agent may apply only a reviewed patch, validates it independently, and leaves any ordinary bug fix for human merge. Autonomous merge/deploy is allowed only if the final diff remains telemetry/tests/docs-only and every repository gate passes.

## Risks and mitigations

1. Risk: telemetry accidentally exposes private or high-cardinality runtime data.
   Mitigation: use a closed enum and numeric duration only; prohibit identifiers, paths, raw errors, and input-derived values; inspect the full emitted object and test assertions.
2. Risk: instrumentation changes startup behavior or adds hot-path latency.
   Mitigation: reuse the existing failure log call without new awaited work or control-flow branches; test behavior parity.
3. Risk: an active task owns the same question.
   Mitigation: compare the exact active task and PR diffs; proceed only after proving their root causes and intended changes are different.

## Tasks

1. Preserve the bounded production evidence and exact-overlap comparison.
2. Ask ReviewGPT for the smallest complete telemetry/tests/docs patch.
3. Inspect and, if accepted, apply the ReviewGPT patch exactly.
4. Run focused tests, Cloudflare typecheck, privacy/static checks, and parent review.
5. Commit, push, open the telemetry PR, and run preliminary/final ReviewGPT plus required CI.
6. If every telemetry-only deployment gate passes, merge/deploy through the canonical protected workflow and record the natural-traffic verification query; otherwise leave the exact human action.

## Decisions

- Selected the startup-confirmation retry storm over historical recovered signals because it is current, broad, repository-owned, and presently unclassifiable at the narrow failure boundary.
- Existing readiness telemetry measures successful cold-start phases and returned no direct causal samples; it does not identify the failed startup-confirmation stage.
- Active optimizer work targets `vault-cli memory show`; open snapshot, automation, and browser-vault PRs address different root causes and can coexist.
- Accepted ReviewGPT's six-value closed taxonomy: four RunnerContainer-local stages plus caller deadline and an explicit unattributed RPC category. The local observation is failure-only, contains three bounded fields, and does not transport custom error properties across Durable Object RPC.
- Returned the initial 9,000 ms synthetic assertion to ReviewGPT after focused verification proved the fixture starts confirmation 50 ms after the absolute command clock. Applied ReviewGPT's revised 8,950 ms expectation; no production code changed in that revision.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-alarm.test.ts` (2 files, 379 tests).
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `git diff --check` and added-line searches for local paths, credentials, authorization headers, database URLs, and private keys.
- Pending external gates: exact-head GitHub checks, the preliminary coverage specialist pass, and the final sensitive ReviewGPT gate.
Completed: 2026-08-29
