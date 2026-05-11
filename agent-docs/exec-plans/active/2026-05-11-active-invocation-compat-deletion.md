# Active invocation compatibility deletion window

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Put a hard deletion window on the remaining hosted runner active-invocation
  compatibility shims and legacy projections, while keeping the live runtime
  naming centered on the current write-fence contract.

## Success criteria

- Current Cloudflare runner code imports and uses the write-fence helper name
  for live authority paths.
- Legacy active-invocation methods and projected fields carry an explicit
  deletion date of 2026-05-25.
- Focused Cloudflare tests cover the compatibility deadline and write-fence
  fallback behavior.
- Required verification for the touched Cloudflare surface passes or any
  blocker is clearly attributed.

## Scope

- In scope: `apps/cloudflare` hosted runner compatibility contracts, helper
  naming, focused tests, and hosted runtime docs that describe the deletion
  window.
- Out of scope: removing the deployed compatibility methods/projections before
  the 2026-05-25 hard cut.

## Constraints

- Technical constraints: preserve deploy skew compatibility for already
  deployed web/container callers; do not widen runtime authority; do not rename
  persisted SQLite column names in this cleanup.
- Product/process constraints: keep privacy guardrails and avoid local path or
  identifier leakage in generated artifacts.

## Risks and mitigations

1. Risk: removing or renaming a compatibility surface early breaks deploy skew.
   Mitigation: leave the legacy methods/projections in place with a hard
   deletion date and focused compatibility tests.
2. Risk: the old active-invocation vocabulary keeps spreading.
   Mitigation: move current imports to a write-fence helper and document the
   hard-cut deadline where legacy names remain.

## Tasks

1. Inspect current active-invocation compatibility surfaces.
2. Add the hard deletion deadline and current write-fence naming.
3. Add focused tests for deadline/fallback behavior.
4. Run focused verification and required completion checks.

## Decisions

- 2026-05-11: Use 2026-05-25 as the hard deletion date, giving roughly two
  deploy cycles from this change while making the final removal non-optional.

## Verification

- Commands to run: focused Cloudflare tests for runner outbound compatibility,
  plus required typecheck/test lanes from the repo verification map as time and
  worktree state allow.
- Expected outcomes: green focused tests and no type errors from the touched
  Cloudflare surface.
