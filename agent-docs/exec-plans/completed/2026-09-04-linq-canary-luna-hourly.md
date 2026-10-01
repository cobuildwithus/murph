# Linq production canary Luna and hourly cadence

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Run the fixed production Linq canary on GPT-5.6 Luna and admit its automatic
  journey at most once per hour.

## Outcome and protected invariants

- The production canary continues to prove the complete reciprocal iMessage
  journey against the exact current protected-main Web deployment.
- The fixed synthetic canary member uses Luna for runtime assistant turns while
  ordinary members keep their existing model selection.
- Manual recovery remains available without restoring deployment-event fanout.

## Current owners and evidence

- `.github/workflows/linq-production-canary.yml` owns automatic admission and
  exact Vercel deployment verification. Production history showed deployment
  bursts admitting materially more than one canary per hour.
- The canary phone configuration already owns synthetic-member attribution.
  `HostedMember.assistantModelPreference` and the hosted assistant model
  resolver already own per-member model selection and support Luna.
- The first tool-free welcome already uses the existing Luna first-turn path;
  the ordinary runtime continuations currently resolve to Terra.

## Smallest durable correction

- Delete deployment-status admission and use one staggered hourly schedule.
  Reuse the existing protected-main ancestry and current Vercel alias checks.
- Set the existing model-preference field only when creating the configured
  canary participant. Add no scheduler, lock, table, queue, or model router.
- Preserve the existing prompt, provider, reasoning effort, tools, delivery,
  reset, and account-deletion contracts.

## Failure, recovery, and deployment

- A schedule whose protected-main SHA is not yet the current Vercel alias skips
  safely; the next hourly slot rechecks the live alias.
- A failed journey fails its workflow as today. Manual dispatch can retry an
  exact main-reachable current deployment.
- The Web model-preference write and workflow cadence land together in one
  backward-compatible deployment; no schema or secret change is required.

## Proof

1. Update focused workflow source proof for hourly schedule, exact SHA fallback,
   current-alias verification, and absence of deployment-status admission.
2. Add deterministic Web coverage proving only the configured canary participant
   is created with the Luna preference and ordinary participants are unchanged.
3. Run focused Web and workflow tests, package typecheck, and one synthetic
   real-Codex journey on `gpt-5.6-luna`; inspect the actual reply.
4. Run exact-head CI and final ReviewGPT because the change touches production
   admission and model routing.

## Done when

- Automatic production canary admission has one hourly trigger.
- Every canary runtime turn resolves through the existing Luna preference.
- Focused proof, typecheck, exact-head CI, ReviewGPT, commit, PR, merge, and
  worktree retirement complete.

## Candidate evidence

- `node --test scripts/linq-production-canary-ci.test.mjs`: 3 passed.
- Focused hosted Web Vitest slice: 96 passed across canary identity, member
  creation, and production deployment verification.
- Hosted Web and Assistant Engine typechecks passed.
- Focused real-Codex onboarding journey passed on `gpt-5.6-luna` through local
  subscription auth: one resume-context read, no progress update, and a concise
  expected onboarding reply. UX verdict: Ready.
- `pnpm test:diff <changed paths>` passed the full affected package and app
  graph, including Web tests, lint, dev smoke, production build, and Cloudflare
  verification.
- `actionlint .github/workflows/linq-production-canary.yml` and
  `git diff --check` passed.
Completed: 2026-09-04
