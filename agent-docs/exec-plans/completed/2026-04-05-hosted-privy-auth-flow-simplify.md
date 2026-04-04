# Simplify hosted Privy auth flow and remove browser-side polling coordination

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Simplify the hosted Privy onboarding flow so the browser performs one explicit login-and-complete progression instead of background session polling, auto-continue loops, and mixed auth semantics.
- Unify hosted browser-authenticated routes on one consistent bearer-plus-identity contract wherever the browser is talking to Murph APIs.

## Success criteria

- `HostedPhoneAuth` no longer auto-continues or auto-resets authenticated sessions through mount-time effects and repeated `refreshUser()` polling.
- Browser requests fail explicitly when Privy tokens cannot be retrieved instead of silently sending unauthenticated requests.
- `/api/hosted-onboarding/privy/complete` uses the same strict request-auth contract as the rest of the hosted browser-authenticated routes.
- Client retry behavior is bounded to explicit completion attempts rather than background provider polling loops.
- Focused hosted onboarding and settings-sync tests cover the new explicit flow and the stricter auth behavior.

## Scope

- In scope:
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-05-hosted-privy-auth-flow-simplify.md`
- `apps/web/src/components/hosted-onboarding/{client-api.ts,hosted-phone-auth.tsx,join-invite-client.tsx}`
- `apps/web/src/lib/hosted-onboarding/{privy-client.ts,request-auth.ts,privy.ts}`
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- Focused hosted onboarding/settings tests under `apps/web/test/**`
- `apps/web/README.md` if the documented flow contract needs updating
- Out of scope:
- Hosted billing behavior changes
- Hosted first-contact runtime changes
- Broader settings UX redesign
- Privy dashboard or Vercel env mutation

## Constraints

- Technical constraints:
- Preserve current product behavior where possible while removing background session orchestration and silent auth fallback.
- Keep the change inside `apps/web`; do not broaden into hosted runtime or billing lanes already in flight elsewhere.
- Merge onto the current dirty tree carefully because overlapping hosted onboarding files are already active in other lanes.
- Product/process constraints:
- Follow the high-risk repo workflow: coordination ledger, plan, required verification, required audit pass, and scoped commit.
- Do not expose secret env contents or raw tokens in code, tests, logs, or handoff.

## Risks and mitigations

1. Risk: stricter auth on `/privy/complete` could break flows that currently depend on identity-token-only fallback.
   Mitigation: update client auth-header behavior first, add focused route tests for missing-token and mismatch cases, and keep the route contract explicit.
2. Risk: removing auto-continue could regress invite UX.
   Mitigation: preserve explicit user-triggered continue/verify flows and keep invite progression driven by the completion response rather than extra status polling.
3. Risk: overlapping hosted onboarding edits elsewhere could drift while this lane is active.
   Mitigation: keep scope narrow, re-read current files before editing, and avoid broad refactors unrelated to auth progression.

## Tasks

1. Simplify the browser auth helper and hosted phone flow so token failures are explicit and background Privy polling is removed.
2. Unify `/api/hosted-onboarding/privy/complete` with the strict request-auth contract and trim stale identity-only completion helpers.
3. Update invite/onboarding client progression to rely on explicit completion responses rather than immediate status refresh chaining.
4. Refresh focused tests and README wording as needed.
5. Run required verification, complete the mandatory final audit pass, then close the plan and create a scoped commit.

## Decisions

- Favor one explicit browser progression step over automated resume/restart logic, even if that slightly reduces “magic” behavior for stale sessions.
- Treat Privy 429s and token-retrieval failures as explicit user-facing stop conditions instead of silent client retries.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Focused `apps/web` tests while iterating
- Expected outcomes:
- Required commands pass, or any unrelated pre-existing failures are documented precisely with why this diff did not cause them.
Completed: 2026-04-05
