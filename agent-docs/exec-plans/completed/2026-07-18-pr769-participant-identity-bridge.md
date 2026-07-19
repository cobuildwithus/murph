# PR 769 participant identity bridge

## Goal

Finish the accepted ReviewGPT correction for PR 769 so challenge kickoff can
associate an attributable current group member with the group-scoped
`participantId` returned by `read_shared`, including when display names are
duplicated.

The model turn must start before the group read. Reuse the existing lazy
`read_shared` query and current membership row id; add no state owner, cache,
standalone query, compatibility path, or pre-model operation.

## Invariants

- `HostedGroupMember.id` is the sole challenge `participantId`; it rotates on
  leave and rejoin.
- `read_shared` is the only attribution, scoring, and diagnostics read. The
  legacy `read_current` wire remains unchanged.
- Only bounded, route-authorized current-turn Linq handles may enter a
  model-triggered `read_shared` request. Web retains a handle only when it
  matches exactly one current membership and returns it in that row's
  `currentTurnHandles` beside `participantId`.
- Missing or mismatched identity is unresolved and must never fall back to
  display name, array order, projection values, grant state, global member id,
  or model memory.
- Handles are not persisted in challenge state or rendered in challenge
  messages.
- Scheduled, notification, and detached shared reads carry no handles.
- Every model-facing group summary strips the global member id and legacy
  roster handle.
- The universal new-group permission set omits `device-sync-status.v0`;
  challenge setup requests the unique union of its exact scoring and diagnostic
  scopes with that core.

## Work plan

1. Add bounded current-turn handles to the lazy `read_shared` request/result
   and match them inside the existing Web group query.
2. Project only `currentTurnHandles`, group-scoped `participantId`, consented
   labels, and requested projections to the model; leave `read_current`
   unchanged.
3. Add focused duplicate-name, ambiguous-handle, privacy, leave/rejoin, and
   zero-prestart regression coverage.
4. Run scoped verification and completion audits, commit and push the exact
   remediation head, then complete ReviewGPT and GitHub CI before making the PR
   ready.

## Verification

- Full package suites passed before the final audit: Web 5,863 tests, Assistant
  Engine 2,529 tests, Assistant Runtime 1,736 tests, and Hosted Execution 364
  tests.
- Typechecks passed for Web, Assistant Engine, Assistant Runtime, Hosted
  Execution, and Cloudflare.
- Final-delta focused tests passed for the Web group store and callback route
  (54), Assistant Engine group tool (47), Assistant Runtime Linq group boundary
  (11), and Hosted Execution parser (54).
- Web ESLint completed with zero errors; its eight warnings are in untouched
  files.
- Architecture/simplification, security/privacy, coverage, and task-finish
  audits were run against the completed diff. The one found coupling to the
  existing newsletter self-opt-out resolver was removed and regression-tested;
  the final architecture, security/privacy, and task-finish passes reported no
  remaining findings.
- `git diff --check` passed.

## Deployment concerns

Deploy and fully restart the Cloudflare consumer first, then apply the nullable
snapshot migration and deploy Web's `read_shared` producer. During the bounded
old-Web interval, shared reads fail closed as unavailable. Ordinary group
creation remains compatible because the universal permission set does not add
the new device scope; challenge setup activates after Web supports its explicit
device request. No attribution retry or legacy-wire widening is introduced.

Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
