# Harden hosted blind-index rotation lookups for Telegram and Stripe

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Prevent hosted blind-index key rotation from allowing Telegram or Stripe identities to resolve to the wrong member when legacy and current lookup-key versions coexist.

## Success criteria

- Telegram and Stripe read paths never choose an arbitrary member when multiple blind-index versions for the same raw identifier exist across members; they fail closed instead.
- Telegram and Stripe write paths reject cross-member conflicts across all configured read versions, not just the current literal lookup key.
- Concurrent mixed-version writers cannot create a cross-member duplicate for the same Telegram or Stripe identifier during rotation overlap.
- Focused regression coverage proves the conflict detection and ambiguous-read behavior.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/{contact-privacy-core,hosted-member-routing-store,hosted-member-routing-telegram,hosted-member-billing-store,stripe-billing-lookup,webhook-provider-telegram}.ts`
- directly coupled `apps/web/test/**` coverage for hosted member routing, hosted member billing refs, Stripe lookup, and contact-privacy helpers
- `docs/hosted-contact-privacy-rotation.md` if the landed behavior changes the durable rotation rule
- `agent-docs/exec-plans/active/{2026-04-23-hosted-contact-privacy-rotation-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- unrelated hosted auth-binding hardening beyond this Telegram/Stripe lookup seam
- broad schema redesign or parallel blind-index columns
- unrelated hosted billing, hosted-run, or Cloudflare runner work already in progress in the tree

## Constraints

- Technical constraints:
- Preserve the current one-column blind-index storage model; do not add permanent dual-write or parallel lookup columns just to handle rotation overlap.
- Treat ambiguous multi-member lookup matches as fail-closed conditions rather than choosing an arbitrary row.
- Keep write-side protection safe under concurrent mixed-version writers.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the active hosted billing work in `stripe-billing-lookup.ts` and the active hosted auth/billing rows already registered in the coordination ledger.
- Treat this as a high-risk hosted `apps/web` change: run `pnpm verify:acceptance`, add direct proof where useful, and complete the required `coverage-write` plus `task-finish-review` audit passes before handoff.

## Risks and mitigations

1. Risk: app-only conflict scans could still race under mixed-version concurrent writers.
   Mitigation: serialize writes with transaction-scoped advisory locks keyed to the underlying normalized identifier, then scan all read candidates before mutating.
2. Risk: fail-closed reads could turn latent bad data into webhook failures.
   Mitigation: keep the error explicit and regression-tested so the system stops corrupting state and surfaces the underlying conflict deterministically.
3. Risk: narrow fixes could diverge from the documented hosted contact-privacy rotation seam.
   Mitigation: update the durable rotation doc in the same change if the landed invariant becomes part of the expected operating model.

## Tasks

1. Completed: registered the task in the ledger and created this active plan.
2. Completed: inspected the Telegram and Stripe blind-index read/write seams plus overlapping dirty-tree hosted billing/routing edits.
3. Completed: added rotation-stable conflict-lock tokens, advisory-lock-backed write serialization, cross-version conflict scans, and fail-closed ambiguous-read handling for Telegram and Stripe lookup paths.
4. Completed: added focused regression coverage for ambiguous Telegram/Stripe reads, cross-version write conflicts, Privy sign-in fail-closed behavior, conflict-lock stability, and advisory-lock path assertions.
5. Completed with unrelated broader-lane blocker: ran focused owner verification, direct scenario proof, required `coverage-write`, required `simplify`, required `task-finish-review`, and post-review reruns; the broader diff-aware `apps/web` lane still fails on unrelated pre-existing tests outside this slice.
6. In progress: create the scoped commit path in the dirty tree and hand off the overlapping-file caveats.

## Decisions

- Kept the one-column blind-index storage model and made rotation overlap safe with multi-version read candidates plus rotation-stable advisory-lock serialization instead of adding parallel lookup columns.
- Preserved webhook-specific ambiguity handling by keeping `resolveHostedMemberRoutingByTelegramUserId()` tri-state for Telegram webhook planning while making the shared `lookupHostedMemberRoutingByTelegramUserId()` surface fail closed for auth/identity consumers.
- Treated adjacent Telegram thread-target persistence and broader Stripe billing freshness/fallback work as overlapping dirty-tree context rather than widening this lane further.

## Verification

- Commands run:
- `pnpm --dir apps/web typecheck` ✅
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-core apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-lookup.test.ts` ✅
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-integrations --project hosted-web-store-config apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/contact-privacy-member-lookups.test.ts` ✅
- `DATABASE_URL='postgresql://localhost:5432/murph_test' pnpm --dir apps/web exec tsx --eval ...` ✅ direct proof: ambiguous two-candidate Telegram lookup now throws `TELEGRAM_ROUTING_LOOKUP_AMBIGUOUS`, and ambiguous two-candidate Stripe customer lookup throws `STRIPE_BILLING_LOOKUP_AMBIGUOUS`, both retryable 500s.
- `git diff --check -- <touched paths>` ✅
- `bash scripts/workspace-verify.sh test:diff <touched paths>` ❌ unrelated pre-existing failures in `apps/web/test/hosted-onboarding-linq-dispatch.test.ts` and `apps/web/test/browser-vault-dashboard-pages.test.tsx`; these do not cover or contradict the Telegram/Stripe rotation-hardening slice.
- Expected outcomes met:
- Telegram webhook and auth/member-resolution paths no longer depend on `findFirst` row order or ambiguous-to-null fallback.
- Stripe customer/subscription lookups fail closed if rotation overlap leaves the same external id on multiple members.
- Write paths scan all configured read candidates and acquire rotation-stable advisory locks before rebinding.

## Outcome

- Implemented the requested Telegram/Stripe blind-index rotation hardening without widening storage shape:
- added rotation-stable conflict-lock token helpers and advisory-lock acquisition for Telegram/Stripe rebinds
- made Telegram and Stripe read lookups fail closed on multi-member matches
- extended the fail-closed Telegram behavior through the shared Privy/auth identity lookup path
- documented the advisory-lock invariant and added direct proof plus focused regression coverage

## Audits

- `coverage-write` (`gpt-5.4-mini`) completed with no additional coverage changes requested.
- `simplify` review found one high-severity gap: shared Telegram lookup still collapsed ambiguity to `null`; fixed by throwing `TELEGRAM_ROUTING_LOOKUP_AMBIGUOUS` and adding a higher-boundary Privy verification regression.
- `task-finish-review` found proof/doc gaps around the advisory-lock invariant; addressed with conflict-lock stability tests, explicit advisory-lock assertions in write-path tests, and durable doc updates.

## Commit note

- Commit via `scripts/finish-task` is next. The tree contains overlapping pre-existing hosted Telegram/Stripe edits in some touched files; call that out in handoff if the scoped commit necessarily absorbs those adjacent dirty-tree hunks.
Completed: 2026-04-23
