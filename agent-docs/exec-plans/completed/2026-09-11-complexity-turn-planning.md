# Simplify assistant route capability planning

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce the measured complexity of assistant route planning while preserving each route's exact instructions, tool authority, history/resume policy, and read ordering.

## Scope and invariants

The existing route planner remains the orchestration owner. Extract cohesive pure capability policies within that owner; add no state, dependency, registry, or external work. Preserve accepted-input authorization, scheduled scope, private/group isolation, and maintenance/output-only restrictions.

## Evidence and design

The cyclomatic guard identified resolveAssistantRouteTurnPlan at 215 with file debt 195. Most decisions are inline tool-availability checks and presentation policy. Existing composed route-plan fixtures exercise direct, group, scheduled, notification, maintenance, and resume behavior. Smaller capability policies clarify which facts authorize each family without relocating authority.

## Tasks

1. Extract narrow tool-family and response-card policies while preserving values and catalog ordering.
2. Run composed route tests, relevant typecheck, and complexity guard; inspect complete diff.
3. Open a scoped draft PR and hand stable candidate evidence to the parent for candidate review, CI, and ReviewGPT.

## Verification

- Focused composed route-planning suite: 104 tests passed. Existing full-plan digests for direct, group, maintenance, output-only, and scheduled-email routes are unchanged.
- Assistant-engine typecheck passed.
- Complexity guard passed: file debt 195 → 123; maximum function complexity 215 → 129. Private-member availability is 28 and communication availability is 26; their explicit, related capability rules remain together.
- Parent preliminary diff review accepted the pure-policy boundaries and preserved boolean conditions.
- No prompt text, tool schema, emitted tool order, persistent schema, deployment protocol, or awaited operation changed. Initial provider-input token measurement is not applicable because this refactor changes no provider-input surface.
- Focused real-Codex journey passed using gpt-5.6-terra and an authenticated alternate local subscription home: 60 committed messages retained, exactly one provider request, one user/assistant transcript pair, and a concise correct reply. UX verdict: Ready. Earlier homes failed authentication before provider action; no credentials were copied or recorded.
- Parent owns final candidate admission, exact-head CI, and ReviewGPT; implementation plan closure does not claim those gates passed.
Completed: 2026-09-11
