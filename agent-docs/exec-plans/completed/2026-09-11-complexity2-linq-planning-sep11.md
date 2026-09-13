# Simplify Linq direct-member admission and signup planning

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce Linq planner complexity by isolating the existing direct-member admission boundary and sharing repeated fallback signup and first-contact admission plan construction. Preserve every accepted-message, consent, identity, routing, and delivery invariant.

## Evidence and current owners

The provider planner has complexity debt 278 and maximum 93. Direct-member admission currently combines exact mailbox dedupe, consent outcomes, failed preparation precedence, and routing revalidation within the outer planner. Initial fallback and fallback retry repeat the same inbound-count, invite, and response sequence; direct/group admission repeat the same result construction.

The existing Web transaction, mailbox dedupe, member access, prepared routing and invite owners remain authoritative. Preflight and in-transaction reads are separate live checks and must not be collapsed.

## Scope and constraints

- In scope: private same-file phase and shared result construction in webhook-provider-linq.ts; focused proof if an evidence gap appears.
- Out of scope: schema, public API, prompts, provider requests, line policy, group provisioning redesign, deployment and merging.
- Preserve participant-before-chat-before-member locks, access reads, duplicate recovery before mutable policy, consent notice behavior and crypto failure precedence.
- Preserve Family-before-group-before-billing handling, post-Family access rechecks, first-contact identity creation authority, invite ownership and inbound counting order.
- No new database/provider calls, retries, dependencies, persisted state or framework.

## Tasks

1. Inspect current source, owner docs and composed coverage.
2. Isolate direct-member admission and remove repeated fallback/admission construction.
3. Run focused composed Web tests, Web typecheck and complexity guard; inspect the full diff and privacy.
4. Close this plan with a scoped commit, push and create a complete draft PR. Parent owns candidate review, Ready, ReviewGPT and completion.

## Risks and mitigation

- A refactor could change which duplicate, consent or preparation failure wins. Keep the existing order and exercise the composed dispatch, idempotency and mailbox-preparation suites.
- Sharing fallback work could move counting or invite issuance ahead of route authority. Invoke the shared sequence only at the original call sites after their unchanged authorization work.
- No member-visible change or provider-input change is intended, so no changelog entry or model-input measurement is required.

## Verification

- Passed: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-thread-route.test.ts test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts test/hosted-onboarding-linq-read-receipt-authority.test.ts test/hosted-onboarding-webhook-idempotency.test.ts` — 433 tests in five files.
- Passed: `pnpm --dir apps/web typecheck` with the shared two-checker profile.
- Passed: `pnpm complexity:diff --base HEAD` against the unchanged task base. File debt 278 to 257; maximum 93 to 89. Outer planner 93 to 76; first-contact planner 76 to 72. Both added private helpers are below the threshold of 20.
- Reviewed all nine remaining hotspots. Group planning, message-edit handling, thread preparation, Family acceptance and route policy retain their existing authority and transaction boundaries; further decomposition belongs in separately proven work.
- Existing composed tests cover exact duplicate repair before mutable policy, withdrawn consent versus failed/null preparation, first-contact fallback/retry, group admission, prewarmed cryptography and receipt authority. No new test-only export or duplicated implementation test was needed.
- Full source diff and privacy inspected; `git diff --check` passed. No added database or provider call, no changed live-read ordering, and no schema or provider-input change.

## Outcome and handoff

Existing direct-member admission now returns either its canonical terminal plan or its two admitted routing facts. Initial and retry fallback signup share one ordered count/invite/response sequence; direct and group first-contact admission share existing result and diagnostic construction. Removed the one-use duplicate-plan closure and redundant first-contact active-state alias.

Implementation and focused proof are complete. The parent owns the draft candidate review, Ready transition, exact-head CI, ReviewGPT and merging. No changelog: this is internal, behavior-preserving planner maintenance.
Completed: 2026-09-11
