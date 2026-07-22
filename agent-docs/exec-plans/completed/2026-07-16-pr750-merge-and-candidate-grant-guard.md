# Resolve PR #750 conflicts and strengthen candidate grant boundary

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Restore PR #750 to a clean mergeable head, make the private read-only candidate explicitly refuse any answer whose disclosed information is not clearly inside the exact active grant, and close the confirmed privacy, authority, replay, compatibility, and accounting defects in their existing owners.

## Success criteria

- Current `origin/main` is reconciled with the PR branch through ordinary Git history and all manual conflicts are resolved without changing Call Circle #444.
- The candidate prompt includes the exact grant permission and exact question, requires every disclosed fact to fit the grant, and returns the existing `cannot_answer` result with `answer: null` for any out-of-scope or ambiguous part.
- Focused tests prove the candidate prompt, rather than only the outgoing reviewer prompt, carries and enforces that boundary.
- A pre-revocation reaction cannot resurrect consent after revocation, while a fresh post-revocation reaction can explicitly regrant it.
- Shared detached Assistant Ask normalization preserves the legacy joined-group `cannot_answer` explanation, while the consented executor continues to erase denied candidate/reviewer text.
- The existing disclosure producer flag blocks both member asks and outward consent-message production, without disabling grant listing/revocation or recovery of already-posted reactions.
- Free-form permission text is encrypted before first write with the existing group-owned private-field secure-box, its operational digest is a group-scoped keyed/versioned blind index, and plaintext is opened only after structural authority checks.
- Reviewed exact delivery tolerates ordinary group-speaker drift without weakening direct-message actor checks, and revalidates grant, membership, and expiry at the existing provider-egress authority boundary.
- Candidate and reviewer Codex usage is recorded best-effort through the existing hosted usage ledger with deterministic request, attempt, and phase identity, without changing disclosure outcomes.
- Exact parsed `like` with no custom emoji is the only disclosure-grant reaction, mutation responses report truthful current grants, and existing row-lock owners are reused.
- Routed verification, required completion audits, privacy review, commit/plan closure, push, and exact-head mergeability proof complete.

## Scope

- In scope: PR #750 branch reconciliation; the existing consented-member read-only candidate prompt and its focused tests; reaction-time replay fencing; shared detached-result compatibility; existing producer-gate coverage of outward consent messages; permission-text encryption; reviewed-exact routing and send-time authority; existing usage-ledger accounting; exact Like evidence; truthful mutation summaries; canonical row-lock reuse; conflict-only updates required by current `main`.
- Out of scope: Call Circle #444; another reviewer, policy engine, state owner, rewrite layer, queue, scheduler, retention worker, or new disclosure lifecycle owner; starting ReviewGPT from this worker; availability-only send-before-bind reconciliation; broad corruption-recovery machinery.

## Constraints

- Technical constraints: preserve membership and grant as separate authorities, exact-byte delivery, one outgoing allow/deny reviewer, and existing `cannot_answer` output; use the existing grant table, transaction locks, and Assistant Ask result owners.
- Product/process constraints: use the existing isolated worktree, preserve unrelated edits, follow the active-plan commit workflow, and leave the external ReviewGPT gate to the primary agent.

## Risks and mitigations

1. Risk: Manual conflict resolution changes already-reviewed behavior.
   Mitigation: compare each conflict against both parents, retain the smallest owner-correct combination, and run focused plus routed verification.
2. Risk: Prompt wording creates a second policy layer or redundant review behavior.
   Mitigation: add one candidate-side instruction that applies the exact grant and reuses the existing fail-closed result, with no lifecycle or reviewer changes.
3. Risk: Duplicate reaction handling can recreate a revoked authorization.
   Mitigation: under the existing transaction locks, compare trusted provider reaction time with the latest revocation and suppress any event that is not strictly newer.
4. Risk: Consented redaction accidentally changes the legacy private-to-group continuation contract.
   Mitigation: restore the shared normalizer and keep consented denial redaction in the consented executor where that policy belongs.
5. Risk: Gate-off deployment still emits consent requests that can later become grants.
   Mitigation: check the existing disclosure producer gate before authorization, provider send, or durable permission binding; keep consumer/recovery paths enabled.
6. Risk: Permission policy text or a delayed answer bypasses its trust boundary.
   Mitigation: reuse the synthetic group member's secure-box for first-write encryption, and reuse the existing Linq egress authority hook to revalidate the paired request/completion immediately before provider dispatch.
7. Risk: Accounting changes delay or alter a privacy-sensitive answer.
   Mitigation: collect existing usage drafts, stage one best-effort closure on the existing durable-checkpoint-effect seam, and begin external recording only after the mailbox attempt state is accepted durably, with deterministic request/attempt/stage identities.
8. Risk: Immutable permission and regrant history grows without a numeric group-lifetime bound.
   Mitigation: declare the current ownership, deletion lifetime, snapshot exclusion, indexed access, and unbounded historical cardinality truthfully; keep producer enablement blocked until a numeric cap or equally explicit bounded-retention rule lands, without adding a scheduler here.
9. Risk: An unkeyed permission digest makes predictable health scopes recoverable through offline dictionary matching or reveals equal permissions across groups.
   Mitigation: reuse the existing contact-privacy keyring and add one group-scoped blind-index kind; validate stored versions through read candidates after decrypt, while keeping request identity free of private text.

## Tasks

