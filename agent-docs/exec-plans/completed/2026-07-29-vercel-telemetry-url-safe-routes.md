# Vercel telemetry URL-safe route expansion

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Expand Vercel Analytics and Speed Insights from the initial conservative
  five-route allowlist to every current page whose emitted pathname contains no
  credential, invitation code, claim, handoff token, or private run identifier.
- Continue removing all query strings and fragments before events are sent.

## User clarification

Health-topic pages are eligible when their URL contains no private state.
Telemetry should therefore cover experiment, biomarker, laboratory, records,
search, settings, and other stable page paths while preserving fail-closed
handling for secret-bearing dynamic routes.

## Scope

- Allow every current static page pathname.
- Allow dynamic public catalog paths for biomarkers, experiments, measurement
  methods, and search products.
- Keep opaque-code and private-run paths suppressed, including approvals,
  handoffs, invitations, group join/funding codes, integration claims, and
  private experiment runs.
- Preserve malformed-input rejection, URL-state stripping, Speed Insights
  route/URL agreement, and one root telemetry owner.

## Tasks

1. Add explicit static pathname and public dynamic-pattern owners.
2. Add route-inventory proof that every current static page is covered.
3. Add positive catalog-route and negative secret-route event coverage.
4. Run focused tests, lint, typecheck, docs drift, final ReviewGPT, and exact-head
   PR CI.

## Decisions

- Every current static App Router page is eligible because its pathname contains
  no user-specific segment. Query strings and fragments are still removed.
- Dynamic public catalog segments are replaced with stable telemetry templates
  rather than sent verbatim. This preserves route-level analytics without
  trusting an arbitrary segment to be public.
- Dynamic framework routes emitted by Speed Insights are normalized to the same
  templates as their concrete browser URLs.
- Opaque-code routes and `/experiments/runs/*` remain suppressed.

## Risks and mitigations

1. Risk: a public dynamic matcher could admit an opaque secret route.
   Mitigation: match only known public catalog namespaces and explicitly reserve
   private experiment-run paths.
2. Risk: query or fragment state could escape on a newly eligible page.
   Mitigation: canonicalize every accepted event to pathname-only form before
   either vendor sends it.
3. Risk: a new static page could be silently omitted.
   Mitigation: derive current static page paths from App Router page files in
   focused coverage and require each one to be eligible.

## Verification

- Focused telemetry Vitest: 9 tests passed.
- Focused ESLint: passed.
- Hosted-web typecheck: passed.
- Frontend design-proof suite: 10 tests passed.
- Agent docs drift: passed with this active plan.
Completed: 2026-07-29
