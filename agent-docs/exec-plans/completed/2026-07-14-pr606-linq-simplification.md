# PR 606 Linq Authority Simplification

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Keep only the pre-provider and provider-entry Linq authority checks still
missing on current `main`, while deleting PR 606's automatic legacy-route
scanner and compatibility plumbing.

## Success criteria

- Unmarked canonical/device proactive Linq work fails before model execution.
- A proactive direct Linq send is rechecked at provider entry against the
  member's current or pending home route and cannot target a durable group
  thread.
- Existing persisted intent facts derive the direct-home-only check when they
  are sufficient; no new persisted boolean is added without a failing proof.
- No hourly scanner, maintenance repair loop, route-ack response field, device
  compatibility state, new queue, or new state owner.
- Target no more than 300 production additions and 500 focused test additions;
  stop and simplify before exceeding either cap.

## Constraints

- Rebuild manually from current `main`; do not cherry-pick mixed PR 606 commits.
- Preserve reply-anchored Linq delivery and old-runner JSON compatibility.
- Use the existing explicit audited legacy-route repair CLI for any retained
  data repair; do not restore automatic runtime migration.
- Avoid billing and actor-admission scope.

## Tasks

1. Re-prove the missing pre-provider and provider-entry checks on current
   `main` and drop any finding already fixed by recent route-authority work.
2. Implement the smallest derived authority check and focused regressions.
3. Verify the diff contains none of PR 606's deleted scanner machinery.
4. Run required tests, audits, typechecks, skew review, and final review.
5. Finish, push, open a draft PR, and run exact-head ReviewGPT with CI.

## Progress

Now:

- Implemented the pre-model route marker guard and derived current-home-only
  provider-entry recheck without new persisted state.
- Focused proof passed: assistant-engine 105/105, assistant-runtime 166/166,
  and Web 35/35. All three affected package typechecks passed.
- Coverage-write tightened the final-entry no-retarget regression; the
  security/privacy and simplification audits reported no unresolved finding.
- Deployment remains Web first, then an immediate runner rollout and bundle
  fingerprint smoke, as required by the existing Linq provider-claim contract.

Next:

- Finish the scoped commit, rebase onto current `main`, publish the draft PR,
  and run exact-head CI and ReviewGPT.
Completed: 2026-07-14
