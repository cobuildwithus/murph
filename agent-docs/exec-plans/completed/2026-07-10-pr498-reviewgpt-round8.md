# PR 498 ReviewGPT Round 8 Fixes

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Close the accepted ReviewGPT round 8 findings without adding a new state owner,
  app-bundled secret, or raw provider logging surface.

## Success criteria

- Authorization and proxy-authorization values are removed through their original
  line boundary before error text is flattened.
- Production WAF proof uses explicit Vercel API credentials and accepts only a
  highest-priority exact-path fixed-window IP rate-limit rule.
- The hosted warning retains only a finite set of Murph-recognized Privy auth
  machine codes; unknown codes become null without dropping the diagnostic.
- Focused tests, typecheck, lint, and completion audits pass; the PR-level
  ReviewGPT/CI gates run against the closed-plan commit.

## Scope

- In scope: shared hosted error redaction, companion auth diagnostics validation,
  WAF preflight, focused tests, iOS provider-code normalization, and matching docs.
- Out of scope: App Attest, database persistence, raw provider messages, enabling
  the production route, or adding a bundled shared secret.

## Constraints

- Keep the route default-off, spoofable, side-effect-free except for one bounded
  warning, and protected by a verified edge rate limit before enablement.
- Prefer finite data contracts and direct API reads over parsing arbitrary text,
  ambient CLI state, new dependencies, or durable rate-limit state.

## Tasks

1. Add regressions and fail-closed whole-line authorization redaction.
2. Require the WAF rule to be first and query Vercel through explicit API inputs.
3. Drop provider codes outside the finite iOS auth contract on both sides.
4. Run scoped verification and audits, then close the plan for the PR-level
   ReviewGPT/CI gates.

## Decisions

- Accept the redaction and WAF-order findings after local reproduction and official
  Vercel documentation proof.
- Accept the provider-code privacy issue, but reject the proposed claim that Privy
  supplies an exhaustive enum: the pinned SDK exposes a string and Privy documents
  its published list as incomplete.
- Do not add an app-bundled secret because it is extractable, replayable, and does
  not attest an authentic installation.
- Accept coverage follow-ups for CR-delimited authorization values, equals-form
  adjacent redaction, inactive WAF predecessors, and non-string provider codes.
  Reject a third exhaustive provider-code list in tests because it adds another
  synchronization source without improving the fail-closed production boundary.

## Verification

- `packages/device-syncd`: 720 tests pass; coverage is 88.79% statements, 79.11%
  branches, 94.77% functions, and 89.09% lines.
- `apps/web`: 4,072 tests pass with 9 skipped; lint has no errors; dev smoke,
  typecheck, and the production build pass. Final focused route/WAF tests pass
  60/60 after coverage follow-ups.
- iOS: SwiftFormat and XcodeGen pass; iPhone 17 Pro and iPad Air 11-inch (M4)
  simulator suites each pass 55/55. The matching iOS commit is on `main`.
- Security/privacy review and its targeted WAF-order re-review report no
  medium-or-higher findings. Coverage-write re-review reports no remaining gap.
- `pnpm test:diff` reached affected reverse-dependency typechecks but its parallel
  lane failed to resolve untouched `inbox-services` workspace packages. The
  documented owner-level fallbacks above pass, and that untouched package
  typechecks from the main checkout.
Completed: 2026-07-10
