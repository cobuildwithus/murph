# Remove obsolete device-sync environment telemetry

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Stop emitting the obsolete per-pass Junction platform-environment diagnostic
  while preserving the platform-owned provider configuration path unchanged.

## Success criteria

- The hosted device-sync pass no longer writes
  `device-sync.legacy_platform_env_present`.
- The active writer and its dedicated test are deleted. The shared reader-side
  event code remains temporarily accepted so older warm runner bundles cannot
  fail log parsing during deployment skew.
- Junction platform configuration resolution, sync cadence, credentials,
  provider behavior, and error handling remain unchanged.
- Focused tests and typechecks pass; the exact PR head passes required review
  and CI gates.

## Scope

- In scope: hosted runtime logging call/function and the focused assertion that
  existed only for that writer.
- Out of scope: provider configuration ownership, environment forwarding,
  credential resolution, provider requests, sync scheduling, and failure
  classification.

## Constraints

- Technical constraints: retain `hasHostedRuntimeJunctionPlatformEnv` because
  it is still part of canonical Junction config resolution; do not replace the
  deleted event with another per-pass metric.
- Product/process constraints: internal telemetry cleanup only, no member-facing
  changelog item; use a sanctioned worktree, scoped commit, draft PR, preliminary
  completion-specialists review, exact-head CI, and privacy-safe evidence.

## Risks and mitigations

1. Risk: deleting the detector could accidentally disable Junction provider
   configuration.
   Mitigation: remove only the logging path and keep the shared configuration
   helper plus existing config-resolution coverage intact.
2. Risk: removing the shared reader code would make an old warm runner's
   best-effort log fail parsing during deployment skew.
   Mitigation: retain the existing accepted event code; only the current writer
   is retired.

## Tasks

1. Confirm exclusive ownership and trace the diagnostic's introduction and
   current call/config owners.
2. Delete the obsolete per-pass writer and its dedicated test while preserving
   and directly testing reader-side compatibility.
3. Run focused runtime and hosted-execution tests plus relevant typechecks;
   inspect the complete diff and privacy boundary.
4. Commit, push, open the draft PR, run required ReviewGPT/CI gates, resolve
   findings, close this plan, and push the final exact head.

## Decisions

- Junction's platform-owned environment remains canonical and is not legacy.
- Delete the obsolete detector instead of renaming or aggregating it: no
  migration/action owner consumes this event, and production evidence shows it
  fires on every healthy pass. Retain read-side acceptance for old warm bundles.
- Changelog is not applicable because members cannot observe a telemetry-only
  deletion and device behavior is unchanged.
- Product UX and frontend lenses are not applicable. The preliminary prompt
  lens applies to this operative plan, and the coverage lens applies because
  executable logging behavior and tests change. The hosted-runtime/deployment
  surface requires the normal final ReviewGPT gate; no local deep-review pass
  will run for the same completed change.

## Verification

- Passed: assistant-runtime hosted maintenance test (94 tests), hosted provider
  config test (3 tests), hosted-execution runtime-control test (33 tests), and
  both affected package typechecks.
- Passed: writer-specific stale-reference search and `git diff --check`; the
  event code remains only in the compatibility reader contract and this plan.
- Passed: an explicit request-parser regression proves the old event remains
  accepted from warm runners while the current emitter is absent.
- Preliminary ReviewGPT returned two accepted findings: correct final-gate
  routing in this plan and add direct no-emission proof. Both were confined to
  this plan and focused tests under the Non-Production Remediation exception.
- Passed after remediation: focused no-emission test (1 passed), complete
  maintenance test (94 passed), assistant-runtime typecheck, and
  `git diff --check`.
- Pending: final exact-head ReviewGPT, required GitHub checks, and current-base
  merge-tree proof.
