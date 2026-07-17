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

- Reuse the existing outbox intent as the sole delivery owner. It retains the completion expiry beside the existing completion id and deterministic delivery key; fallback changes only its message, leaving that immutable proof and delivery identity unchanged.
- Add an explicit `HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX` bound of 25 alongside the existing live-projection maximum, and apply it to per-group permissions plus per-group/per-member grant generations; no cleanup process is introduced.
- Keep the producer gate as a consumer-first deployment control. The numeric caps remove the separate cardinality blocker.
- Read and decrypt the display-name response summary before provider mutation, then perform the existing provider-first name update and database write without a second disclosure decrypt.

### Round 4 retrospective: queued-completion lifetime

- The mandatory fixed completion remains deliverable after the reviewed answer is queued even when its ten-minute disclosure authority expires and retention physically deletes the request and completion mailbox rows. The accepted outbox obligation ends only in its existing sent or terminal-failure disposition.
- The existing outbox is the sole durable owner of the minimum immutable proof for that obligation. At reviewed-completion intent creation it atomically stores the completion expiry beside the already-persisted completion item id and deterministic delivery key, and retains that proof for the outbox intent's lifetime. Mailbox cleanup does not need ordering, a new worker, or reconciliation state because the outbox can select the fixed copy from its own deadline after physical deletion.
- Before that deadline, Web remains the live owner of grant/revocation authority and can require the fallback. At or after the deadline, runtime preflight selects and persists the fixed copy without consulting deleted mailbox state. Provider-entry performs the same local deadline check to close the preflight-to-provider race, then retains the Web recheck only for an early revocation race.
- Delete the separate message-supersession audit object: the immutable reviewed-completion proof, fixed message value, and ordinary outbox timestamps are sufficient. Keep both preflight and provider-entry checks because they guard different race boundaries; keep the Web fallback-required bit only for revocation before expiry.
- Once the outbox already contains the exact fixed copy, Web validates the deterministic completion id/key shape but does not require retained mailbox ciphertext. This exception cannot authorize reviewed private bytes: runtime derives the bit only from equality with the shared fixed constant, while the ordinary bound-route engagement and provider-dispatch claim still apply.
- Regression proof must cover one queued private answer, a transient pre-byte provider failure, expiry, the production retention deletion boundary, and a later retry that emits the fixed copy exactly once while the private answer appears in zero provider sends.

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
- Current `main` reconciliation — additive conflicts in the docs index plus contact-privacy, account-deletion, and migration-inventory tests retained both disclosure and usage-credit behavior. Conflict-specific Web tests passed 64 tests, Web typecheck passed with the merged Prisma schema, and doc gardening passed.
- Post-merge remediation rerun — focused Web 152 tests, assistant-runtime 194 tests, hosted-execution 362 tests, operator-config 195 tests, and the focused Cloudflare assertion all passed.
- ReviewGPT round 4 — valid correction-verification round at `cdeffa27f1498f9375df49c6cffc79738b6ef4e0`; required a retrospective for the review-induced lifetime mismatch between the ten-minute mailbox rows and the longer existing outbox obligation. It otherwise verified the history-cap and affected-surface corrections and found no additional qualifying issue.
- Round 4 lifetime correction — the existing outbox now atomically retains the reviewed completion expiry beside its completion id and deterministic delivery key, selects the fixed copy locally at expiry, preserves the Web recheck for early revocation, and lets the exact fixed fallback survive physical mailbox deletion. The redundant message-supersession object was deleted.
- Focused round 4 checks — assistant-runtime callback/completion suites passed 195 tests before the coverage pass; assistant-engine notification/outbox suites passed 88 tests; focused Web disclosure/egress tests passed 61 tests; changed Web ESLint, Web typecheck, assistant-runtime/assistant-engine/operator-config/Cloudflare typechecks, operator-config 195-test suite, docs gardening, and `git diff --check` passed.
- Real PostgreSQL retention proof — after applying current migrations to the isolated worktree database, `MURPH_TEST_POSTGRES_CONCURRENCY=1` ran the new retention boundary test: production cleanup SQL deleted the expired request and completion rows, the queued answer received fallback-required, and the already-fixed copy remained authorized. One test passed.
- Required round 4 `coverage-write` audit — added only the provider-entry expiry-crossing regression. The callback file passed 187 tests and proves preflight-valid private bytes are durably replaced before provider entry with no Linq call. No other material missing branch or race coverage was found; the real-PostgreSQL lane remains opt-in in ordinary local runs and is now part of hosted E2E CI.
