# Cold-start Codex process reuse

## Goal

Restore safe hosted Codex App Server reuse across member turns by separating
stable process identity from fresh per-turn capabilities at a request-scoped
boundary supported by the runtime.

Success criteria:

- Keep per-turn CLI bridge and delivery authority fresh and narrowly scoped.
- Prevent those volatile capabilities from forcing an otherwise compatible
  Codex App Server respawn on every hosted invocation.
- Preserve provider authentication, thread continuity, and fail-closed launch
  identity checks.
- Cover reuse, capability rotation, and incompatible-launch behavior with
  focused tests.

## Constraints

- Do not exclude volatile secrets from launch identity while leaving stale
  values in the child process environment.
- Add no new state owner, daemon, compatibility layer, or broad lifecycle
  abstraction.
- Preserve active hosted runtime and CLI bridge work in other lanes.
- Keep private identifiers, payloads, credentials, and local paths out of
  committed artifacts.

## Approach

1. Prove the current launch-identity respawn path and the available Codex
   request-scoped configuration surface.
2. Move only volatile per-turn authority to that request boundary while
   retaining stable launch-time environment in process identity.
3. Update focused runtime tests for safe reuse and incompatible launches.
4. Run scoped verification, required coverage review, CI, and ReviewGPT.

## State

Active.

## Notes

- Hosted runtime evidence showed that fresh bridge and delivery capabilities
  currently alter the App Server launch identity every invocation, guaranteeing
  a respawn even when the container and member runtime are already warm.
- The implementation must preserve capability freshness rather than weakening
  the launch hash around stale child-process environment.
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
