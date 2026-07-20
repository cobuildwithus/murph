# Enable Scheduled Consented-Answer Actions

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Let a scheduled group automation continue from reviewed private answers through the existing normal group notification/action path instead of an isolated exact-skip turn.
- Preserve the private-vault boundary: the downstream group turn receives only the reviewed result and never receives personal workspace access.

## Success criteria

- Scheduled consented-answer completions recover and revalidate the canonical automation's current group route, then reuse the ordinary scheduled notification turn and its existing delivery/tool controls.
- The blanket internal-turn bans on messaging, connected apps, calls, and follow-up actions are removed; each existing capability still enforces its own authority contract.
- `cannot_answer` completions are normalized to `answer: null` before durable completion so unreviewed candidate text cannot reach the group runtime.
- No new queue, scheduler, route store, side-effect service, or persisted lifecycle is introduced.
- Focused tests, diff coverage, exact-head CI, and ReviewGPT pass.

## Scope

- Scheduled `consented_member` completion handling, normal notification routing/tool composition, the result normalization boundary, focused tests, and matching durable docs/prompts.
- Current-main reconciliation needed to make PR #750 mergeable while preserving unrelated main behavior.

## Decisions

- Reuse the canonical automation record and ordinary scheduled notification path as the sole route and side-effect authority.
- Keep the personal candidate and outgoing reviewer one-shot, read-only, and unable to access delivery or the group turn's tools.
- Treat reviewed answer bytes as untrusted data in the downstream prompt; disclosure consent authorizes the answer's information, not instructions embedded in it.
- Reuse the existing reviewed-completion delivery key and outbox expiry proof; derive exact accepted-input delivery versus scheduled continuation from the trusted completion origin instead of adding another key namespace.
- Do not broaden any individual side-effect tool beyond its existing authority contract unless direct proof shows the normal scheduled group path still cannot satisfy the requested behavior.

## Tasks

1. Reconcile current `origin/main` and preserve current-main Assistant Ask reader behavior only on the legacy joined-group path.
2. Replace the scheduled internal exact-skip completion with the existing canonical scheduled group notification/action composition.
3. Normalize cannot-answer results before completion and add focused privacy regression proof.
4. Update product, security, protocol, prompt/tool-description, and deployment docs to match the new behavior.
5. Run focused verification, coverage-write, parent final review, exact-head CI, and ReviewGPT through a pass.

## Verification

- Focused typechecks passed for Assistant Engine, Assistant Runtime, Hosted Execution, and hosted Web.
- Focused behavior suites passed: Assistant Engine 166 tests, Assistant Runtime 34 tests, Hosted Execution 12 tests, and hosted Web 25 tests.
- The first diff-aware lane cleared all guards/typechecks and Assistant Engine's 2,550-test suite, then found an overbroad cannot-answer normalization and a stale verified-sender assertion. Both were corrected at the narrow owner and the directly affected 34 Assistant Runtime tests passed.
- Parent simplification removed a proposed continuation delivery-key namespace, made Assistant Engine derive the existing reviewed-completion key from the completion id, and deleted merge-residue mailbox signaling code. No new state owner or compatibility mechanism remains.
- Coverage-write found no missing proof and made no edits. Existing tests cover canonical automation and route revalidation, scheduled group capability scoping, completion expiry/outbox reuse, live-grant dispatch revalidation, candidate/reviewer isolation, and legacy behavior.
- The final bounded `pnpm test:diff` passed every architecture/privacy/dependency guard, all affected typechecks, all package-boundary checks, Web lint/dev smoke/production build, and the affected suites: Assistant CLI 128, Assistant Engine 2,545 with 5 skipped, Assistant Runtime 1,754 with 2 skipped, assistantd 40, CLI 1,075 with 1 skipped, Hosted Execution 378, hosted-local 393 with 1 skipped, Temporal 77, setup 124, Web 5,952 with 149 skipped, and Cloudflare 1,842 plus 1 Workers-runtime test.
- One earlier diff run exposed eight CLI harness timeouts under shared-host contention; the full 38-test file passed in isolation and both later bounded full runs passed the complete CLI suite. Another supporting run exposed one current-main merge fixture that omitted the new empty disclosure-grant field; adding that exact test field made its 81-test owner file and the final full lane pass.
- `pnpm docs:drift`, `git diff --check`, the privacy identifier scan, and the secret-pattern scan passed. Exact-head CI and ReviewGPT remain for the pushed PR head.
Completed: 2026-07-20
