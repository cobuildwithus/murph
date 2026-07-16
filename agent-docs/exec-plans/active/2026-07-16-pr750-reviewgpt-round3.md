# Remediate PR #750 ReviewGPT round 3

Status: active
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Preserve the mandatory non-disclosing completion when reviewed disclosure authority disappears after queueing, bound permission and regrant history synchronously, and remove the disclosure-summary decryption failure from the post-provider rename boundary.

## Success criteria

- A queued reviewed exact answer whose authority is revoked or expires is durably replaced in the existing outbox intent with the fixed cannot-answer copy before provider entry; the private answer never reaches Linq, retry/restart stays idempotent, and a completion that already contains the fixed copy remains deliverable.
- Permission and grant-generation history has a numeric group/member lifetime cap under the existing group/member locks; exact request and reaction replays still succeed at the cap while fresh rows return the existing typed limit disposition.
- `post_disclosure_request` checks capacity before provider send, rechecks at binding, and can run behind the existing exact-`1` rollout gate without an unbounded-history blocker.
- Group display-name mutation opens the complete disclosure summary before the provider rename, so an unavailable secure-box key cannot create a rename caused specifically by post-provider disclosure decryption.
- Focused coverage, required audits, routed verification, scoped commit, push, PR-body affected-surface disclosure, CI, and a new ReviewGPT correction round complete.

## Scope

- In scope: reviewed-completion egress/outbox fallback disposition; Assistant Ask fixed-copy contract ownership; disclosure permission/grant history admission; display-name summary ordering; focused tests and rollout/affected-surface docs.
- Out of scope: a new queue, retention worker, lifecycle manager, policy engine, compatibility shim, or unrelated Assistant Ask/group mutation redesign.

## Risks and mitigations

1. Risk: A revocation race occurs after an early authority check.
   Mitigation: recheck at provider entry; if authority changed, persist the fixed fallback on the same outbox intent and retry before any provider bytes are sent.
2. Risk: History caps reject deterministic retries.
   Mitigation: resolve exact permission/request and reaction/grant identity before counting fresh rows under the existing row locks.
3. Risk: A capacity race sends an inert provider message.
   Mitigation: preflight under the group lock and recheck during binding; preserve the existing documented send-before-bind orphan behavior rather than add reservation state.
4. Risk: Pre-provider summary reads return a stale snapshot after a concurrent grant mutation.
   Mitigation: return the successfully opened operation-start snapshot and keep grant lifecycle ownership in the existing store; do not hold a database transaction across Linq.

## Tasks

1. Add the reviewed-completion safe-fallback disposition to the existing Web egress contract and Cloudflare/runtime parser.
2. Persist fallback supersession on the same outbox intent before dispatch, including a provider-entry race retry, and add restart/idempotency coverage.
3. Add permission and total grant-generation history admission under canonical locks, preserving exact replay behavior.
4. Preflight disclosure-summary decryption before provider display-name mutation and cover the failure ordering.
5. Update rollout and affected-surface documentation, run focused and routed verification, complete the coverage audit, commit, reconcile current `main`, push, and start the ReviewGPT correction round concurrently with CI.

## Decisions

- Reuse the existing outbox intent as the sole delivery owner. Supersession changes only its message plus durable reason metadata; the delivery idempotency key and deterministic completion identity remain unchanged.
- Add an explicit `HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX` bound of 25 alongside the existing live-projection maximum, and apply it to per-group permissions plus per-group/per-member grant generations; no cleanup process is introduced.
- Keep the producer gate as a consumer-first deployment control. The numeric caps remove the separate cardinality blocker.
- Read and decrypt the display-name response summary before provider mutation, then perform the existing provider-first name update and database write without a second disclosure decrypt.

## Verification

- `git diff --check` — passed.
- Focused Web disclosure/egress tests — 4 files, 150 tests passed.
- Focused Cloudflare runner-platform assertion — 1 test passed.
- `pnpm --filter @murphai/hosted-execution test` — package suite passed 361 tests after the numeric-cap assertion was added.
- `pnpm --filter @murphai/operator-config test -- assistant-cli-contracts.test.ts` — package suite passed 195 tests.
- Assistant-runtime focused callback tests — 2 files, 194 tests passed.
- `pnpm verify:acceptance` — all repo guards and typechecks passed; Web lint, smoke, production build, and 5,442 tests passed; assistant-runtime coverage passed 1,727 tests at 88.38% statement coverage. The command exited nonzero only after an unrelated assistant-engine worker exceeded the default heap and an unrelated CLI canonical-write-lock test timed out during the parallel package-coverage fanout.
- `MURPH_VITEST_MAX_WORKERS=2 NODE_OPTIONS=--max-old-space-size=8192 pnpm --dir packages/assistant-engine test:coverage` — resource-adjusted rerun passed 2,335 tests.
- Isolated CLI canonical-write-lock file with one worker — 6 tests passed.
- Required `coverage-write` audit — added focused lock-before-count and summary-decrypt fail-closed proof in the existing Web tests; 4 files / 152 tests passed, Web prepared typecheck passed, and `git diff --check` passed. Residual concurrency proof is mock call ordering rather than a real PostgreSQL fixture.
- Parent post-audit rerun — focused Web 152 tests, assistant-runtime 194 tests, hosted-execution 361 tests, operator-config 195 tests, focused Cloudflare assertion, and changed-Web-file ESLint all passed.
