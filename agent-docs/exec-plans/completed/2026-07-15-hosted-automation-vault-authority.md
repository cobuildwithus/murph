# Hosted automation vault-scoped authority

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let an authenticated interactive hosted conversation archive or change any
  canonical automation in its already-bound runtime vault, even when that
  automation stores an older conversation route.

## Success criteria

- Existing cross-route automations can be paused, archived, reactivated, or
  edited from an authenticated turn in the same runtime vault.
- New or explicitly rerouted automations still bind only to the trusted current
  conversation route; model-supplied alternate targets remain unauthorized.
- Unverified routes, scheduled notification turns, and unauthenticated group
  email replies still cannot mutate automations.
- The redundant stored-route ownership check and its onboarding exception are
  deleted without adding state, services, repair paths, or compatibility code.
- Focused regression tests, truthful owner verification, required audits, and
  the PR review/CI gate pass.

## Scope

- In scope: hosted CLI automation mutation authorization, focused CLI tests,
  and the durable architecture statement for the authority boundary.
- Out of scope: scheduler ownership, delivery target resolution, provider
  egress, vault layout, local operator cross-route authoring, and deployment.

## Constraints

- Technical constraints: the restored workspace remains member or synthetic
  group scoped; the current-route bridge remains the interactive-turn proof;
  canonical writes continue through the core automation owner; stored routes
  remain delivery hints rather than ownership state.
- Product/process constraints: preserve unrelated work, isolate from the active
  PR 550 lane, keep unauthenticated group email fail-closed, and use the
  smallest deletion-oriented patch.

## Risks and mitigations

1. Risk: vault-scoped mutation accidentally permits a model-selected target.
   Mitigation: keep current-route equality on create and explicit route changes;
   broaden only authority over records already present in the bound vault.
2. Risk: a spoofable group-email reply gains room-control authority.
   Mitigation: retain the explicit non-direct email denial before every hosted
   mutation.
3. Risk: status or non-route edits silently move an automation to a new route.
   Mitigation: preserve the stored route unless the operation intentionally
   replaces the full record or explicitly requests a route change.

## Tasks

1. Prove the active invocation, workspace, vault, and current-route bridge
   ownership boundaries from code and tests.
2. Replace record-route authorization with vault-scoped mutation authorization
   while retaining trusted current-route selection for route writes.
3. Replace same-room denial tests with direct and group vault-scoped mutation
   regressions plus unchanged negative authority cases.
4. Update durable architecture, run verification and required audit passes,
   complete parent review, commit, push, open a PR, and finish ReviewGPT/CI.

## Decisions

- Use the already-bound runtime vault as the automation record ownership
  boundary. The current route proves an authenticated interactive turn and
  selects destinations for new or explicit route writes; it does not own
  existing canonical records.
- Preserve existing routes for status-only and non-route edits. Full save/import
  replacements continue to materialize the trusted current route.
- Keep the correction deletion-oriented: remove the redundant record-route
  ownership scan and managed-onboarding exception instead of adding a second
  policy owner, migration, repair path, or compatibility layer.

## Verification

- Focused automation coverage passed: 32 tests across the automation command and
  current-route continuity suites.
- The truthful diff-aware lane passed after preparing the repository's ignored
  generated catalogs: assistant runtime 1,660 passed and 2 skipped; CLI 1,088
  passed and 1 skipped; Cloudflare 1,819 passed; affected typechecks and guards
  passed.
- Direct scenario proof passed for both an authenticated current conversation
  managing an older-route automation and a hosted operation without an
  interactive grant remaining unable to edit or change status.
- The required `coverage-write` audit added the no-grant mutation regression,
  reran the focused and diff-aware lanes, and reported no unresolved actionable
  coverage findings.
- Remaining gates: parent final review, scoped commit, PR CI, and ReviewGPT.
Completed: 2026-07-15
