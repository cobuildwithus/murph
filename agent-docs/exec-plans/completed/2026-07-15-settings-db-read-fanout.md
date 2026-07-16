# Settings database read fanout

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Preserve the current Settings experience while removing its duplicate account/contact read and reducing private-field decrypt fanout to the fields the page actually uses.

## Success criteria

- Settings derives the voice-test contact target from its already-loaded account and routing data without calling the broad hosted contact-context loader.
- The account Settings composite issues one narrow member query and decrypts only the rendered phone, email, routing, and billing facts.
- Multi-field decrypts reuse one scoped hosted-domain root unwrap without changing data classification or key lifetime.
- Regression tests mechanically cover query composition, decrypt scope, and voice-test routing behavior.
- Required hosted-web verification, specialist audits, PR CI, ReviewGPT, and mergeability proof are green.

## Scope

- In scope: the Settings server page, its account Settings snapshot owner, existing narrow private-field projectors, and focused hosted-web tests.
- Out of scope: the shared hosted contact-context/dashboard-shell rewrite, database schema, persisted data, billing or access policy, and visible Settings UI changes.

## Constraints

- Do not edit `apps/web/src/lib/hosted-onboarding/hosted-contact-context.ts` or global dashboard contact behavior.
- Preserve verified-versus-checkout email precedence, pending/home Linq presentation, Telegram linkage, assistant preferences/model availability, and billing actions.
- Keep private values encrypted at rest and confined to the existing server-side Settings boundary.
- Prefer one explicit Settings projection over a new generic snapshot framework.

## Tasks

1. Trace the current Settings field requirements and contact-routing semantics.
2. Add one narrow Settings member projection under the hosted domain-root unwrap cache.
3. Derive the voice-test contact option from the loaded Settings projection.
4. Add focused query-count/composition, decrypt-scope, and routing regressions.
5. Run hosted-web verification, required coverage and frontend reviews, local final review, and close the plan with a scoped commit.
6. Push, open the required-format PR, run CI and ReviewGPT to pass, and prove mergeability.

## Risks and mitigations

1. Risk: narrowing the query drops a field that controls billing or messaging presentation.
   Mitigation: enumerate every page consumer, keep exact existing field precedence, and assert the Prisma select and rendered props in tests.
2. Risk: deriving voice routing locally changes channel preference behavior.
   Mitigation: reuse the existing pure `resolveMurphContactOptions` owner with the same channel booleans, preferred kind, destination values, and email-only suppression.
3. Risk: a crypto cache scope extends key lifetime or crosses requests.
   Mitigation: reuse the existing AsyncLocalStorage scope and deterministic zeroization boundary only around the single Settings composite.

## Verification

- Focused Settings/account projection tests passed: 4 files, 47 tests.
- Final `pnpm test:diff` passed on the reconciled base: all workspace guards, hosted-web production build, TypeScript, development smoke, lint with zero errors, and 431 passing test files / 5,224 passing tests.
- `coverage-write` found the existing exact-query, narrow-select, unwrap-scope, projection, and voice-routing proof sufficient and made no edits.
- `frontend-review` found no evidence-backed findings. No authenticated browser pass was run because the diff changes no rendered markup, styling, copy, focus behavior, or client interaction; source-equivalence and static-render coverage were used instead.
- Local final review passed `git diff --check`, privacy scanning, and static readback proving the Settings owners no longer call the broad snapshot/preferences/model/contact loaders.
- PR CI, exact-head ReviewGPT pass, and mergeability proof remain before handoff.
Completed: 2026-07-15