1. Fetch current `origin/main`, merge it normally, and resolve conflicts minimally.
2. Inspect the candidate prompt assembly and add the precise per-disclosed-information grant rule.
3. Add focused candidate-prompt assertions for exact permission/question rendering and fail-closed behavior.
4. Add a latest-revocation time fence and the E1/E2/revoke/replay/E3 regression sequence.
5. Restore legacy detached `cannot_answer` explanations and prove consented denials remain null.
6. Apply the existing disclosure producer gate to outward consent-message production and prove gate-off has no send/store side effects.
7. Encrypt permission text through the existing secure-box owner and prove authorized round trips plus fail-closed ciphertext handling.
8. Keep reviewed-exact delivery bound to immutable group audience fields and revalidate paired mailbox/grant authority at provider egress.
9. Route candidate/reviewer usage through the existing hosted usage ledger with deterministic identities and best-effort failure isolation.
10. Require exact parsed Like evidence, populate truthful mutation summaries, and reuse canonical group/member lock helpers.
11. Inspect the existing real-Postgres test harness and add focused concurrency proof only if it is a small, reusable fit.
12. Run routed verification and required audits, inspect the final diff for secrets and identifiers, and resolve any accepted findings.
13. Close the plan with the scoped commit helper, push the PR branch, and prove exact-head mergeability.

## Decisions

- Keep the outgoing reviewer unchanged; defense in depth is limited to the existing private candidate prompt.
- Treat ambiguity about any disclosed information as out of scope and return `cannot_answer` with `answer: null`.
- Treat provider reaction time as the ordering authority for post-revocation regranting, consistent with the existing join-time fence; exact retries and pre-revocation alternates remain inert.
- Keep compatibility normalization policy-neutral; consented disclosure alone owns candidate/reviewer denial redaction.
- Keep plaintext permission text bounded to authorized Web/runtime boundaries; storage uses the existing group-owned encrypted private-field lane.
- Keep reviewed-exact authorization speaker-neutral only for non-direct group delivery; legacy direct completion retains actor equality.
- Record model usage through the existing ledger without making usage persistence part of disclosure success; the detached controller only stages the existing post-checkpoint effect and never starts or awaits an external usage write before durable mailbox state.
- Defer a new real-Postgres concurrency fixture: the existing harness is file-local, a truthful full Assistant Ask fixture is disproportionate here, and concurrent uncommitted grant acceptance is intentionally fail-closed (`grant_unavailable`) with retry rather than wait-for-success.
- Keep the producer disabled after merge until immutable permission/regrant history has a concrete numeric cap or equally explicit bounded-retention rule; the active-grant response cap does not bound historical rows.
- Treat the stored permission digest as privacy-sensitive operational metadata: it is group-scoped and keyed through the existing versioned contact-privacy owner, and an old readable version remains valid after decrypt during rotation.
- Keep the database request id rotation-stable over group plus accepted input, while the Linq-only provider idempotency key hashes the group, accepted input, and exact public consent-message bytes. A provider-success/database-failure message remains inert unless a row is bound; do not add pending reservation or reconciliation state for that availability-only orphan.

## Verification

- Passed: Assistant Engine focused Vitest (`assistant-ask` plus group dynamic tool), 2 files / 50 tests.
- Passed: Assistant Runtime focused Vitest (detached Assistant Ask plus reviewed-exact completion), 2 files / 20 tests.
- Passed: Web focused Vitest (disclosure store/private storage, reaction, member ask, group tool, Linq egress, and migration), 7 files / 159 tests.
- Passed after the keyed-digest correction: Web contact-privacy, disclosure store/private storage, and group-tool Vitest, 4 files / 91 tests; Web prepared typecheck.
- Passed after centralizing the reviewed-completion delivery-key protocol: hosted-execution full Vitest, 37 files / 369 tests, plus its focused exact-vector file, 1 file / 8 tests; Assistant Runtime completion Vitest, 1 file / 8 tests; Web delivery-authority Vitest, 1 file / 21 tests; hosted-execution, Assistant Runtime, and Web prepared typechecks; scoped Web ESLint; and `git diff --check`.
- Passed: Assistant Engine, Assistant Runtime, and full Web typechecks; Web included Health Commons generation, Prisma generation, and the prepared Next/TypeScript check.
- Passed final coverage-write: all seven requested invariants have direct proof, including a test-only assertion that reviewed delivery delegates to the shared key owner and cannot collide with legacy delivery. Focused completion and hosted-execution identifier tests passed 9/9 and 8/8. Broader green evidence includes Assistant Engine 2,320 tests with 5 skipped, Assistant Runtime 1,743 with 2 skipped, hosted-execution 369/369, Web 5,409 with 141 skipped, Web lint with 0 errors, Web dev smoke and production build, Cloudflare typecheck, and the focused Cloudflare Assistant Ask port 3/3.
- The required broad `pnpm test:diff` was non-certifying under severe shared-host contention: unrelated CLI tests hit their exact timeouts, runtime tests racing on a shared fixed `/tmp/vault-root` passed 71/71 when serialized alone, and broad Cloudflare Vitest left esbuild children blocked in host filesystem I/O. No PR-scoped assertion failed; focused and downstream proof above is the next-best verification.
- Attempted `pnpm verify:acceptance` once with normal repo defaults. Syntax, dependency, architecture, privacy-log, boundary, workspace typecheck, doc-gardening, prepared-artifact, fixture, Web 5,409-test, Web lint/smoke/build, and tracked-artifact checks passed. The parallel coverage lane then reproduced unrelated exact CLI timeouts, reached the 4 GB V8 heap limit, and contaminated downstream App Server/fork tests; the owned verifier session was stopped with exit 130 after the OOM made it non-certifying.
- Passed final `git diff --check`, direct-identifier and credential scans, private-content logging scan, one-owner reviewed-delivery-key scan, rollout-doc consistency check, and working-tree scope inspection.
- Pending after push: GitHub checks and exact-head mergeability proof against the then-current `main`.
Completed: 2026-07-16
