# Preserve native canary success across production promotions

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal and evidence

Two fresh native production journeys completed all eleven business stages, but
an added final unchanged-deployment check rejected both after normal promotions.
The production health canary emits no per-commit acceptance status. Requiring a
frozen deployment for the whole long native journey is an unnecessary new
restriction, separate from trusted production selection at dispatch.

## Existing owner and smallest correction

Delete the final workflow step. Retain protected-main manual admission, exact
production selection and ancestry, dispatch-time equality, immutable private
source and exact returned-run binding, real native assertions, fixed identity,
and non-canceling concurrency. The Web SHA records the deployment at dispatch;
it does not claim one unchanged revision throughout the journey. Preserve the
separately merged twelve-hour schedule. Add no retry loop, new state, dependency,
or alternate success receipt.

## Scope and risk

Only the iOS controller, its focused regression, existing owner docs and existing
synthetic friction report change. Private native code and Android are unchanged.
A native failure still fails the public run. Ordinary promotions may occur while
a successful journey spans versions; this is production health proof rather than
candidate-commit acceptance. The private v3 contract stays compatible.

## Verification and acceptance

- Native controller regressions and repository tooling typecheck.
- Parent diff/privacy review and final ReviewGPT on the pushed candidate.
- Required final-head CI, then a fresh protected native production run.
- No changelog: internal CI correction with no member-facing behavior change.

## Implementation evidence

Native iOS/Android controller tests: 25 passed. Repository tooling typecheck and
complexity guard passed. Parent review confirms only the additional post-journey
restriction is removed; pre-dispatch authority and native success requirements
are retained. The two observed live journeys passed every business stage.
ReviewGPT, exact-head CI and fresh public workflow acceptance remain external
gates for this final implementation candidate.
Completed: 2026-09-18
