# Member-reported daily metric corrections

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Let Murph durably record an exact group participant's stated daily metric
  value without changing or deleting device evidence.
- Surface the member-reported value through the existing consented group share
  projection with explicit manual-source provenance.

## Success criteria

- An exact current group sender can supply a dated daily metric value that is
  durably handed to their personal runtime and stored in their canonical vault.
- The existing group projection exposes the value as a separate `manual`
  source, and repeated delivery is idempotent.
- Murph acknowledges only durable acceptance, never claims that a device value
  changed, and treats contradicted visible snapshots as stale or unverified.
- Focused tests, package typechecks, preliminary specialist review, final
  ReviewGPT, and exact-head CI complete without unresolved accepted findings.

## Scope

- Exact accepted-message sender resolution in hosted groups.
- Existing encrypted mailbox delivery into a personal hosted runtime.
- Canonical manual observation import and existing group-share projection.
- Assistant tool guidance, focused contracts, tests, durable docs, and
  changelog.

## Constraints

- Keep canonical health values in the member vault and Web authoritative only
  for group identity, grants, and encrypted projections.
- Preserve provider observations as immutable evidence; corrections are
  separately sourced member reports.
- Reuse the existing mailbox, core write, and projection owners. Add no table,
  queue, scheduler, or override hierarchy.
- Bind every group correction to the exact accepted input and server-resolved
  current participant. The model must never select a member id.
- Keep private examples and direct identifiers out of repository artifacts and
  review packets.

## Tasks

1. [x] Trace the current group sender, mailbox, canonical observation, CLI, and
   shared-projection owners and choose the smallest composable seam.
2. [x] Implement the exact-sender report action, personal-runtime import,
   projection handoff, and assistant guidance.
3. [ ] Run focused tests, direct scenario proof, package typechecks, changelog
   validation, and durable-doc checks.
4. [ ] Commit and push an exact candidate head, open a PR, and start the
   preliminary specialist and final ReviewGPT passes concurrently with CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan via
   `scripts/finish-task`, and prove exact-head CI and mergeability.

## Verification log

- Initial architecture trace found that daily shared projections already
  preserve `manual` as a separate public source and select the latest same-day
  observation within each source. The missing seam is a trusted exact-sender
  handoff into the existing personal-runtime canonical write path.
- The action itself is the bounded assistant tool; a second generic CLI flag
  would duplicate validation without adding an owner or user outcome.
- Focused contracts, hosted-execution, assistant-runtime, assistant-engine, and
  Web tests pass. All affected package typechecks pass after generated Web
  prerequisites are prepared.
