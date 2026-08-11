# Repair upstream CI regressions

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Restore exact-head CI after two unrelated regressions entered `main` while the
  referral-copy pull request was in progress.

## Success criteria

- Connected-app skill assertions tolerate intentional Markdown line wrapping
  without weakening their required wording checks.
- The new static Family setup page participates in the existing fail-closed
  Vercel telemetry owner list.
- Focused tests, affected typechecks, docs/design gates, and exact-head CI pass.

## Scope

- In scope: the two deterministic baseline failures observed in GitHub Actions
  and the minimum test or owner-list corrections that address their root causes.
- Out of scope: connected-app behavior, Family setup behavior, telemetry policy,
  referral behavior, and unrelated failures.

## Constraints

- Reuse the connected-app test's existing whitespace normalization.
- Preserve the fail-closed static-page completeness assertion; register the page
  in its production owner list instead of excluding it from coverage.
- Keep the repair independent of the referral-copy implementation.

## Risks and mitigations

1. Risk: a test-only workaround could hide missing product configuration.
   Mitigation: update the production telemetry allowlist for the real page.
2. Risk: exact prose assertions could become too permissive.
   Mitigation: normalize whitespace only and retain the exact required phrases.

## Tasks

1. Prove each failure from exact GitHub Actions logs and current `main` code.
2. Apply the smallest correction at the existing owner boundary.
3. Run focused tests, affected typechecks, docs/design gates, and diff hygiene.
4. Archive this plan with the scoped repair commit, push, and monitor exact-head
   CI to completion.

## Decisions

- The connected-app assertions use the already-created normalized skill string.
- `/family/setup` is added to `VERCEL_TELEMETRY_PATHNAMES`; the completeness test
  remains unchanged.

## Verification

- Connected-app provider-export test: passed 3/3.
- Assistant-engine typecheck: passed.
- Vercel telemetry focused test: passed 10/10.
- Frontend design-proof tests: passed 10/10.
- Web typecheck: passed.
- Final docs drift: passed.
Completed: 2026-08-09
