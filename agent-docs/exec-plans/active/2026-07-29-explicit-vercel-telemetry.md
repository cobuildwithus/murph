# Explicit Vercel telemetry route allowlist

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Restrict Vercel Web Analytics and Speed Insights to an explicit set of public
  or deliberately approved routes so private and health-context navigation does
  not load browser telemetry.
- Preserve useful telemetry on the approved landing, club, home, changelog, and
  pitch pages without sending query strings or URL fragments.

## Success criteria

- The root layout no longer mounts `VercelTelemetry`.
- Each allowlisted pathname has exactly one direct page-level telemetry mount,
  and the allowlist cannot silently drift from those owners.
- Non-allowlisted page-view and performance events are rejected.
- Allowlisted URLs are canonicalized to the approved pathname with query
  strings and fragments removed; mismatched Speed Insights route/URL pairs are
  rejected.
- Focused tests, lint, typecheck, the required review gates, and PR CI pass on
  the exact task head.

## Scope

- In scope:
  - Apply the supplied page-owned telemetry and fail-closed redaction change.
  - Extend it only to the public `/changelog` and `/pitch` content routes.
  - Add focused behavior and ownership coverage.
- Out of scope:
  - Authenticated dashboards, onboarding, account, device, record, lab,
    experiment, search, invitation, handoff, and operations routes.
  - Custom event instrumentation or changes to Vercel dependencies.
  - A broader analytics or consent architecture.

## Constraints

- Technical constraints:
  - Keep one allowlist as the source of truth and mount the existing telemetry
    component directly from the owning pages.
  - Default to suppression for unknown paths and malformed or mismatched URLs.
  - Do not weaken existing redaction helpers used outside automatic telemetry.
- Product/process constraints:
  - Treat route and referrer context as potentially sensitive health data.
  - Keep private/authenticated surfaces excluded even when their URL does not
    contain a direct identifier.
  - Preserve unrelated working-tree changes and use the normal worktree, review,
    commit, PR, and CI completion lane.

## Risks and mitigations

1. Risk: A route transition could leave an already-loaded telemetry script
   active on a non-allowlisted route.
   Mitigation: Keep `beforeSend` fail-closed against the same allowlist instead
   of relying only on mount placement.
2. Risk: Query strings, fragments, or a Speed Insights route mismatch could
   leak a sensitive URL despite an approved mount.
   Mitigation: Canonicalize approved events to the allowlisted pathname and
   reject route/URL disagreement, with focused regression tests.
3. Risk: A future allowlist entry could omit its page mount or reintroduce a
   global mount.
   Mitigation: Statistically verify exact page ownership from the exported
   allowlist and prohibit telemetry imports in the root layout.

## Tasks

1. Implement the supplied allowlist, page mounts, canonicalization, and tests.
2. Add page-owned mounts for the approved public changelog and pitch routes.
3. Run focused tests, lint, typecheck, and privacy-safe diff inspection.
4. Run the preliminary specialist review, resolve findings, and perform the
   parent final review.
5. Commit, push, open a PR, start the final ReviewGPT gate concurrently with CI,
   resolve any actionable findings, and confirm required checks pass.

## Decisions

- Approved `/changelog` and `/pitch` as the only additions beyond the supplied
  patch because they are public, content-only routes with stable neutral
  pathnames and no user-controlled path segments.
- Excluded legal/privacy, security, knowledge, invitation, account, operational,
  dynamic, and authenticated surfaces. Public availability alone is not enough
  when the page context is health-, identity-, or trust-sensitive.
- Retained `/home` because it is explicitly part of the supplied patch, while
  continuing to suppress every other authenticated route.

## Verification

- Commands to run:
  - Focused Vitest command for telemetry redaction and ownership coverage.
  - Focused ESLint command for touched web files.
  - Web workspace typecheck.
  - Required preliminary and final ReviewGPT gates.
  - Required GitHub Actions checks on the exact PR head.
- Expected outcomes:
  - All commands and review gates pass with no unresolved actionable findings.
  - The final diff contains no credentials, direct identifiers, private sample
    data, or local filesystem paths.
