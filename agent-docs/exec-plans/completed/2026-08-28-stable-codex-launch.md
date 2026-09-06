# Keep ordinary assistant turns on one stable Codex process

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Keep Murph's resident Codex process stable across ordinary, group-email, and
  silent-maintenance turns while preserving each turn's existing capability
  boundary as thread configuration.
- Delete the turn-level launch-override plumbing that lets a feature silently
  reconfigure or restart the resident process.

## Success criteria

- Arbitrary assistant turns can no longer supply process-launch configuration
  overrides.
- Group-email turns still disable filesystem-capable shell and related native
  capabilities, but do so through thread configuration.
- Habitat maintenance still disables memory use and generation, but does so
  through thread configuration.
- Thread configuration is supplied on both thread start and thread resume.
- Working-directory changes remain per-thread RPC state and do not change the
  resident process launch identity.
- Deterministic tests reproduce the previous restart behavior and prove the
  corrected path uses one process without weakening the special-turn
  boundaries.
- A focused real-Codex journey exercises the production-shaped boundary and
  its actual reply/tool behavior.
- The exact pushed candidate passes scoped verification, applicable ReviewGPT
  gates, and required GitHub checks.

## Scope

- In scope:
  - Delete `codexConfigOverrides` from the assistant message/turn contracts and
    provider composition path.
  - Express group-email, restricted one-shot, and Habitat restrictions with
    `codexThreadConfig`.
  - Send thread config during resume as well as start.
  - Remove working directory from the app-server launch key.
  - Add deterministic, composed, and live regression proof.
- Out of scope:
  - Venice and other custom inference-provider behavior.
  - Generic async-notification stale-resume policy.
  - Changes to member-visible prompts or message copy.

## Constraints

- Technical constraints:
  - Preserve the authenticated/private versus signed-group-email trust
    boundary and the Habitat no-memory contract.
  - Keep provider registration and other genuine process-launch configuration
    at the low-level app-server boundary.
  - Prefer deletion and direct data flow over a new lifecycle abstraction.
- Product/process constraints:
  - Product UX classification: Patch. The promise is unchanged; background
    work should not cause avoidable assistant-process churn.
  - Affected journeys: ordinary private conversation around async work;
    group-email conversation; Habitat silent maintenance.
  - Keep confidential production examples out of fixtures, docs, commits, and
    PR text.

## Risks and mitigations

1. Risk: Moving restrictions from process launch to thread RPC could omit them
   during a resumed thread.
   Mitigation: Include config in both start and resume requests and assert both
   paths directly.
2. Risk: Simplification could accidentally restore filesystem access to signed
   group email.
   Mitigation: Retain the read-only sandbox and exact capability flags, then
   verify the live journey cannot use shell.
3. Risk: Removing working directory from process identity could launch the
   child in the wrong directory.
   Mitigation: Keep working directory validation and per-thread RPC fields;
   test two directories on one resident process.

## Tasks

1. Capture the failing launch-key/config-override behavior in focused tests.
2. Delete assistant-level launch-override plumbing and move legitimate
   restrictions to explicit thread config.
3. Remove working directory from the launch key and cover per-thread cwd reuse.
4. Update durable architecture guidance and the member-visible changelog if
   warranted.
5. Run focused deterministic and real-Codex verification; inspect the replies.
6. Commit, push, open a draft PR, finalize its evidence, and mark it ready.
7. Run preliminary specialist and final ReviewGPT gates on the exact candidate,
   resolve accepted findings, wait for required CI, merge, and retire the
   worktree.

## Decisions

- Keep the actual group-email and Habitat restrictions; they protect concrete
  privacy/product boundaries. Change their configuration scope rather than
  deleting those boundaries.
- Do not broaden this task to custom inference or generic async continuation.
- Treat working directory as thread state because the resident child already
  launches from a stable temporary directory.
- Treat local reasoning-display settings as thread config too; they affect
  presentation and do not justify replacing the provider process.
- Changelog: not applicable. The member-visible image-continuity outcome is
  already represented by the 2026-08-28 `image-follow-ups-keep-context` item;
  this PR removes broader internal process churn without adding a distinct
  public promise.

## Verification

- Commands to run:
  - Focused Vitest files covering launch identity, app-server requests, runner
    routing, and notification maintenance.
  - Focused typecheck/lint commands selected from the repository verification
    map.
  - One focused real-Codex journey for the changed capability boundary.
  - Preliminary ReviewGPT Product UX and coverage lenses plus the final
    cross-cutting ReviewGPT gate.
  - Required GitHub checks on the exact PR head.
- Expected outcomes:
  - One app-server spawn across ordinary and specially restricted turns.
  - Per-thread cwd/config values reach the RPC requests.
  - Group email remains shell-disabled and Habitat remains memory-disabled.
  - No assistant-level process launch override contract remains.
- Evidence captured:
  - Replaying the old cwd launch-key rule made the resident regression fail
    with 3 spawns instead of 1; restoring the fix made the same test pass.
  - Focused deterministic runner and app-server/provider tests pass.
  - Assistant-engine typecheck passes.
  - The focused real-Codex group-email journey passes on `gpt-5.6-terra` via
    local subscription: one group-usage action, no shell action, truthful 64%
    reply. Reply review verdict: Ready.
Completed: 2026-08-28
