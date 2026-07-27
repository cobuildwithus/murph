# Hard-cut stale Crabbox clients

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Ensure pre-cost-control worktrees cannot reach a live Blacksmith hydration
  workflow after this PR lands.

## Success criteria

- The old workflow path is absent.
- The current dispatcher, profile, docs, and tests pin one new bounded path.
- A regression test proves the old path is not present or routed.
- Focused and canonical local verification pass without a Testbox.

## Scope

- In scope: hard-cut workflow path, its pinned dispatcher/profile references,
  live trust-boundary guidance, and focused regression proof.
- Out of scope: restarting or signaling other sessions, compatibility shims,
  lease state, coordinators, and changes to application runtime.

## Constraints

- Technical constraints: delete the old external capability path rather than
  teaching stale clients a new protocol.
- Product/process constraints: the new workflow is a trust-root change and must
  be verified locally until it lands on the default branch.

## Risks and mitigations

1. Risk: a stale client still resolves the old workflow.
   Mitigation: remove that workflow path entirely and assert its absence.
2. Risk: current clients drift across references.
   Mitigation: update the dispatcher, profile, workflow test, skill, and live
   security/verification guidance together.

## Tasks

1. Move the bounded workflow to a new canonical path.
2. Update every live owner and add old-path rejection proof.
3. Verify locally, close the remediation plan, push, and run ReviewGPT round 2.

## Decisions

- Use a capability hard cut, not a runtime cleanup campaign: old clients receive
  no workflow at their pinned path, while current clients use the one new path.
- Accepted final ReviewGPT round 1's stale-worktree finding. The host audit found
  no persistent config, current-shell, launchd, or Codex-parent flag source, but
  one live old-worktree child shell retained the legacy flag. That process is
  owned by another session and was not signaled.

## Verification

- Focused dispatcher/trusted-entrypoint suites passed: 2 files, 21 tests.
- Node syntax, bounded-workflow YAML parsing, old-path absence, and diff hygiene
  passed.
- Canonical local repo-tool diff verification passed: 29 files, 421 tests.
- No verification step provisioned a Blacksmith Testbox.
Completed: 2026-07-27
