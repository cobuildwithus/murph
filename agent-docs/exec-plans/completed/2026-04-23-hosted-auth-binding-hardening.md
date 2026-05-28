# Harden hosted onboarding auth binding and origin enforcement

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fail closed for existing-account sign-in, tighten hosted identity-binding so unsupported auth factors cannot silently create or misbind members, reject stale Privy member metadata, and make hosted mutation-origin enforcement canonical in production.

## Success criteria

- Existing-account sign-in never creates a hosted member, never issues new-member side effects, and never writes sticky member metadata when no hosted binding already exists.
- Email and Telegram auth surfaces no longer behave as hosted binding primitives unless the server can prove an explicit hosted binding for the member.
- `request-auth` does not trust stale or mismatched `murph_member_id` metadata when the verified Privy session resolves to a different member or no member.
- `/api/hosted-onboarding/privy/complete` performs zero member or routing mutations for missing, expired, invalid, or lagging Privy sessions.
- Hosted mutation-origin enforcement allows explicit local development fallbacks only where intended and otherwise fails closed to the configured canonical public origin.
- Focused regression coverage exists for the reported auth-binding, stale-metadata, session-failure, and origin-boundary cases.

## Scope

- In scope:
- `apps/web/app/auth-controls.tsx`
- `apps/web/src/components/hosted-onboarding/{hosted-existing-account-sign-in-dialog.tsx,hosted-auth-completion.ts,hosted-phone-auth-support.ts,hosted-email-auth-button.tsx,hosted-telegram-auth-button.tsx}`
- `apps/web/src/lib/hosted-onboarding/{authentication-service,member-identity-service,member-identity-lookup,privy,privy-user,request-auth,request-auth-types,authentication-intent,csrf,env,public-url,invite-service}.ts`
- directly coupled `apps/web/test/**` coverage for hosted onboarding auth, request auth, and CSRF/origin behavior
- `agent-docs/exec-plans/active/{2026-04-23-hosted-auth-binding-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- billing, Stripe activation, hosted-run, Cloudflare runner, or unrelated onboarding copy/design work
- broad product changes that redefine sign-in as sign-up unless the current code and tests force an explicit decision
- schema changes unless they are the smallest way to preserve the auth invariants

## Constraints

- Technical constraints:
- Keep hosted identity binding anchored to explicit hosted member bindings only; do not add new implicit fallback identifiers.
- Preserve current invite-only/new-member creation semantics outside the explicit sign-in-only path.
- Treat missing canonical public origin as local-development-only unless the implementation can still fail closed safely in production.
- Any refactor should stay behavior-preserving apart from the reported auth and origin hardening fixes.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the active hosted billing, hosted-run, and ingress rows already present in `apps/web`.
- Treat this as a high-risk `apps/web` auth change: run the full acceptance lane or a truthful app-covered equivalent only if policy allows, capture direct scenario proof, and run the required `coverage-write` plus `task-finish-review` audits.

## Risks and mitigations

1. Risk: tightening sign-in-only handling could accidentally block legitimate returning users.
   Mitigation: resolve hosted members only through explicit bindings, keep invite/new-member flows separate, and add regression tests for existing bound phone flows plus unbound email/Telegram attempts.
2. Risk: stale metadata rejection could strand valid sessions if the fallback probes are incomplete.
   Mitigation: re-resolve against current hosted identity probes before trusting metadata and cover mismatch, miss, and matching cases directly.
3. Risk: failing closed on canonical origin could break local development or test harnesses.
   Mitigation: preserve explicit localhost/loopback allowances, document the intended fallback boundary in code/tests, and keep the production path canonical-origin-only.

## Tasks

1. Completed: register the task in the ledger and create this active plan.
2. Completed: inspect the current hosted onboarding UI, auth-completion, identity lookup, request-auth, and CSRF/origin code plus the existing hosted tests.
3. Completed: implement the production fixes for sign-in-only enforcement, supported hosted binding rules, stale metadata handling, completion-path mutation guards, and canonical-origin fail-closed behavior.
4. Completed: add focused `apps/web` regression tests for sign-in miss behavior, email/Telegram binding boundaries, stale metadata, completion auth failures, and canonical-origin/local-dev matrices.
5. In progress: run required verification, capture direct scenario proof, then run the required `simplify`, `frontend-review`, `coverage-write`, and `task-finish-review` audit passes and rerun affected checks as needed.
6. Pending: create a scoped commit only if the dirty tree allows exact staging of this task's paths without absorbing unrelated work.

## Decisions

- Treat `intent="signin"` as an existing-account-only server-side contract. On no-invite completion misses, `signin` now resolves only explicit hosted bindings and rejects instead of creating a member.
- Extend explicit hosted binding lookup to verified email authorization and Telegram routing records rather than relying on those factors as implicit readiness-only signals.
- Revalidate `murph_member_id` session metadata against current identity lookup before trusting it, and fail closed to unauthenticated when metadata is stale and identity probes find no member.
- Allow request-host origin fallback only for explicit non-production loopback development; otherwise require a configured canonical public origin.
- Keep the Privy metadata sync best-effort, but move it behind an explicit helper and avoid running it on sign-in misses.

## Verification

- Commands to run:
- direct focused `vitest` slices for hosted auth, request-auth, CSRF/origin, completion route, phone-sync route, and user-facing auth copy
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck`
- `bash scripts/workspace-verify.sh test:diff <task paths>`
- `git diff --check`
- required `simplify`, `frontend-review`, `coverage-write`, and `task-finish-review` audit passes
- Expected outcomes:
- Existing-account sign-in misses fail without creating or binding a hosted member.
- Stale `murph_member_id` metadata no longer authenticates the wrong member.
- Missing or mismatched origin headers fail closed against canonical production origin while explicit localhost/loopback handling still works where intended.
- Current outcomes:
- `pnpm exec vitest run apps/web/test/hosted-onboarding-privy.test.ts apps/web/test/settings-phone-sync-route.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-privy-complete-route.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/hosted-existing-account-sign-in-dialog.test.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/homepage-privy-auth.test.ts apps/web/test/join-invite-client.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/web lint` passed with unrelated pre-existing warnings outside this task slice.
- `pnpm --dir apps/web typecheck` is currently blocked by an unrelated workspace error in `packages/query/src/browser-replica/views.ts`.
- `bash scripts/workspace-verify.sh test:diff <task paths>` is currently blocked by unrelated pre-existing failures in other `apps/web` owners and an unrelated parse error in `packages/device-syncd/src/providers/whoop.ts`.
- `git diff --check -- <task paths>` passed.

## Outcome

- Implementation landed locally with focused regression coverage. Remaining work is the required audit pass sequence plus deciding whether exact-path staging is possible in the dirty tree.

## Audits

- Required audit sequence is blocked in this session because spawned Codex subagents are returning a usage-limit error before review can start.
- Local implementation work continued after the block: removed auth-slice unused imports, reran focused hosted auth/onboarding tests, and reran `apps/web` lint.
- Still outstanding once subagents are available again: `simplify`, `frontend-review`, `coverage-write`, and `task-finish-review`.

## Commit note

- Pending. Create a scoped commit only if staging can stay exact in the current dirty tree.
